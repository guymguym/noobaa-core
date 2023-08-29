/* Copyright (C) 2020 NooBaa */
'use strict';

require('../util/dotenv').load();
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsmulti');
dbg.original_console();

const config = require('../../config');

const util = require('util');
const minimist = require('minimist');

require('../server/system_services/system_store').get_instance({ standalone: true });

const nb_native = require('../util/nb_native');
const RpcError = require('../rpc/rpc_error');
const ObjectSDK = require('../sdk/object_sdk');
const http_utils = require('../util/http_utils');
const cloud_utils = require('../util/cloud_utils');
const SensitiveString = require('../util/sensitive_string');
const BucketSpaceS3 = require('../sdk/bucketspace_s3');
// const BucketSpaceFS = require('../sdk/bucketspace_fs');
// const endpoint_stats_collector = require('../sdk/endpoint_stats_collector');

const HELP = `
Help:

    "nsmulti" is a noobaa-core command runs a local S3 endpoint on top of multiple namespaces.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/cmd/nsmulti <nsmulti-config-json> [options...]
`;

const ARGUMENTS = `
Arguments:

    <nsmulti-config-json>      A json describing the configuration for nsmulti (TBD).
`;

const OPTIONS = `
Options:

    --http_port <port>                      (default 6001)           Set the S3 endpoint listening HTTP port to serve.
    --https_port <port>                     (default 6443)           Set the S3 endpoint listening HTTPS port to serve.
    --https_port_sts <port>                 (default -1)             Set the S3 endpoint listening HTTPS port for STS.
    --metrics_port <port>                   (default -1)             Set the metrics listening port for prometheus.
    --access_key <key>                      (default none)           Authenticate incoming requests from this access key only (default is no auth).
    --secret_key <key>                      (default none)           Authenticate incoming requests with this secret key only (default is no auth).
    --debug <level>                         (default 0)              Increase debug level
    --forks <n>                             (default none)           Forks spread incoming requests (config.ENDPOINT_FORKS used if flag is not provided)
`;

const ANONYMOUS_AUTH_WARNING = `

WARNING:

    !!! AUTHENTICATION is not enabled !!!
    
    This means that any access/secret signature or unsigned (anonymous) requests
    will allow access to the filesystem over the network.
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(OPTIONS.trimStart());
    process.exit(1);
}

class NSMultiObjectSDK extends ObjectSDK {

    constructor(nsmulti_config, account) {
        const rpc_client = {
            pool: {
                update_issues_report(params) {
                    console.warn('update_issues_report', params);
                },
            },
            object: {
                update_endpoint_stats(params) {
                    console.log('update_endpoint_stats', params);
                },
            },
            stats: {
                update_nsfs_stats(params) {
                    console.log('update_nsfs_stats', params);
                },
            },
        };
        super(rpc_client, rpc_client, null);
        this.nsmulti_config = nsmulti_config;
        this.nsmulti_account = account;
        this.nsmulti_namespaces = {};

        const ns_info = this.nsmulti_config.read_resources[0].resource;
        const agent = ns_info.endpoint_type === 'AWS' ?
            http_utils.get_default_agent(ns_info.endpoint) :
            http_utils.get_unsecured_agent(ns_info.endpoint);
        const s3_params = {
            params: { Bucket: ns_info.target_bucket },
            endpoint: ns_info.endpoint,
            aws_sts_arn: ns_info.aws_sts_arn,
            accessKeyId: ns_info.access_key.unwrap(),
            secretAccessKey: ns_info.secret_key.unwrap(),
            signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(ns_info.endpoint, ns_info.auth_method),
            s3ForcePathStyle: true,
            httpOptions: { agent },
            access_mode: ns_info.access_mode,
            // region: 'us-east-1', // TODO needed?
            // computeChecksums: false, // disabled by default for performance
        };
        this.bucketspace_s3 = new BucketSpaceS3({ s3_params });
    }

    _get_bucketspace() {
        return this.bucketspace_s3;
    }

    async read_bucket_usage_info() { return undefined; }
    async read_bucket_sdk_website_info() { return undefined; }
    async read_bucket_sdk_namespace_info() { return undefined; }
    async read_bucket_sdk_caching_info() { return undefined; }
    get_auth_token() { return undefined; }
    set_auth_token() { return undefined; }

    async load_requesting_account(auth_req) {
        const access_key = this.nsmulti_account.access_keys?.[0]?.access_key;
        if (access_key) {
            const token = this.get_auth_token();
            if (!token) {
                throw new RpcError('UNAUTHORIZED', `Anonymous access to bucket no allowed`);
            }
            if (token.access_key !== access_key.unwrap()) {
                throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not allowed`);
            }
        }
        this.requesting_account = this.nsmulti_account;
    }

    async _get_bucket_namespace(bucket_name) {
        const existing_ns = this.nsmulti_namespaces[bucket_name];
        if (existing_ns) return existing_ns;
        const with_target_bucket = nsr => (nsr && { resource: { ...nsr.resource, target_bucket: bucket_name } });
        const ns = this._setup_multi_namespace({
            name: bucket_name,
            namespace: {
                read_resources: this.nsmulti_config.read_resources?.map(with_target_bucket),
                write_resources: this.nsmulti_config.write_resources?.map(with_target_bucket),
                write_resource: with_target_bucket(this.nsmulti_config.write_resource),
            },
        });
        this.nsmulti_namespaces[bucket_name] = ns;
        return ns;
    }

    async read_bucket_sdk_policy_info(bucket_name) {
        return {
            s3_policy: {
                version: '2012-10-17',
                statement: [{
                    effect: 'allow',
                    action: ['*'],
                    resource: ['*'],
                    principal: [new SensitiveString('*')],
                }]
            },
            system_owner: new SensitiveString('nsfs'),
            bucket_owner: new SensitiveString('nsfs'),
        };
    }
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        config.DB_TYPE = 'none';
        config.NSFS_VERSIONING_ENABLED = true;

        if (argv.help || argv.h) return print_usage();
        if (argv.debug) {
            const debug_level = Number(argv.debug) || 5;
            dbg.set_module_level(debug_level, 'core');
            nb_native().fs.set_debug_level(debug_level);
        }
        const http_port = Number(argv.http_port) || 6001;
        const https_port = Number(argv.https_port) || 6443;
        const https_port_sts = Number(argv.https_port_sts) || -1;
        const metrics_port = Number(argv.metrics_port) || -1;
        const access_key = argv.access_key && new SensitiveString(String(argv.access_key));
        const secret_key = argv.secret_key && new SensitiveString(String(argv.secret_key));
        const forks = Number(argv.forks) || 0;

        const nsmulti_config_json = argv._[0];
        if (!nsmulti_config_json) return print_usage();
        const nsmulti_config = JSON.parse(nsmulti_config_json);

        for (const r of [
            ...nsmulti_config.read_resources,
            ...nsmulti_config.write_resources,
            nsmulti_config.write_resource,
        ]) {
            if (!r) continue;
            r.resource.access_key = new SensitiveString(r.resource.access_key);
            r.resource.secret_key = new SensitiveString(r.resource.secret_key);
        }

        const account = {
            email: new SensitiveString('nsfs@noobaa.io'),
            access_keys: access_key && [{ access_key, secret_key }],
            // nsfs_account_config: fs_config,
        };

        if (Boolean(access_key) !== Boolean(secret_key)) {
            console.error('Error: Access and secret keys should be either both set or else both unset');
            return print_usage();
        }

        if (!access_key) console.log(ANONYMOUS_AUTH_WARNING);

        console.log('nsfs: setting up ...', {
            nsmulti_config,
            http_port,
            https_port,
            https_port_sts,
            metrics_port,
            access_key,
            secret_key,
            forks,
        });

        const endpoint = require('../endpoint/endpoint');
        await endpoint.start_endpoint({
            http_port,
            https_port,
            https_port_sts,
            // metrics_port,
            // forks,
            init_request_sdk: (req, res) => {
                req.object_sdk = new NSMultiObjectSDK(nsmulti_config, account);
            }
        });

        console.log('nsfs: listening on', util.inspect(`http://localhost:${http_port}`));
        console.log('nsfs: listening on', util.inspect(`https://localhost:${https_port}`));

    } catch (err) {
        console.error('nsfs: exit on error', err.stack || err);
        process.exit(2);
    }
}

exports.main = main;

if (require.main === module) main();
