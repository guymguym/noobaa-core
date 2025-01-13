/* Copyright (C) 2024 NooBaa */

'use strict';

const stream = require('stream');
const config = require('../../config');
const nb_native = require('./nb_native');
const stream_utils = require('./stream_utils');
const native_fs_utils = require('./native_fs_utils');

/** @typedef {import('./buffer_utils').MultiSizeBuffersPool} MultiSizeBuffersPool */

/**
 * FileReader is a Readable stream that reads data from a filesystem file.
 * 
 * The Readable interface is easy to use, however, for us, it is not efficient enough 
 * because it has to allocate a new buffer for each chunk of data read from the file.
 * This allocation and delayed garbage collection becomes expensive in high throughputs
 * (which is something to improve in nodejs itself).
 * 
 * To solve this, we added the optimized method read_into_stream(target_stream) which uses 
 * a buffer pool to recycle the buffers and avoid the allocation overhead.
 * 
 * The target_stream should be a Writable stream that will not use the buffer after the 
 * write callback, since we will release the buffer back to the pool in the callback.
 */
class FileReader extends stream.Readable {

    /**
     * @param {{
     *      fs_context: nb.NativeFSContext,
     *      file: nb.NativeFile,
     *      file_path: string,
     *      start: number,
     *      end: number,
     *      stat: nb.NativeFSStats,
     *      multi_buffer_pool: MultiSizeBuffersPool,
     *      signal: AbortSignal,
     *      stats?: import('../sdk/endpoint_stats_collector').EndpointStatsCollector,
     *      bucket?: string,
     *      namespace_resource_id?: string,
     * }} params
     */
    constructor({ fs_context,
        file,
        file_path,
        start,
        end,
        stat,
        multi_buffer_pool,
        signal,
        stats,
        bucket,
        namespace_resource_id,
    }) {
        super({ highWaterMark: config.NFSF_DOWNLOAD_STREAM_MEM_THRESHOLD });
        this.fs_context = fs_context;
        this.file = file;
        this.file_path = file_path;
        this.start = start;
        this.end = end;
        this.stat = stat;
        this.multi_buffer_pool = multi_buffer_pool;
        this.signal = signal;
        this.stats = stats;
        this.stats_count_once = 1;
        this.bucket = bucket;
        this.namespace_resource_id = namespace_resource_id;
        this.num_bytes = 0;
        this.num_buffers = 0;
        this.log2_size_histogram = {};
    }

    /**
     * Readable stream implementation
     * @param {number} size 
     */
    async _read(size) {
        const buf = Buffer.allocUnsafe(size);
        const nread = await this.read_buffer(buf, 0, buf.length, null);
        if (nread === buf.length) {
            this.push(buf);
        } else if (nread > 0) {
            this.push(buf.subarray(0, nread));
        } else {
            this.push(null);
        }
    }

    /**
     * @param {Buffer} buf
     * @param {number} offset
     * @param {number} length
     * @param {number} file_pos
     * @returns {Promise<number>}
     */
    async read_buffer(buf, offset, length, file_pos) {
        this.signal.throwIfAborted();

        await this._warmup_sparse_file(file_pos);
        this.signal.throwIfAborted();

        const bytesRead = await this.file.read(this.fs_context, buf, offset, length, file_pos);
        if (bytesRead) this._update_stats(bytesRead);
        return bytesRead;
    }


    /**
     * Alternative implementation without using Readable stream API
     * This allows to use a buffer pool to avoid creating new buffers.
     * 
     * The target_stream should be a Writable stream that will not use the buffer after the
     * write callback, since we will release the buffer back to the pool in the callback.
     * This means Transforms should not be used as target_stream.
     * 
     * @param {stream.Writable} target_stream 
    */
    async read_into_stream(target_stream) {
        if (target_stream instanceof stream.Transform) {
            throw new Error('FileReader read_into_stream must be called with a Writable stream, not a Transform stream');
        }

        let buffer_pool_cleanup = null;
        let drain_promise = null;
        const end = Math.min(this.stat.size, this.end);

        try {

            for (let pos = this.start; pos < end;) {
                this.signal.throwIfAborted();

                await this._warmup_sparse_file(pos);
                this.signal.throwIfAborted();

                // allocate or reuse buffer
                // TODO buffers_pool and the underlying semaphore should support abort signal
                // to avoid sleeping inside the semaphore until the timeout while the request is already aborted.
                const remain_size = end - pos;
                const { buffer, callback } = await this.multi_buffer_pool.get_buffers_pool(remain_size).get_buffer();
                buffer_pool_cleanup = callback; // must be called ***IMMEDIATELY*** after get_buffer
                this.signal.throwIfAborted();

                // read from file
                const read_size = Math.min(buffer.length, remain_size);
                const bytesRead = await this.file.read(this.fs_context, buffer, 0, read_size, pos);
                if (!bytesRead) {
                    buffer_pool_cleanup = null;
                    callback();
                    break;
                }
                this.signal.throwIfAborted();

                const data = buffer.subarray(0, bytesRead);
                pos += bytesRead;
                this._update_stats(bytesRead);

                // wait for response buffer to drain before adding more data if needed -
                // this occurs when the output network is slower than the input file
                if (drain_promise) {
                    await drain_promise;
                    drain_promise = null;
                    this.signal.throwIfAborted();
                }

                // write the data out to response
                buffer_pool_cleanup = null; // cleanup is now in the socket responsibility
                const write_ok = target_stream.write(data, null, callback);
                if (!write_ok) {
                    drain_promise = stream_utils.wait_drain(target_stream, { signal: this.signal });
                    drain_promise.catch(() => undefined); // this avoids UnhandledPromiseRejection
                }
            }

            // wait for the last drain if pending.
            if (drain_promise) {
                await drain_promise;
                drain_promise = null;
                this.signal.throwIfAborted();
            }

        } finally {
            if (buffer_pool_cleanup) buffer_pool_cleanup();
        }
    }

    /**
     * @param {number} size 
     */
    _update_stats(size) {
        this.num_bytes += size;
        this.num_buffers += 1;
        const log2_size = Math.ceil(Math.log2(size));
        this.log2_size_histogram[log2_size] = (this.log2_size_histogram[log2_size] || 0) + 1;

        // update stats collector but count the entire read operation just once
        const count = this.stats_count_once;
        this.stats_count_once = 0; // counting the entire operation just once
        this.stats?.update_nsfs_write_stats({
            namespace_resource_id: this.namespace_resource_id,
            size,
            count,
            bucket_name: this.bucket,
        });
    }

    /**
     * @param {number} pos
     */
    async _warmup_sparse_file(pos) {
        if (!config.NSFS_BUF_WARMUP_SPARSE_FILE_READS) return;
        if (!native_fs_utils.is_sparse_file(this.stat)) return;
        await native_fs_utils.warmup_sparse_file(this.fs_context, this.file, this.file_path, this.stat, pos);
    }


}



class NewlineReaderFilePathEntry {
    constructor(fs_context, filepath) {
        this.fs_context = fs_context;
        this.path = filepath;
    }

    async open(mode = 'rw*') {
        return nb_native().fs.open(this.fs_context, this.path, mode);
    }
}

class NewlineReader {
    /**
     * NewlineReader allows to read a file line by line while at max holding one line + 4096 bytes
     * in memory.
     * @param {nb.NativeFSContext} fs_context 
     * @param {string} filepath 
     * @param {{
     *  lock?: 'EXCLUSIVE' | 'SHARED'
     *  bufsize?: number;
     *  skip_leftover_line?: boolean;
     *  skip_overflow_lines?: boolean;
     * }} [cfg]
     **/
    constructor(fs_context, filepath, cfg) {
        this.path = filepath;
        this.lock = cfg?.lock;
        this.skip_leftover_line = Boolean(cfg?.skip_leftover_line);
        this.skip_overflow_lines = Boolean(cfg?.skip_overflow_lines);

        this.fs_context = fs_context;
        this.fh = null;
        this.eof = false;
        this.readoffset = 0;

        this.buf = Buffer.alloc(cfg?.bufsize || 64 * 1024);
        this.start = 0;
        this.end = 0;
        this.overflow_state = false;
    }

    info() {
        return {
            path: this.path,
            read_offset: this.readoffset,
            overflow_state: this.overflow_state,
            start: this.start,
            end: this.end,
            eof: this.eof,
        };
    }

    /**
     * nextline returns the next line from the given file
     * @returns {Promise<string | null>}
     */
    async nextline() {
        if (!this.fh) await this.init();

        while (!this.eof) {
            // extract next line if terminated in current buffer
            if (this.start < this.end) {
                const term_idx = this.buf.subarray(this.start, this.end).indexOf(10);
                if (term_idx >= 0) {
                    if (this.overflow_state) {
                        console.warn('line too long finally terminated:', this.info());
                        this.overflow_state = false;
                        this.start += term_idx + 1;
                        continue;
                    }

                    const line = this.buf.toString('utf8', this.start, this.start + term_idx);
                    this.start += term_idx + 1;
                    return line;
                }
            }

            // relocate existing data to offset 0 in buf
            if (this.start > 0) {
                const n = this.buf.copy(this.buf, 0, this.start, this.end);
                this.start = 0;
                this.end = n;
            }

            // check limits
            if (this.buf.length <= this.end) {
                if (!this.skip_overflow_lines) {
                    throw new Error("line too long or non terminated");
                }

                console.warn('line too long or non terminated:', this.info());
                this.end = 0;
                this.start = 0;
                this.overflow_state = true;
            }

            // read from file
            const avail = this.buf.length - this.end;
            const read = await this.fh.read(this.fs_context, this.buf, this.end, avail, this.readoffset);
            if (!read) {
                this.eof = true;

                // what to do with the leftover in the buffer on eof
                if (this.end > this.start) {
                    if (this.skip_leftover_line) {
                        console.warn("leftover at eof:", this.info());
                    } else if (this.overflow_state) {
                        console.warn('line too long finally terminated at eof:', this.info());
                    } else {
                        const line = this.buf.toString('utf8', this.start, this.end);
                        return line;
                    }
                }

                return null;
            }
            this.readoffset += read;
            this.end += read;
        }

        return null;
    }

    /**
     * forEach takes a callback function and invokes it
     * with each line as parameter
     * 
     * The callback function can return `false` if it wants
     * to stop the iteration.
     * @param {(entry: string) => Promise<boolean>} cb 
     * @returns {Promise<[number, boolean]>}
     */
    async forEach(cb) {
        let entry = await this.nextline();
        let count = 0;
        while (entry !== null) {
            count += 1;
            if ((await cb(entry)) === false) return [count, false];

            entry = await this.nextline();
        }

        return [count, true];
    }

    /**
     * forEachFilePathEntry is a wrapper around `forEach` where each entry in
     * log file is assumed to be a file path and the given callback function
     * is invoked with that entry wrapped in a class with some convenient wrappers.
     * @param {(entry: NewlineReaderFilePathEntry) => Promise<boolean>} cb 
     * @returns {Promise<[number, boolean]>}
     */
    async forEachFilePathEntry(cb) {
        return this.forEach(entry => cb(new NewlineReaderFilePathEntry(this.fs_context, entry)));
    }

    // reset will reset the reader and will allow reading the file from
    // the beginning again, this does not reopens the file so if the file
    // was moved, this will still keep on reading from the previous FD.
    reset() {
        this.eof = false;
        this.readoffset = 0;
        this.start = 0;
        this.end = 0;
        this.overflow_state = false;
    }

    async init() {
        let fh = null;
        try {
            // here we are opening the file with both read and write to make sure
            // fcntlock can acquire both `EXCLUSIVE` as well as `SHARED` lock based
            // on the need.
            // If incompatible file descriptor and lock types are used then fcntl
            // throws `EBADF`.
            fh = await nb_native().fs.open(this.fs_context, this.path, '+');
            if (this.lock) await fh.fcntllock(this.fs_context, this.lock);

            this.fh = fh;
        } catch (error) {
            if (fh) await fh.close(this.fs_context);

            throw error;
        }
    }

    async close() {
        if (this.fh) await this.fh.close(this.fs_context);
    }
}

exports.FileReader = FileReader;
exports.NewlineReader = NewlineReader;
exports.NewlineReaderEntry = NewlineReaderFilePathEntry;
