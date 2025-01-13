/* Copyright (C) 2025 NooBaa */
'use strict';

const querystring = require('querystring');

const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const http_utils = require('./http_utils');
const nb_native = require('./nb_native');
const { S3Error } = require('../endpoint/s3/s3_errors');

const X_NOOBAA_RDMA = 'x-noobaa-rdma'; // both a request header and a response header

/**
 * @param {querystring.ParsedUrlQueryInput} info
 * @returns {string}
 */
function encode_rdma_header(info) {
    return querystring.stringify({
        v: 1,
        ...info,
    });
}

/**
 * @param {string} header
 * @returns {querystring.ParsedUrlQueryInput}
*/
function decode_rdma_header(header) {
    const info = querystring.parse(header);
    if (info.v !== '1') {
        dbg.error('decode_rdma_header: mismatching rdma version', info.v, 'expected 1');
        throw new S3Error(S3Error.InvalidArgument);
    }
    return info;
}

/**
 * @param {nb.S3Request} req
 * @returns {nb.RdmaInfo|undefined}
 */
function parse_rdma_info(req) {
    const header = http_utils.hdr_as_str(req.headers, X_NOOBAA_RDMA);
    if (!header) return;
    try {
        const info = decode_rdma_header(header);
        const rdma_info = {
            desc: String(info.desc),
            addr: String(info.addr),
            size: Number(String(info.size)),
            offset: Number(String(info.offset || '0')),
        };
        return rdma_info;
    } catch (err) {
        dbg.warn('parse_rdma_info: failed to parse header', header, err);
        throw new S3Error(S3Error.InvalidArgument);
    }
}

/**
 * @param {nb.S3Request|undefined} req
 * @param {nb.S3Response} res
 * @param {nb.RdmaInfo|undefined} rdma_info
 * @param {nb.RdmaReply|undefined} rdma_reply
 */
function set_rdma_response_header(req, res, rdma_info, rdma_reply) {
    if (!rdma_info || !rdma_reply) return;
    const h = encode_rdma_header({ v: 1, ...rdma_reply });
    res.setHeader(X_NOOBAA_RDMA, h);
}


/**
 * @param {nb.RdmaInfo} rdma_info
 * @param {import ('./file_writer')} writer
 * @param {import ('./buffer_utils').MultiSizeBuffersPool} multi_buffer_pool
 * @returns {Promise<number>}
 */
async function write_rdma_buffer(rdma_info, writer, multi_buffer_pool) {
    // TODO handle abort signal
    // TODO register buffers
    const rdma_server = await get_rdma_server(rdma_info);
    return await multi_buffer_pool
        .get_buffers_pool(rdma_info.size)
        .use_buffer(async buffer => {
            rdma_server.registerBuffer(buffer);
            const ret_size = await rdma_server.rdma('PUT', 'FileWriter', buffer, rdma_info);
            await writer.write_buffers([buffer], ret_size);
            await writer.finalize();
            return ret_size;
        });
}

/**
 * @param {nb.RdmaInfo} rdma_info
 * @param {import ('./file_reader').FileReader} reader
 * @param {import ('./buffer_utils').MultiSizeBuffersPool} multi_buffer_pool
 * @returns {Promise<number>}
 */
async function read_rdma_buffer(rdma_info, reader, multi_buffer_pool) {
    // TODO handle abort signal
    // TODO register buffers
    const rdma_server = await get_rdma_server(rdma_info);
    return await multi_buffer_pool
        .get_buffers_pool(rdma_info.size)
        .use_buffer(async buffer => {
            // console.log('GGG use_buffer');
            rdma_server.registerBuffer(buffer);
            // console.log('GGG registered', buffer);
            // const read_size = 
            await reader.read_buffer(buffer, 0, buffer.length, reader.start);
            // console.log('GGG read_buffer', read_size);
            const ret_size = await rdma_server.rdma('GET', 'FileReader', buffer, rdma_info);
            // console.log('GGG rdma', ret_size);
            return ret_size;
        });
}

let rdma_server = null;

/**
 * @param {nb.RdmaInfo} rdma_info
 * @returns {nb.CuObjServerNapi}
 */
function get_rdma_server(rdma_info) {
    if (!config.RDMA_ENABLED) {
        throw new Error('RDMA is not enabled');
    }
    if (rdma_server) return rdma_server;
    const { CuObjServerNapi } = nb_native();
    const ip = '172.16.0.61';
    rdma_server = new CuObjServerNapi({
        ip,
        port: 0, // every fork will get a different port
        log_level: 'ERROR',
    });
    console.log('RDMA server:', ip);
    return rdma_server;
}

// EXPORTS

exports.X_NOOBAA_RDMA = X_NOOBAA_RDMA;
exports.encode_rdma_header = encode_rdma_header;
exports.decode_rdma_header = decode_rdma_header;
exports.parse_rdma_info = parse_rdma_info;
exports.set_rdma_response_header = set_rdma_response_header;
exports.write_rdma_buffer = write_rdma_buffer;
exports.read_rdma_buffer = read_rdma_buffer;
exports.get_rdma_server = get_rdma_server;
