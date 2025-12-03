/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const http_utils = require('./http_utils');
const nb_native = require('./nb_native');
const { S3Error } = require('../endpoint/s3/s3_errors');
const { S3 } = require('@aws-sdk/client-s3');

/** request header that contains the client's RDMA info for the server to RDMA from/into */
const X_RDMA_INFO_HDR = 'x-rdma-info';

/** response header that contains the number of bytes RDMA by the server */
const X_RDMA_REPLY_HDR = 'x-rdma-reply';

/** 
 * custom request header that identifies the client library (plus optional version)
 * this is not required, but will useful for debugging and backward compatibility
 */
const X_RDMA_AGENT_HDR = 'x-rdma-agent';
const X_RDMA_AGENT_CUOBJ = 'cuobj';

/** 
 * raddr:rsize:rkey:lid:qp:has_gid:gid ("%016lx:%08x:%08x:%04x:%06x:%01x:%016lx%016lx")
 */
const CUOBJ_DESC_FMT = "0102030405060708:01020304:01020304:0102:010203:1:0102030405060708090a0b0c0d0e0f10";
const CUOBJ_DESC_FIELDS = Object.freeze(CUOBJ_DESC_FMT.split(':'));

/** 
 * desc:raddr:roffset:rsize:file_offset ("%016lx:%016lx:%016lx:%016lx")
 * 
 * NOTE: file_offset is always 0 for now as the S3 requests use the Range header instead
 * we keep it for possible future use as it is in the library
 */
const CUOBJ_HEADER_FMT = `${CUOBJ_DESC_FMT}:0102030405060708:0102030405060708:0102030405060708:0102030405060708`;
const CUOBJ_HEADER_FIELDS = Object.freeze(CUOBJ_HEADER_FMT.split(':'));

/**
 * util returning a hex string of the given number padded to the given length
 * e.g. hexify(255, 4) => "00ff"
 * @param {number|bigint|undefined|null} num
 * @param {number} pad
 * @returns {string}
 */
function hexify(num, pad) {
    return (num || 0).toString(16).padStart(pad, '0');
}

/**
 * @param {string} str
 * @returns {number}
 */
function hex_to_number(str) {
    return Number('0x' + (str || '0'));
}

/**
 * returns a header string with format CUOBJ_HEADER_FMT
 * @param {nb.RdmaInfo} info
 * @returns {string}
 */
function encode_cuobj_info_header(info) {
    const offset = hexify(info.offset, 16);
    const size = hexify(info.size, 16);
    const file_offset = hexify(0, 16);
    return `${info.desc}:${info.addr}:${offset}:${size}:${file_offset}`;
}

/**
 * @param {string} header
 * @returns {nb.RdmaInfo}
*/
function decode_cuobj_info_header(header) {
    if (header.length !== CUOBJ_HEADER_FMT.length) {
        dbg.error(`decode_cuobj_info_header: invalid ${X_RDMA_INFO_HDR}: ${header}`,
            `length ${header.length} expected ${CUOBJ_HEADER_FMT.length}`);
        throw new S3Error(S3Error.InvalidArgument);
    }
    const fields = header.split(':');
    if (fields.length !== CUOBJ_HEADER_FIELDS.length) {
        dbg.error(`decode_cuobj_info_header: invalid ${X_RDMA_INFO_HDR}: ${header}`,
            `fields ${fields.length} expected ${CUOBJ_HEADER_FIELDS.length}`);
        throw new S3Error(S3Error.InvalidArgument);
    }
    for (let i = 0; i < CUOBJ_HEADER_FIELDS.length; i++) {
        if (fields[i].length !== CUOBJ_HEADER_FIELDS[i].length) {
            dbg.error(`decode_cuobj_info_header: invalid ${X_RDMA_INFO_HDR}: ${header}`,
                `field ${i} length ${fields[i].length} expected ${CUOBJ_HEADER_FIELDS[i].length}`);
            throw new S3Error(S3Error.InvalidArgument);
        }
    }
    const desc = header.slice(0, CUOBJ_DESC_FMT.length);
    const addr = fields[CUOBJ_DESC_FIELDS.length];
    const offset = hex_to_number(fields[CUOBJ_DESC_FIELDS.length + 1]);
    const size = hex_to_number(fields[CUOBJ_DESC_FIELDS.length + 2]);
    // const file_offset = hex_to_number(fields[CUOBJ_DESC_FIELDS.length + 3]); // currently unused
    return { desc, addr, offset, size };
}

/**
 * @param {import('http').OutgoingHttpHeaders} req_headers
 * @param {nb.RdmaInfo|undefined} rdma_info
 */
function set_rdma_request_headers(req_headers, rdma_info) {
    if (!rdma_info) return;
    req_headers[X_RDMA_AGENT_HDR] = X_RDMA_AGENT_CUOBJ;
    req_headers[X_RDMA_INFO_HDR] = encode_cuobj_info_header(rdma_info);
}

/**
 * @param {nb.S3Request|undefined} req
 * @param {nb.S3Response} res
 * @param {nb.RdmaInfo|undefined} rdma_info
 * @param {nb.RdmaReply|undefined} rdma_reply
 */
function set_rdma_response_headers(req, res, rdma_info, rdma_reply) {
    if (!rdma_info || !rdma_reply) return;
    res.setHeader(X_RDMA_AGENT_HDR, X_RDMA_AGENT_CUOBJ);
    res.setHeader(X_RDMA_REPLY_HDR, rdma_reply.size.toString()); // simple number reply, no need for complex encoding
}

/**
 * @param {nb.S3Request} req
 * @returns {nb.RdmaInfo|undefined}
 */
function parse_rdma_info(req) {
    const rdma_info_hdr = http_utils.hdr_as_str(req.headers, X_RDMA_INFO_HDR);
    if (!rdma_info_hdr) return;

    // rdma agent can be empty, in which case we assume it is cuobj for backward compatibility
    const rdma_agent = http_utils.hdr_as_str(req.headers, X_RDMA_AGENT_HDR);
    if (!rdma_agent || rdma_agent === X_RDMA_AGENT_CUOBJ) {
        return decode_cuobj_info_header(rdma_info_hdr);
    }

    dbg.error(`parse_rdma_info: unsupported ${X_RDMA_AGENT_HDR}:`, rdma_agent);
    throw new S3Error(S3Error.InvalidArgument);
}

/**
 * @param {import('http').IncomingHttpHeaders} res_headers
 * @returns {nb.RdmaReply|undefined}
 */
function parse_rdma_reply(res_headers) {
    const rdma_reply_hdr = http_utils.hdr_as_str(res_headers, X_RDMA_REPLY_HDR);
    if (!rdma_reply_hdr) return;

    const size = Number(String(rdma_reply_hdr));
    if (Number.isSafeInteger(size) && size >= 0) {
        return { size };
    }

    dbg.error(`parse_rdma_reply: invalid ${X_RDMA_REPLY_HDR}:`, rdma_reply_hdr);
    throw new S3Error(S3Error.InvalidArgument);
}

/////////////////
// RDMA SERVER //
/////////////////

let _rdma_server = null;

/**
 * @returns {nb.RdmaServerNapi}
 */
function s3_rdma_server() {
    if (!config.RDMA_ENABLED) {
        throw new Error('RDMA is not enabled');
    }
    if (_rdma_server) return _rdma_server;
    const { RdmaServerNapi } = nb_native();
    const ip = process.env.S3_RDMA_SERVER_IP || config.S3_RDMA_SERVER_IPS?.[0] || '172.16.0.61';
    _rdma_server = new RdmaServerNapi({
        ip,
        port: 0, // every fork will get a different port
        log_level: 'ERROR',
        use_async_events: process.env.S3_RDMA_USE_ASYNC_EVENTS === 'true',
    });
    console.log('RDMA server:', ip);
    return _rdma_server;
}

/**
 * Server side RDMA operation to write a buffer from remote server to local file
 * Use buffer pool to get buffer of the required size.
 * 
 * @param {nb.RdmaInfo} rdma_info
 * @param {import ('./file_writer')} writer
 * @param {import ('./buffer_utils').MultiSizeBuffersPool} multi_buffer_pool
 * @param {AbortSignal} [abort_signal]
 * @returns {Promise<nb.RdmaReply|undefined>}
 */
async function write_file_from_rdma(rdma_info, writer, multi_buffer_pool, abort_signal) {
    const rdma_server = await s3_rdma_server();
    return await multi_buffer_pool.use_buffer(rdma_info.size, async buffer => {
        rdma_server.register_buffer(buffer);
        let offset = 0;
        while (offset < rdma_info.size) {
            abort_signal?.throwIfAborted();
            const rdma_slice = slice_rdma_info(rdma_info, offset, buffer.length);
            const ret_size = await rdma_server.rdma('PUT', 'FileWriter', buffer, rdma_slice);
            // console.log('GGG ret_size', ret_size);
            if (ret_size < 0) throw new Error('RDMA PUT failed');
            if (ret_size > buffer.length) throw new Error('RDMA PUT error: returned size is larger than buffer');
            if (ret_size === 0) break;
            abort_signal?.throwIfAborted();
            if (ret_size === buffer.length) {
                await writer.write_buffers([buffer], ret_size);
            } else {
                await writer.write_buffers([buffer.subarray(0, ret_size)], ret_size);
            }
            offset += ret_size;
        }
        abort_signal?.throwIfAborted();
        await writer.finalize();
        // console.log('GGG writer.total_bytes', writer.total_bytes);
        return { size: offset };
    });
}

/**
 * @param {nb.RdmaInfo} rdma_info
 * @param {number} offset
 * @param {number} size
 * @returns {nb.RdmaInfo}
 */
function slice_rdma_info(rdma_info, offset, size) {
    const slice = { ...rdma_info };
    slice.offset += offset;
    slice.size -= offset;
    if (slice.size > size) slice.size = size;
    return slice;
}

/**
 * @param {nb.RdmaInfo} rdma_info
 * @param {import ('./file_reader').FileReader} reader
 * @param {import ('./buffer_utils').MultiSizeBuffersPool} multi_buffer_pool
 * @param {AbortSignal} [abort_signal]
 * @returns {Promise<number>}
 */
async function read_file_to_rdma(rdma_info, reader, multi_buffer_pool, abort_signal) {
    if (nb_native().fs.gpfs?.rdma_enabled) {
        try {
            const ret_size = await reader.file.read_rdma(
                reader.fs_context,
                reader.pos,
                rdma_info.size,
                rdma_info.addr,
                rdma_info.desc,
            );
            if (ret_size < 0) {
                throw new Error(`read_file_to_rdma file.read_rdma failed ${ret_size}`);
            }
            return ret_size;
        } catch (err) {
            if (err.code === 'EOPNOTSUPP' || err.code === 'EINVAL') {
                dbg.log0(`RDMA direct from file returned ${err.code}, fallback to read`, err);
            } else {
                // any other error is 
                throw err;
            }
        }
    }

    const rdma_server = await s3_rdma_server();

    // we use the largest buffer size we can from the pools, and then read in chunks
    return await multi_buffer_pool.use_buffer(rdma_info.size, async buffer => {

        rdma_server.register_buffer(buffer);

        // hopefully we can complete the read in one go but if not, we will read in chunks,
        // and rdma each one to the client to the correct offset in the remote buffer,
        // before we read the next chunk to the same local buffer.
        let offset = 0;
        while (offset < rdma_info.size) {

            // allow fast abort by checking before and after the reads
            abort_signal?.throwIfAborted();

            // read the next chunk from the file
            const read_slice = slice_rdma_info(rdma_info, offset, buffer.length);
            const nread = await reader.read_into_buffer(buffer, 0, read_slice.size);

            // console.log('GGG nread', nread);
            if (nread === 0) break;

            abort_signal?.throwIfAborted();

            const rdma_slice = slice_rdma_info(rdma_info, offset, nread);
            const ret_size = await rdma_server.rdma('GET', reader.file_path, buffer, rdma_slice);

            // console.log('GGG ret_size', ret_size);
            if (ret_size !== nread) {
                throw new Error(`RDMA GET failed ret_size ${ret_size} != expected ${nread}`);
            }
            offset += ret_size;
        }
        return offset;
    });
}


/////////////////
// RDMA CLIENT //
/////////////////

/**
 * @returns {nb.RdmaClientNapi}
 */
function new_rdma_client() {
    if (!config.RDMA_ENABLED) {
        throw new Error('RDMA is not enabled');
    }
    return new (nb_native().RdmaClientNapi)();
}

/**
 * @param {import('@aws-sdk/client-s3').S3ClientConfig} s3_config
 * @param {Buffer} client_buf
 * @param {nb.RdmaClientNapi} rdma_client
 * @returns {S3}
 */
function s3_rdma_client(s3_config, client_buf, rdma_client) {
    const s3 = new S3(s3_config);
    s3.middlewareStack.use(s3_rdma_client_plugin(client_buf, rdma_client));
    return s3;
}

/**
 * @param {Buffer} client_buf
 * @param {nb.RdmaClientNapi} rdma_client
 * @returns {import('@smithy/types').Pluggable} 
 */
function s3_rdma_client_plugin(client_buf, rdma_client) {
    return {
        applyToStack: stack => {
            stack.add(s3_rdma_client_middleware(client_buf, rdma_client), {
                name: 'rdma',
                step: 'build',
            });
        }
    };
}

/**
 * @param {Buffer} client_buf
 * @param {nb.RdmaClientNapi} rdma_client
 * @returns {import('@smithy/types').BuildMiddleware} 
 */
function s3_rdma_client_middleware(client_buf, rdma_client) {
    // this is a middleware that sets up rdma adds the RDMA header
    return (next, context) => async args => {

        /** @type {any} */
        const input = args.input;
        /** @type {any} */
        const request = args.request;
        /** @type {any} */
        let result;

        // console.log('S3 RDMA: build', request, input);

        /** @type {'GET'|'PUT'} */
        let req_type = 'GET';
        /** @type {Buffer} */
        let rdma_buf;

        if (context.commandName === 'GetObjectCommand') {
            req_type = 'GET';
            rdma_buf = client_buf;
        } else if (context.commandName === 'PutObjectCommand') {
            req_type = 'PUT';
            rdma_buf = client_buf;
            // rdma_buf = input.Body; // TODO handle other body types?
            input.Body = undefined;
            request.headers['content-length'] = '0';
        } else if (context.commandName === 'UploadPartCommand') {
            req_type = 'PUT';
            rdma_buf = client_buf;
            // rdma_buf = input.Body; // TODO handle other body types?
            input.Body = undefined;
            request.headers['content-length'] = '0';
        } else {
            return next(args);
        }

        const ret_size = await rdma_client.rdma(
            req_type, rdma_buf, async (rdma_info, callback) => {
                try {
                    set_rdma_request_headers(request.headers, rdma_info);
                    // console.log('S3 RDMA: request', request.headers);
                    result = await next(args);
                    // console.log('S3 RDMA: response', result.response.headers);
                    const rdma_reply = parse_rdma_reply(result.response.headers);
                    result.output.rdma_reply = rdma_reply;
                    callback(null, Number(rdma_reply.size));
                } catch (err) {
                    console.warn('S3 RDMA: Received error from server', err);
                    callback(err);
                }
            }
        );

        if (ret_size < 0) {
            console.log('S3 RDMA: Return', ret_size, req_type, rdma_buf.length);
        }

        return result;
    };
}


// EXPORTS
exports.set_rdma_request_headers = set_rdma_request_headers;
exports.set_rdma_response_headers = set_rdma_response_headers;
exports.parse_rdma_info = parse_rdma_info;
exports.parse_rdma_reply = parse_rdma_reply;
// SERVER
exports.s3_rdma_server = s3_rdma_server;
exports.write_file_from_rdma = write_file_from_rdma;
exports.read_file_to_rdma = read_file_to_rdma;
// CLIENT
exports.new_rdma_client = new_rdma_client;
exports.s3_rdma_client = s3_rdma_client;
exports.s3_rdma_client_plugin = s3_rdma_client_plugin;
exports.s3_rdma_client_middleware = s3_rdma_client_middleware;
