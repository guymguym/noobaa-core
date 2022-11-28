/* Copyright (C) 2020 NooBaa */
'use strict';

const minimist = require('minimist');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nscache');
dbg.original_console();

const nb_native = require('../util/nb_native');
const ObjectSDK = require('../sdk/object_sdk');
const NamespaceNB = require('../sdk/namespace_nb');
const NamespaceS3 = require('../sdk/namespace_s3');
const NamespaceCache = require('../sdk/namespace_cache');
const BucketSpaceS3 = require('../sdk/bucketspace_s3');
const SensitiveString = require('../util/sensitive_string');
const ObjectIO = require('../sdk/object_io');
const md_server = require('../server/md_server');
const server_rpc = require('../server/server_rpc');
const system_store = require('../server/system_services/system_store');
const account_server = require('../server/system_services/account_server');

const HELP = `
Help:

    "nscache" is a noobaa-core command runs a local S3 endpoint
    that serves and caches data from a remote endpoint.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    noobaa-core nscache <endpoint-url> [options...]
`;

const ARGUMENTS = `
Arguments:

    <endpoint-url>       The remote endpoint to cache (e.g "http://server:8080")
`;

const OPTIONS = `
Options:

    --access_key <key>
    --secret_key <key>
    --http_port <port>     (default 6001)   Set the S3 endpoint listening HTTP port to serve.
    --https_port <port>    (default   -1)   Set the S3 endpoint listening HTTPS port to serve.
`;

const WARNINGS = `
WARNING:

    !!! This feature is WORK IN PROGRESS - please stay tuned !!!

    !!! NO AUTHENTICATION checks are done !!!
        - This means that any access/secret keys or anonymous requests
        - will allow access to the filesystem over the network.
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(OPTIONS.trimStart());
    console.warn(WARNINGS.trimStart());
    process.exit(1);
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        if (argv.help || argv.h) return print_usage();
        if (argv.debug) {
            const debug_level = Number(argv.debug) || 5;
            dbg.set_module_level(debug_level, 'core');
            nb_native().fs.set_debug_level(debug_level);
        }
        const http_port = Number(argv.http_port) || 6003;
        const https_port = Number(argv.https_port) || -1;
        const hub_endpoint =
            argv._[0] || (argv.dev === true ? 'http://localhost:6002' : argv.dev) || undefined;
        if (!hub_endpoint) return print_usage();

        console.warn(WARNINGS);
        console.log('nscache: setting up ...', argv);

        /** @type {AWS.S3.ClientConfiguration} */
        const s3_params = Object.freeze({
            endpoint: hub_endpoint,
            accessKeyId: argv.access_key,
            secretAccessKey: argv.secret_key,
            s3ForcePathStyle: true,
        });

        server_rpc.register_system_services();
        server_rpc.register_node_services();
        await md_server.register_rpc();
        await system_store.get_instance().load();
        if (!system_store.get_instance().data.systems[0]) {
            await account_server.ensure_support_account();
            await server_rpc.client.system.create_system({
                name: process.env.CREATE_SYS_NAME,
                email: process.env.CREATE_SYS_EMAIL,
                password: process.env.CREATE_SYS_PASSWD || 'DeMo1',
                must_change_password: true,
            });
        }

        const endpoint = require('../endpoint/endpoint');
        const auth_token = await endpoint.get_auth_token(process.env);

        // Starting the endpoint serverwith a callback that will hook
        // incoming requests to use the object_sdk we created
        await endpoint.start_endpoint({
            http_port,
            https_port,
            https_port_sts: -1,
            metrics_port: -1,
            init_request_sdk: (req, res) => init_request_sdk(req, res, s3_params, auth_token),
        });

        if (http_port > 0) console.log(`nscache: serving at http://localhost:${http_port}`);
        if (https_port > 0) console.log(`nscache: serving at https://localhost:${https_port}`);
    } catch (err) {
        console.error('nscache: exit on error', err.stack || err);
        process.exit(2);
    }
}

const object_io = new ObjectIO();

function init_request_sdk(req, res, s3_params, auth_token) {
    const rpc = server_rpc.rpc;
    const rpc_client = rpc.new_client();
    const internal_rpc_client = rpc.new_client({ auth_token });

    const bs = new BucketSpaceS3({ s3_params });
    const ns_nb = new NamespaceNB();
    const object_sdk = new ObjectSDK(rpc_client, internal_rpc_client, object_io);

    // resolve namespace and bucketspace
    const namespaces = {};
    object_sdk._get_bucketspace = () => bs;
    object_sdk._get_bucket_namespace = async bucket_name => {
        const existing_ns = namespaces[bucket_name];
        if (existing_ns) return existing_ns;
        const ns_hub = new NamespaceS3({
            s3_params: {
                ...s3_params,
                params: { Bucket: bucket_name },
            },
            namespace_resource_id: '998877',
            rpc_client: null,
        });
        const ns_cache = new NamespaceCache({
            namespace_hub: ns_hub,
            namespace_nb: ns_nb,
            caching: { ttl_ms: 3600000 },
            active_triggers: null,
        });
        namespaces[bucket_name] = ns_cache;
        return ns_cache;
    };

    object_sdk.get_auth_token = noop;
    object_sdk.set_auth_token = noop;
    object_sdk.authorize_request_account = noopAsync;
    object_sdk.requesting_account = {};

    object_sdk.read_bucket_sdk_website_info = noopAsync;
    object_sdk.read_bucket_sdk_namespace_info = noopAsync;
    object_sdk.read_bucket_sdk_caching_info = noopAsync;
    object_sdk.read_bucket_usage_info = noopAsync;

    object_sdk.read_bucket_sdk_policy_info = async () => ({
        system_owner: new SensitiveString(''),
        bucket_owner: new SensitiveString(''),
        s3_policy: {
            statement: [
                {
                    effect: 'allow',
                    action: ['*'],
                    principal: [new SensitiveString('*')],
                    resource: ['*'],
                },
            ],
        },
    });

    req.object_sdk = object_sdk;
}

function noop() {
    // no comment
}

async function noopAsync() {
    noop();
}

exports.main = main;

if (require.main === module) main();
