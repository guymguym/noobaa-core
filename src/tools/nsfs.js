/* Copyright (C) 2020 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const events = require('events');
const minimist = require('minimist');

const s3_rest = require('../endpoint/s3/s3_rest');
const endpoint_utils = require('../endpoint/endpoint_utils');
const SensitiveString = require('../util/sensitive_string');
const NamespaceFS = require('../sdk/namespace_fs');
const { S3Error } = require('../endpoint/s3/s3_errors');

const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('nsfs');
dbg.original_console();

async function nsfs() {
    try {
        console.warn('nsfs: starting up ...');

        const argv = minimist(process.argv.slice(2));

        if (argv.help) print_usage();
        const port = Number(argv.port) || 6001;
        const root = String(argv.root || '.');

        const object_sdk = new NamespaceFS({ data_path: root });

        const noop = () => {
            // TODO
        };
        object_sdk.get_auth_token = noop;
        object_sdk.set_auth_token = noop;
        object_sdk.authorize_request_account = noop;
        object_sdk.read_bucket_sdk_website_info = noop;
        object_sdk.read_bucket_sdk_namespace_info = noop;
        object_sdk.read_bucket_sdk_caching_info = noop;
        object_sdk.read_bucket_sdk_policy_info = noop;
        object_sdk.read_bucket_usage_info = noop;

        object_sdk.list_buckets = () => list_fs_buckets(root);
        object_sdk.read_bucket = ({ name }) => read_fs_bucket(root, name);
        object_sdk.create_bucket = ({ name }) => create_fs_bucket(root, name);
        object_sdk.delete_bucket = ({ name }) => delete_fs_bucket(root, name);

        const http_server = http.createServer((req, res) => {
            endpoint_utils.prepare_rest_request(req);
            req.object_sdk = object_sdk;
            req.virtual_hosts = [];
            return s3_rest.handler(req, res);
        });
        http_server.listen(port);
        await events.once(http_server, 'listening');

        console.log(`nsfs: listening on http://localhost:${http_server.address().port}`);
        console.warn('nsfs: ready');

    } catch (err) {
        console.error('nsfs: exit on error', err.stack || err);
        process.exit(1);
    }
}

async function list_fs_buckets(root) {
    try {
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        const dirs_only = entries.filter(e => e.isDirectory());
        const buckets = dirs_only.map(e => ({ name: new SensitiveString(e.name) }));
        return { buckets };
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('nsfs: root dir not found', err);
            throw new S3Error(S3Error.NoSuchBucket);
        }
        throw err;
    }
}

async function read_fs_bucket(root, name) {
    try {
        const bucket_path = path.join(root, name);
        console.log(`nsfs: read_fs_bucket ${bucket_path}`);
        const bucket_dir_stat = await fs.promises.stat(bucket_path);
        if (!bucket_dir_stat.isDirectory()) {
            throw new S3Error(S3Error.NoSuchBucket);
        }
        return {
            name,
            bucket_type: 'NAMESPACE',
            versioning: 'DISABLED',
            namespace: { read_resources: [], write_resources: [] },
            tiering: { name, tiers: [] },
            usage_by_pool: { last_update: 0, pools: [] },
            storage: { last_update: 0, values: {} },
            data: { last_update: 0 },
            num_objects: { last_update: 0, value: 0 },
            host_tolerance: 0,
            node_tolerance: 0,
            writable: true,
            mode: 'OPTIMAL',
            undeletable: 'NOT_EMPTY',
        };
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('nsfs: bucket dir not found', err);
            throw new S3Error(S3Error.NoSuchBucket);
        }
        throw err;
    }
}

async function create_fs_bucket(root, name) {
    try {
        const bucket_path = path.join(root, name);
        console.log(`nsfs: create_fs_bucket ${bucket_path}`);
        await fs.promises.mkdir(bucket_path);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('nsfs: root dir not found', err);
            throw new S3Error(S3Error.NoSuchBucket);
        }
        throw err;
    }
}

async function delete_fs_bucket(root, name) {
    try {
        const bucket_path = path.join(root, name);
        console.log(`nsfs: delete_fs_bucket ${bucket_path}`);
        await fs.promises.rmdir(bucket_path);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('nsfs: root dir not found', err);
            throw new S3Error(S3Error.NoSuchBucket);
        }
        throw err;
    }
}

function print_usage() {
    console.log(`
Usage: noobaa-nsfs [--port <PORT>] [--root <PATH>]
    --port <PORT> - defaults to 6001
    --root <PATH> - defaults to '.'
`);
    process.exit(0);
}

nsfs();
