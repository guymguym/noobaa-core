/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const http_utils = require('./http_utils');
const nb_native = require('./nb_native');
const { S3 } = require('@aws-sdk/client-s3');
const { S3Error } = require('../endpoint/s3/s3_errors');

/** 
 * CuObj RDMA token format: "raddr:rsize:rkey:lid:qp:has_gid:gid"
 * printf/scanf format: "%016lx:%08x:%08x:%04x:%06x:%01x:%016lx%016lx"
 */
const CUOBJ_TOKEN_FMT = "0102030405060708:01020304:01020304:0102:010203:1:0102030405060708090a0b0c0d0e0f10";
const CUOBJ_TOKEN_FIELDS = Object.freeze(CUOBJ_TOKEN_FMT.split(':'));

/**
 * @param {string} str hexadecimal string representing a positive integer
 * @returns {number} positive integer up to Number.MAX_SAFE_INTEGER
 */
function parse_hex_number(str) {
    const num = Number(`0x${str}`);
    if (!Number.isSafeInteger(num) || num < 0) {
        throw new S3Error(S3Error.InvalidArgument);
    }
    return num;
}

/**
 * @param {string} token CUOBJ RDMA token string from header
 * @returns {nb.RdmaInfo}
*/
function decode_cuobj_token_hdr(token) {
    if (config.S3_RDMA_VALIDATE_TOKEN_HDR) {
        if (token.length !== CUOBJ_TOKEN_FMT.length) {
            dbg.error(`decode_cuobj_token_hdr: invalid ${config.S3_RDMA_TOKEN_HDR}: ${token}`,
                `length ${token.length} expected ${CUOBJ_TOKEN_FMT.length}`);
            throw new S3Error(S3Error.InvalidArgument);
        }
    }
    const fields = token.split(':');
    if (config.S3_RDMA_VALIDATE_TOKEN_HDR) {
        if (fields.length !== CUOBJ_TOKEN_FIELDS.length) {
            dbg.error(`decode_cuobj_token_hdr: invalid ${config.S3_RDMA_TOKEN_HDR}: ${token}`,
                `fields ${fields.length} expected ${CUOBJ_TOKEN_FIELDS.length}`);
            throw new S3Error(S3Error.InvalidArgument);
        }
        for (let i = 0; i < CUOBJ_TOKEN_FIELDS.length; i++) {
            if (fields[i].length !== CUOBJ_TOKEN_FIELDS[i].length) {
                dbg.error(`decode_cuobj_token_hdr: invalid ${config.S3_RDMA_TOKEN_HDR}: ${token}`,
                    `field ${i} length ${fields[i].length} expected ${CUOBJ_TOKEN_FIELDS[i].length}`);
                throw new S3Error(S3Error.InvalidArgument);
            }
        }
    }
    const size = parse_hex_number(fields[1]);
    return { desc: token, size, offset: 0 };

    // we don't need to parse the other token fields for now, keep for reference:
    // const addr = fields[0]; // string because uint64 does not fit in JS number
    // const key = parse_hex_number(fields[2]);
    // const lid = parse_hex_number(fields[3]);
    // const qp = parse_hex_number(fields[4]);
    // const has_gid = parse_hex_number(fields[5]) !== 0;
    // const gid = has_gid ? fields[6] : '';
}


/**
 * @param {nb.S3Request} req
 * @returns {nb.RdmaInfo|undefined}
 */
function parse_rdma_info(req) {
    const rdma_agent = http_utils.hdr_as_str(req.headers, config.S3_RDMA_AGENT_HDR);

    // rdma agent can be empty, in which case we assume it is cuobj by default
    if (!rdma_agent || rdma_agent === config.S3_RDMA_AGENT_CUOBJ) {
        const rdma_token_hdr = http_utils.hdr_as_str(req.headers, config.S3_RDMA_TOKEN_HDR);
        if (!rdma_token_hdr) return;
        return decode_cuobj_token_hdr(rdma_token_hdr);
    }

    dbg.error(`parse_rdma_info: unsupported ${config.S3_RDMA_AGENT_HDR}:`, rdma_agent);
    throw new S3Error(S3Error.InvalidArgument);
}

/**
 * @param {import('http').IncomingHttpHeaders} res_headers
 * @returns {nb.RdmaReply|undefined}
 */
function parse_rdma_reply(res_headers) {
    const rdma_reply_hdr = http_utils.hdr_as_str(res_headers, config.S3_RDMA_REPLY_HDR);
    const rdma_bytes_hdr = http_utils.hdr_as_str(res_headers, config.S3_RDMA_BYTES_HDR);
    if (!rdma_reply_hdr) {
        // no RDMA reply header, means RDMA not used
        return;
    }
    const status_code = Number(String(rdma_reply_hdr));
    if (status_code === 501) {
        // RDMA not supported by server, is a valid reply
        // should fallback to HTTP body transfer.
        // on GET this means the body will contain the object data.
        // on PUT this is an error since the object was not stored.
        return { status_code };
    }
    const num_bytes = Number(String(rdma_bytes_hdr));
    if (status_code >= 200 && status_code < 300 &&
        Number.isSafeInteger(num_bytes) && num_bytes >= 0) {
        // RDMA supported and successful
        return { status_code, num_bytes };
    }
    dbg.error('parse_rdma_reply: invalid reply headers',
        config.S3_RDMA_REPLY_HDR + ':', rdma_reply_hdr,
        config.S3_RDMA_BYTES_HDR + ':', rdma_bytes_hdr);
    throw new S3Error(S3Error.InvalidArgument);
}

/**
 * @param {import('http').OutgoingHttpHeaders} req_headers
 * @param {string|undefined} rdma_desc
 */
function set_rdma_request_headers(req_headers, rdma_desc) {
    if (!rdma_desc) return;
    req_headers[config.S3_RDMA_AGENT_HDR] = config.S3_RDMA_AGENT_CUOBJ;
    req_headers[config.S3_RDMA_TOKEN_HDR] = rdma_desc;
}

/**
 * @param {nb.S3Request|undefined} req
 * @param {nb.S3Response} res
 * @param {nb.RdmaInfo|undefined} rdma_info
 * @param {nb.RdmaReply|undefined} rdma_reply
 */
function set_rdma_response_headers(req, res, rdma_info, rdma_reply) {
    if (!rdma_info || !rdma_reply) return;
    res.setHeader(config.S3_RDMA_AGENT_HDR, config.S3_RDMA_AGENT_CUOBJ);
    res.setHeader(config.S3_RDMA_REPLY_HDR, rdma_reply.status_code.toString(10)); // decimal encoding
    res.setHeader(config.S3_RDMA_BYTES_HDR, rdma_reply.num_bytes.toString(10)); // decimal encoding
}


/////////////////
// RDMA SERVER //
/////////////////

let _rdma_server = null;

/**
 * @returns {nb.CuObjServerNapi}
 */
function s3_rdma_server() {
    if (!config.S3_RDMA_ENABLED) {
        throw new Error('config.S3_RDMA_ENABLED is not enabled');
    }
    if (_rdma_server) return _rdma_server;
    const { CuObjServerNapi } = nb_native();
    const ip = process.env.S3_RDMA_SERVER_IP || config.S3_RDMA_SERVER_IPS?.[0] || '172.16.0.61';
    _rdma_server = new CuObjServerNapi({
        ip,
        port: 0, // every fork will get a different port
        log_level: config.S3_RDMA_LOG_LEVEL,
        use_telemetry: config.S3_RDMA_USE_TELEMETRY,
        use_async_events: config.S3_RDMA_USE_ASYNC_EVENTS,
        dc_key: config.S3_RDMA_DC_KEY,
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
    if (nb_native().fs.gpfs?.rdma_enabled) {
        try {
            const ret_size = await writer.target_file.write_rdma(
                writer.fs_context,
                writer.offset,
                rdma_info.size,
                rdma_info.desc,
            );
            if (ret_size < 0) {
                throw new Error(`write_file_from_rdma: gpfs write_rdma failed ${ret_size}`);
            }
            return { status_code: 200, num_bytes: ret_size };
        } catch (err) {
            if (err.code === 'EOPNOTSUPP' || err.code === 'EINVAL') {
                dbg.log0(`RDMA direct from file returned ${err.code}, fallback to read`, err);
            } else {
                // throw any other error
                // TODO(guym) should we fallback on all errors?
                throw err;
            }
        }
    }

    const rdma_server = await s3_rdma_server();
    return await multi_buffer_pool.use_buffer(rdma_info.size, async buffer => {
        rdma_server.register_buffer(buffer);
        let client_buf_offset = 0;
        while (client_buf_offset < rdma_info.size) {
            abort_signal?.throwIfAborted();
            // transfer data from remote to our local buffer
            const ret_size = await rdma_server.rdma('PUT', 'FileWriter', buffer, 0, rdma_info.desc, client_buf_offset, buffer.length);
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
            client_buf_offset += ret_size;
        }
        abort_signal?.throwIfAborted();
        await writer.finalize();
        // console.log('GGG writer.total_bytes', writer.total_bytes);
        return { status_code: 200, size: client_buf_offset };
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
                throw new Error(`read_file_to_rdma gpfs_read_rdma failed ${ret_size}`);
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
 * @returns {nb.CuObjClientNapi}
 */
function new_rdma_client() {
    if (!config.S3_RDMA_ENABLED) {
        throw new Error('config.S3_RDMA_ENABLED is not enabled');
    }
    return new (nb_native().CuObjClientNapi)();
}

/**
 * @param {import('@aws-sdk/client-s3').S3ClientConfig} s3_config
 * @param {Buffer} client_buf
 * @param {nb.CuObjClientNapi} rdma_client
 * @returns {S3}
 */
function s3_rdma_client(s3_config, client_buf, rdma_client) {
    const s3 = new S3(s3_config);
    s3.middlewareStack.use(s3_rdma_client_plugin(client_buf, rdma_client));
    return s3;
}

/**
 * @param {Buffer} client_buf
 * @param {nb.CuObjClientNapi} rdma_client
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
 * @param {nb.CuObjClientNapi} rdma_client
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
        let op_type = 'GET';

        if (context.commandName === 'GetObjectCommand') {
            op_type = 'GET';
        } else if (context.commandName === 'PutObjectCommand') {
            op_type = 'PUT';
            // rdma_buf = input.Body; // TODO handle other body types?
            input.Body = undefined;
            request.headers['content-length'] = '0';
        } else if (context.commandName === 'UploadPartCommand') {
            op_type = 'PUT';
            // rdma_buf = input.Body; // TODO handle other body types?
            input.Body = undefined;
            request.headers['content-length'] = '0';
        } else {
            return next(args);
        }

        const ret_size = await rdma_client.rdma(
            op_type, client_buf, async (client_buf_desc, callback) => {
                try {
                    set_rdma_request_headers(request.headers, client_buf_desc);
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
            console.log('S3 RDMA: Return', ret_size, op_type, client_buf.length);
        }

        return result;
    };
}


// EXPORTS
exports.parse_rdma_info = parse_rdma_info;
exports.parse_rdma_reply = parse_rdma_reply;
exports.set_rdma_request_headers = set_rdma_request_headers;
exports.set_rdma_response_headers = set_rdma_response_headers;
// SERVER
exports.s3_rdma_server = s3_rdma_server;
exports.write_file_from_rdma = write_file_from_rdma;
exports.read_file_to_rdma = read_file_to_rdma;
// CLIENT
exports.new_rdma_client = new_rdma_client;
exports.s3_rdma_client = s3_rdma_client;
exports.s3_rdma_client_plugin = s3_rdma_client_plugin;
exports.s3_rdma_client_middleware = s3_rdma_client_middleware;
