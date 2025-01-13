/* Copyright (C) 2016 NooBaa */
'use strict';

require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const AWS = require('aws-sdk');
const minimist = require('minimist');
const http = require('http');
const https = require('https');
const assert = require('assert');
const nb_native = require('../util/nb_native');
const rdma_utils = require('../util/rdma_utils');
const RandStream = require('../util/rand_stream');
const Speedometer = require('../util/speedometer');

const size_units_mult = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024
};

const argv = minimist(process.argv.slice(2), {
    string: [
        'endpoint',
        'access_key',
        'secret_key',
        'bucket',
        'head',
        'get',
        'put',
        'upload',
        'delete',
        'mb',
    ],
});

argv.sig = argv.sig || 's3';
argv.time = argv.time || 0;
argv.concur = argv.concur || 1;
argv.forks = argv.forks || 1;
argv.size = argv.size || 1;
argv.size_units = argv.size_units || 'MB';
argv.part_concur = argv.part_concur || 1;
argv.part_size = argv.part_size || 5;

const data_size = argv.size * size_units_mult[argv.size_units];

if (!size_units_mult[argv.size_units]) {
    throw new Error('Unrecognized size_units ' + argv.size_units);
}
if (argv.upload && data_size < argv.part_size * 1024 * 1024) {
    throw new Error('data_size lower than part_size ' + data_size);
}

/**
 * @typedef {{
 *      id: number;
 *      buf?: Buffer;
 *      rdma_client?: nb.CuObjClientNapi;
 * }} Worker
 */

/**
 * @type {(worker: Worker) => Promise<number>}
 */
let op_func;

if (argv.help) {
    print_usage();
} else if (typeof argv.head === 'string') {
    op_func = head_object;
} else if (typeof argv.get === 'string') {
    op_func = argv.rdma ? get_object_rdma : get_object;
} else if (typeof argv.put === 'string') {
    op_func = argv.rdma ? put_object_rdma : put_object;
} else if (typeof argv.upload === 'string') {
    op_func = upload_object;
} else if (typeof argv.delete === 'string') {
    op_func = delete_object;
} else if (typeof argv.mb === 'string') {
    op_func = create_bucket;
} else {
    print_usage();
}

// @ts-ignore
http.globalAgent.keepAlive = true;
// @ts-ignore
https.globalAgent.keepAlive = true;

const is_https = argv.endpoint.startsWith('https:');
const s3 = new AWS.S3({
    endpoint: argv.endpoint,
    accessKeyId: argv.access_key && String(argv.access_key),
    secretAccessKey: argv.secret_key && String(argv.secret_key),
    s3ForcePathStyle: true,
    signatureVersion: argv.sig, // s3 or v4
    computeChecksums: argv.checksum || false, // disabled by default for performance
    s3DisableBodySigning: !argv.signing || true, // disabled by default for performance
    region: argv.region || 'us-east-1',
    httpOptions: {
        agent: is_https ?
            new https.Agent({
                localAddress: argv.local_ip,
                keepAlive: true,
                rejectUnauthorized: !argv.selfsigned,
            }) : new http.Agent({
                localAddress: argv.local_ip,
                keepAlive: true,
            })
    }
});

// AWS config does not use https.globalAgent
// so for https we need to set the agent manually
if (is_https && !argv.selfsigned) {
    // @ts-ignore
    AWS.events.on('error', err => {
        if (err.message === 'self signed certificate') {
            setTimeout(() => console.log(
                '\n*** You can accept self signed certificates with: --selfsigned\n'
            ), 10);
        }
    });
}

const speedometer = new Speedometer('S3');
speedometer.run_workers(argv.forks, main, argv);

async function main() {
    if (argv.time) setTimeout(() => process.exit(), Number(argv.time) * 1000);
    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(run_worker_loop, i);
    }
}

async function run_worker_loop(id) {
    try {
        const worker = { id };
        for (; ;) {
            const start = process.hrtime.bigint();
            const size = await op_func(worker);
            const took_ms = Number(process.hrtime.bigint() - start) / 1e6;
            speedometer.add_op(took_ms);
            if (size) speedometer.update(size);
        }
    } catch (err) {
        console.error('WORKER', process.pid, 'ERROR', err.stack || err);
        process.exit();
    }
}

/** @type {AWS.S3.ListObjectsOutput} */
let _list_objects = { Contents: [], IsTruncated: true };
let _list_objects_next = 0;
let _list_objects_promise = null;

/**
 * This function returns the next object to be used for head/get/delete.
 * It will list objects and keep the list in memory, returning the objects in list order,
 * while fetching the next list pages on demand.
 * If prefix is provided it will be used to filter objects keys.
 * 
 * @param {string} [prefix]
 * @returns {Promise<AWS.S3.Object>}
 */
async function get_next_object(prefix) {
    while (_list_objects_next >= _list_objects.Contents.length && _list_objects.IsTruncated) {
        if (_list_objects_promise) {
            // console.log('get_next_object: wait for promise');
            await _list_objects_promise;
        } else {
            const marker = _list_objects.IsTruncated ?
                (_list_objects.NextMarker || _list_objects.Contents[_list_objects.Contents.length - 1]?.Key) :
                undefined;
            _list_objects_promise = s3.listObjects({
                Bucket: argv.bucket,
                Prefix: prefix,
                Marker: marker,
            }).promise();
            const res = await _list_objects_promise;
            const prev = _list_objects;
            _list_objects = res;
            _list_objects.Contents = prev.Contents.concat(_list_objects.Contents);
            _list_objects_promise = null;
            console.log('get_next_object: got', _list_objects.Contents.length, 'objects from marker', marker);
        }
    }

    const obj = _list_objects.Contents[_list_objects_next];
    _list_objects_next += 1;
    _list_objects_next %= _list_objects.Contents.length;
    return obj;
}

async function head_object() {
    const obj = await get_next_object(argv.head);
    await s3.headObject({ Bucket: argv.bucket, Key: obj.Key }).promise();
    return 0;
}

async function get_object() {
    const obj = await get_next_object(argv.get);
    await new Promise((resolve, reject) => {
        s3.getObject({
            Bucket: argv.bucket,
            Key: obj.Key,
        })
            .createReadStream()
            .on('finish', resolve)
            .on('error', reject)
            .on('data', data => {
                speedometer.update(data.length);
            });
    });
    return 0;
}

async function delete_object() {
    const obj = await get_next_object(argv.delete);
    await s3.deleteObject({
        Bucket: argv.bucket,
        Key: obj.Key
    }).promise();
    return 0;
}

async function put_object() {
    const upload_key = argv.put + '-' + Date.now().toString(36);
    await s3.putObject({
        Bucket: argv.bucket,
        Key: upload_key,
        ContentLength: data_size,
        Body: new RandStream(data_size, {
            highWaterMark: 1024 * 1024,
        })
    })
        .on('httpUploadProgress', progress => {
            speedometer.update(progress.loaded);
        })
        .promise();
    return 0;
}

async function upload_object() {
    const upload_key = argv.upload + '-' + Date.now().toString(36);
    await s3.upload({
        Bucket: argv.bucket,
        Key: upload_key,
        ContentLength: data_size,
        Body: new RandStream(data_size, {
            highWaterMark: 1024 * 1024,
        })
    }, {
        partSize: argv.part_size * 1024 * 1024,
        queueSize: argv.part_concur
    })
        .on('httpUploadProgress', progress => {
            speedometer.update(progress.loaded);
        })
        .promise();
    return 0;
}

async function create_bucket() {
    const new_bucket = argv.mb + '-' + Date.now().toString(36);
    await s3.createBucket({ Bucket: new_bucket }).promise();
    return 0;
}

/**
 * @param {Worker} worker 
 * @returns {Promise<number>}
 */
async function get_object_rdma(worker) {
    if (!worker.buf) {
        // TODO Add cuda buffer support
        worker.buf = nb_native().fs.dio_buffer_alloc(data_size);
    }
    if (!worker.rdma_client) {
        worker.rdma_client = new (nb_native().CuObjClientNapi)();
    }
    const obj = await get_next_object(argv.get);
    const ret_size = await worker.rdma_client.rdma('GET', worker.buf, async (rdma_info, callback) => {
        try {
            const req = s3.getObject({
                Bucket: argv.bucket,
                Key: obj.Key,
            });
            req.on('build', () => {
                req.httpRequest.headers[rdma_utils.X_NOOBAA_RDMA] =
                    rdma_utils.encode_rdma_header({ ...rdma_info });
            });
            const res = await req.promise();
            const rdma_hdr = res.$response.httpResponse.headers[rdma_utils.X_NOOBAA_RDMA];
            const rdma_reply = rdma_utils.decode_rdma_header(rdma_hdr);
            callback(null, Number(rdma_reply.size));
        } catch (err) {
            callback(err);
        }
    });

    assert.strictEqual(ret_size, data_size);
    return ret_size;
}

/**
 * @param {Worker} worker 
 * @returns {Promise<number>}
 */
async function put_object_rdma(worker) {
    if (!worker.buf) {
        // TODO Add cuda buffer support
        worker.buf = nb_native().fs.dio_buffer_alloc(data_size);
    }
    if (!worker.rdma_client) {
        worker.rdma_client = new (nb_native().CuObjClientNapi)();
    }
    const ret_size = await worker.rdma_client.rdma('PUT', worker.buf, async (rdma_info, callback) => {
        try {
            // const upload_key = argv.put + '-' + Date.now().toString(36);
            const upload_key = argv.put; // overwriting the same key
            const req = s3.putObject({
                Bucket: argv.bucket,
                Key: upload_key,
            });
            req.on('build', () => {
                req.httpRequest.headers[rdma_utils.X_NOOBAA_RDMA] =
                    rdma_utils.encode_rdma_header({ ...rdma_info });
            });
            const res = await req.promise();
            const rdma_hdr = res.$response.httpResponse.headers[rdma_utils.X_NOOBAA_RDMA];
            const rdma_reply = rdma_utils.decode_rdma_header(rdma_hdr);
            callback(null, Number(rdma_reply.size));
        } catch (err) {
            callback(err);
        }
    });

    assert.strictEqual(ret_size, data_size);
    return ret_size;
}



function print_usage() {
    console.log(`
Usage:
  --help                 show this usage
  --time <sec>           running time in seconds (0 seconds by default)
  --head <prefix>        head objects (prefix can be omitted)
  --get <prefix>         get objects (prefix can be omitted)
  --delete <prefix>      delete objects (prefix can be omitted)
  --put <key>            put (single) to key (key can be omitted)
  --upload <key>         upload (multipart) to key (key can be omitted)
  --mb <bucket>          creates a new bucket (bucket can be omitted)
Upload Flags:
  --concur <num>         concurrent operations to run from each process (default is 1)
  --forks <num>          number of forked processes to run (default is 1)
  --size <num>           generate random data of size (default 1)
  --size_units KB|MB|GB  generate random data of size_units (default MB)
  --part_size <MB>       multipart size
  --part_concur <num>    multipart concurrency
General S3 Flags:
  --endpoint <host>      (default is localhost)
  --access_key <key>     (default is env.AWS_ACCESS_KEY_ID || 123)
  --secret_key <key>     (default is env.AWS_SECRET_ACCESS_KEY || abc)
  --bucket <name>        (default is "first.bucket")
  --sig v4|s3            (default is s3)
  --ssl                  (default is false) Force SSL connection
  --aws                  (default is false) Use AWS endpoint and subdomain-style buckets
  --checksum             (default is false) Calculate checksums on data. slower.
  --rdma                 (default is false) Use RDMA to transfer object data.
`);
    process.exit();
}
