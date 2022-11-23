/* Copyright (C) 2020 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
// const crypto = require('crypto');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsstore');
dbg.original_console();

const system_store = require('../server/system_services/system_store');
system_store.get_instance({ standalone: true });

const Agent = require('../agent/agent');
const ObjectIO = require('../sdk/object_io');
const ObjectSDK = require('../sdk/object_sdk');
const NamespaceNB = require('../sdk/namespace_nb');
const BucketSpaceNB = require('../sdk/bucketspace_nb');
const SensitiveString = require('../util/sensitive_string');
const fs_utils = require('../util/fs_utils');
const db_client = require('../util/db_client');
const nb_native = require('../util/nb_native');
const json_utils = require('../util/json_utils');
const md_server = require('../server/md_server');
const server_rpc = require('../server/server_rpc');
const node_server = require('../server/node_services/node_server');
const auth_server = require('../server/common_services/auth_server');
const account_server = require('../server/system_services/account_server');

const HELP = `
Help:

    "nsstore" is a noobaa-core command runs a local S3 endpoint
    that serves data by using backingstores to store and retrieve simple key-value data,
    while the meta-data is stored in a database.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    noobaa-core nsstore [options...] <backingstore> [<backingstore> ...] 
`;

const ARGUMENTS = `
Arguments:

    <backingstore>       Backingstore to use (e.g "s3://server:8080" or "data-dir/bucket-name")
`;

const OPTIONS = `
Options:

    --http_port <port>     (default 6002)   Set the S3 endpoint listening HTTP port to serve.
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
        const http_port = Number(argv.http_port) || 6002;
        const https_port = Number(argv.https_port) || -1;
        const backingstores = argv._;
        if (!backingstores.length) return print_usage();

        console.warn(WARNINGS);
        console.log('nsstore: setting up ...', argv);

        await db_client.instance().connect();
        server_rpc.register_system_services();
        server_rpc.register_node_services();
        await md_server.register_rpc();
        await system_store.get_instance().load();
        const get_system = () => system_store.get_instance().data.systems[0];

        if (!get_system()) {
            await account_server.ensure_support_account();
            await server_rpc.client.system.create_system({
                name: process.env.CREATE_SYS_NAME,
                email: process.env.CREATE_SYS_EMAIL,
                password: process.env.CREATE_SYS_PASSWD || 'DeMo1',
                must_change_password: true,
            });
            await system_store.get_instance().load();
        }

        await server_rpc.client.create_auth_token({
            system: process.env.CREATE_SYS_NAME,
            email: process.env.CREATE_SYS_EMAIL,
            password: process.env.CREATE_SYS_PASSWD || 'DeMo1',
        });

        await node_server.start_monitor();
        await node_server.sync_monitor_storage_info();

        await server_rpc.client.pool.create_hosts_pool({
            name: 'nsstore',
            host_count: backingstores.length,
            is_managed: false,
        });

        for (const bs of backingstores) {
            const conf_path = path.join(bs, 'agent_conf.json');
            const token_path = path.join(bs, 'token');
            const agent_conf = new json_utils.JsonFileWrapper(conf_path);
            if (!fs.existsSync(token_path)) {
                const system = get_system();
                await fs_utils.replace_file(
                    token_path,
                    auth_server.make_auth_token({
                        system_id: String(system._id),
                        account_id: system.owner._id,
                        role: 'create_node',
                    })
                );
            }
            const token_wrapper = {
                read: () => fs.promises.readFile(token_path),
                write: token => fs_utils.replace_file(token_path, token),
            };
            const create_node_token_wrapper = {
                read: () => agent_conf.read().then(conf => conf.create_node_token),
                write: new_token => agent_conf.update({ create_node_token: new_token }),
            };
            const agent = new Agent({
                rpc: server_rpc.rpc,
                address: server_rpc.get_base_address(),
                routing_hint: 'LOOPBACK',
                node_name: bs,
                host_id: bs,
                location_info: {
                    host_id: bs,
                },
                storage_path: bs,
                storage_limit: undefined,
                agent_conf,
                token_wrapper,
                create_node_token_wrapper,
            });
            await agent.start();
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
            init_request_sdk: (req, res) => init_request_sdk(req, res, auth_token),
        });

        if (http_port > 0) console.log(`nsstore: serving at http://localhost:${http_port}`);
        if (https_port > 0) console.log(`nsstore: serving at https://localhost:${https_port}`);
    } catch (err) {
        console.error('nsstore: exit on error', err.stack || err);
        process.exit(2);
    }
}

const object_io = new ObjectIO();

function init_request_sdk(req, res, auth_token) {
    const rpc = server_rpc.rpc;
    const rpc_client = rpc.new_client();
    const internal_rpc_client = rpc.new_client({ auth_token });

    const bs_nb = new BucketSpaceNB({ rpc_client });
    const ns_nb = new NamespaceNB();
    const object_sdk = new ObjectSDK(rpc_client, internal_rpc_client, object_io);

    // resolve namespace and bucketspace
    object_sdk._get_bucketspace = () => bs_nb;
    object_sdk._get_bucket_namespace = async bucket_name => ns_nb;

    // object_sdk.get_auth_token = noop;
    // object_sdk.set_auth_token = noop;
    // object_sdk.authorize_request_account = noopAsync;
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
