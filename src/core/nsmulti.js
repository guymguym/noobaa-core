/* Copyright (C) 2020 NooBaa */
'use strict';

require('../util/dotenv').load();
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsmulti');
dbg.original_console();

const config = require('../../config');

const fs = require('fs');
const util = require('util');
const minimist = require('minimist');

require('../server/system_services/system_store').get_instance({ standalone: true });

const nb_native = require('../util/nb_native');
const RpcError = require('../rpc/rpc_error');
const ObjectSDK = require('../sdk/object_sdk');
const http_utils = require('../util/http_utils');
const cloud_utils = require('../util/cloud_utils');
const BucketSpaceS3 = require('../sdk/bucketspace_s3');
const NamespaceMulti = require('../sdk/namespace_multi');
const SensitiveString = require('../util/sensitive_string');

const HELP = `
Help:

    "nsmulti" is a noobaa-core command runs a local S3 endpoint on top of multiple namespaces.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    node src/cmd/nsmulti <config-path> [options...]
`;

const ARGUMENTS = `
Arguments:

    <config-path>      A path to json file describing the configuration for nsmulti (TBD).
`;

const OPTIONS = `
Options:

    --http_port <port>                      (default 6001)           Set the S3 endpoint listening HTTP port to serve.
    --https_port <port>                     (default 6443)           Set the S3 endpoint listening HTTPS port to serve.
    --access_key <key>                      (default none)           Authenticate incoming requests from this access key only (default is no auth).
    --secret_key <key>                      (default none)           Authenticate incoming requests with this secret key only (default is no auth).
    --debug <level>                         (default 0)              Increase debug level
`;

// --https_port_sts <port>                 (default -1)             Set the S3 endpoint listening HTTPS port for STS.
// --metrics_port <port>                   (default -1)             Set the metrics listening port for prometheus.
// --forks <n>                             (default none)           Forks spread incoming requests (config.ENDPOINT_FORKS used if flag is not provided)

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

    constructor(account, bucketspace, ns_config) {
        // hook up the rpc calls
        const rpc_client = {
            options: {},
            bucket: {
                // read_bucket_sdk_info: params => this.read_bucket_sdk_info(params),
            },
            account: {
                // read_account_by_access_key: params => this.read_account_by_access_key(params),
            },
            object: {
                update_endpoint_stats: params => console.log('update_endpoint_stats', params),
                dispatch_triggers: params => console.log('dispatch_triggers', params),
            },
            pool: {
                update_issues_report: params => console.warn('update_issues_report', params),
            },
            stats: {
                update_nsfs_stats: params => console.log('update_nsfs_stats', params),
            },
        };
        super(rpc_client, rpc_client, null);
        this.account = account;
        this.bucketspace = bucketspace;
        this.ns_config = ns_config;
        this.namespaces = {};
    }

    _get_bucketspace() {
        return this.bucketspace;
    }

    async _get_bucket_namespace(bucket_name) {
        const existing_ns = this.namespaces[bucket_name];
        if (existing_ns) return existing_ns;

        const to_single_ns = r => this._setup_single_namespace({
            ...r,
            resource: {
                ...r.resource,
                target_bucket: bucket_name,
            },
        });
        const ns = new NamespaceMulti({
            namespaces: {
                read_resources: this.ns_config.read_resources?.map(to_single_ns),
                write_resources: this.ns_config.write_resources?.map(to_single_ns),
            },
            active_triggers: null,
        });
        this.namespaces[bucket_name] = ns;
        return ns;
    }

    async read_bucket_usage_info() { return undefined; }
    async read_bucket_sdk_website_info() { return undefined; }
    async read_bucket_sdk_namespace_info() { return undefined; }
    async read_bucket_sdk_caching_info() { return undefined; }
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
            system_owner: this.account.email,
            bucket_owner: this.account.email,
        };
    }

    // get_auth_token() { return undefined; }
    // set_auth_token() { return undefined; }

    // currently unused because we override _get_bucket_namespace()
    // read_bucket_sdk_info({ name }) {}

    // currently unused because we override load_requesting_account()
    // read_account_by_access_key({ access_key }) {}

    async load_requesting_account(auth_req) {
        const access_key = this.account.access_keys?.[0]?.access_key;
        if (access_key) {
            const token = this.get_auth_token();
            if (!token) {
                throw new RpcError('UNAUTHORIZED', `Anonymous access to bucket no allowed`);
            }
            if (token.access_key !== access_key.unwrap()) {
                throw new RpcError('INVALID_ACCESS_KEY_ID', `Access_key not allowed`);
            }
        }
        this.requesting_account = this.account;
    }
}

function load_config(config_path) {
    try {
        const json = fs.readFileSync(config_path, 'utf8');
        const ns_config = JSON.parse(json);

        for (const r of [
            ...ns_config.read_resources,
            ...ns_config.write_resources,
        ]) {
            if (!r) continue;
            r.resource.access_key = new SensitiveString(r.resource.access_key);
            r.resource.secret_key = new SensitiveString(r.resource.secret_key);
        }

        // use the first read resource as the bucketspace resource
        const bsr = ns_config.read_resources[0].resource;
        const agent = bsr.endpoint_type === 'AWS' ?
            http_utils.get_default_agent(bsr.endpoint) :
            http_utils.get_unsecured_agent(bsr.endpoint);
        const s3_params = {
            endpoint: bsr.endpoint,
            aws_sts_arn: bsr.aws_sts_arn,
            accessKeyId: bsr.access_key.unwrap(),
            secretAccessKey: bsr.secret_key.unwrap(),
            signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(bsr.endpoint, bsr.auth_method),
            s3ForcePathStyle: true,
            httpOptions: { agent },
            // params: { Bucket: bsr.target_bucket },
            // access_mode: bsr.access_mode,
            // region: 'us-east-1', // TODO needed?
            // computeChecksums: false, // disabled by default for performance
        };
        const bucketspace = new BucketSpaceS3({ s3_params });

        return {
            bucketspace,
            ns_config,
        };
    } catch (err) {
        console.warn('load_nsmulti_config: FAILED', err);
    }
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        config.DB_TYPE = 'none';

        if (argv.help || argv.h) return print_usage();
        if (argv.debug) {
            const debug_level = Number(argv.debug) || 5;
            dbg.set_module_level(debug_level, 'core');
            nb_native().fs.set_debug_level(debug_level);
        }

        const http_port = Number(argv.http_port) || 6001;
        const https_port = Number(argv.https_port) || 6443;
        // const https_port_sts = Number(argv.https_port_sts) || -1;
        // const metrics_port = Number(argv.metrics_port) || -1;
        const access_key = argv.access_key && new SensitiveString(String(argv.access_key));
        const secret_key = argv.secret_key && new SensitiveString(String(argv.secret_key));
        const config_path = argv._[0];

        if (!config_path) return print_usage();

        const { bucketspace, ns_config } = load_config(config_path);

        const account = {
            name: new SensitiveString('nsmulti'),
            email: new SensitiveString('nsmulti'),
            access_keys: access_key && [{ access_key, secret_key }],
        };

        if (Boolean(access_key) !== Boolean(secret_key)) {
            console.error('Error: Access and secret keys should be either both set or else both unset');
            return print_usage();
        }

        if (!access_key) console.log(ANONYMOUS_AUTH_WARNING);

        console.log('nsmulti: setting up ...', {
            config_path,
            http_port,
            https_port,
            // https_port_sts,
            // metrics_port,
            access_key,
            secret_key,
            // forks,
        });

        const endpoint = require('../endpoint/endpoint');
        await endpoint.start_endpoint({
            http_port,
            https_port,
            // https_port_sts,
            // metrics_port,
            // forks,
            init_request_sdk: (req, res) => {
                req.object_sdk = new NSMultiObjectSDK(account, bucketspace, ns_config);
            }
        });

        console.log('nsmulti: listening on', util.inspect(`http://localhost:${http_port}`));
        console.log('nsmulti: listening on', util.inspect(`https://localhost:${https_port}`));

    } catch (err) {
        console.error('nsmulti: exit on error', err.stack || err);
        process.exit(2);
    }
}

exports.main = main;

if (require.main === module) main();
