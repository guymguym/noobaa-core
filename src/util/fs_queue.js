/* Copyright (C) 2023 NooBaa */
'use strict';

const path = require('path');
const nb_native = require('./nb_native');
const native_fs_utils = require('./native_fs_utils');
const dbg = require('./debug_module')(__filename);
const P = require('./promise');
const KeysLock = require('./keys_lock');
// const Semaphore = require('./semaphore');
const { NewlineReader } = require('./file_reader');

const CURRENT_FILE_NAME = 'current.log';
const QUEUE_FILES_PATTERN = /^queue[.][\\d]+[.]log$/;

/**
 * @typedef {{
 *      dir: string; 
 *      fs_context: nb.NativeFSContext,
 *      poll_interval?: number;
 *      disable_locking?: boolean;
 *      disable_sync_io?: boolean;
 * }} QueueSpec
 */

/**
 * @typedef {(
 *       message: object,
 * ) => Promise<void>} ConsumerMessageCallback
 * 
 * @typedef {{
 *      forEach: (eachMessage: ConsumerMessageCallback) => Promise<void>;
 * }} ConsumerBatch
 * 
 * @typedef {{
 *       fs_context: nb.NativeFSContext;
 *       batch: ConsumerBatch;
 *       resubmit_message: () => void;
 * }} ConsumerBatchCallbackArgs
 * 
 * @typedef {(
 *      args: ConsumerBatchCallbackArgs
 * ) => Promise<void>} ConsumerBatchCallback
 * 
 */

/**
 * This module is a utility of producer-consumer queue,
 * using append logs on shared filesystem.
 * 
 * The API is modeled like a Kafka Queue, and the implementation is modeled
 * after linux/posix append logs guarantees.
 * 
 * Multiple producers can append messages to the current file in parallel,
 * and can also do that from different processes/nodes assuming that the
 * filesystem is posix compliant and shared/clustered over these nodes.
 * The producer will monitor if the current file is missing or renamed and will
 * create a new current file as needed. In addition it will hold a shared file
 * lock to prevent consuming the file as long as it is still open by the producer.
 * 
 * The consumer will queue the current log file by renaming it which adds it
 * to the pending queue of logs to be consumed. The consumer then reads the queued
 * files, takes exclusive locks to make sure the producers closed their handles first,
 * and then processes the messages.
 * 
 * The directory structure of the queue is as follows:
 *      /dir/topic1/current.log
 *      /dir/topic1/queue.111.log
 *      /dir/topic1/queue.222.log
 *      /dir/topic2/current.log
 *      /dir/topic2/queue.111.log
 *      /dir/topic2/queue.222.log
 * 
 * @see https://kafka.js.org
 * @see https://pvk.ca/Blog/2021/01/22/appending-to-a-log-an-introduction-to-the-linux-dark-arts/
 * 
 * Limitations:
 *   - WAL should ideally use DirectIO to avoid fsyncgate (this does not)
 *   - Refer: [Can applications recover from fsync failures?](https://ramalagappan.github.io/pdfs/papers/cuttlefs.pdf)
 *   - Cannot recover from bit rot (Use RAID or something).
 * 
 * @example
 * const queue = new FSQueue({ ... });
 * 
 * const producer = queue.producer();
 * await producer.connect();
 * await producer.send({
 *      topic: 'topic1',
 *      messages: [
 *          { ... },
 *          { ... },
 *      ]
 * });
 * await producer.disconnect();
 * 
 * const consumer = queue.consumer();
 * await consumer.run({
 *      topic: 'topic1',
 *      eachMessage: () => {},
 *      eachBatch: () => {},
 * });
 */
class FSQueue {
    /** 
     * @param {QueueSpec} spec
     */
    constructor({ dir, fs_context, poll_interval, disable_locking, disable_sync_io }) {
        this.dir = dir;
        this.fs_context = fs_context;
        this.poll_interval = poll_interval;
        this.disable_locking = disable_locking;
        this.disable_sync_io = disable_sync_io;
        Object.freeze(this);
    }

    producer() {
        return new_producer(this);
    }

    consumer() {
        return new_consumer(this);
    }

    /**
     * @param {string} topic 
     */
    async _enqueue_current_file(topic) {
        const current_path = path.join(this.dir, topic, CURRENT_FILE_NAME);
        const queue_path = path.join(this.dir, topic, `queue.${Date.now()}.log`);

        try {
            await nb_native().fs.rename(this.fs_context, current_path, queue_path);
        } catch (error) {
            dbg.warn('FSQueue._enqueue_current_file: rename failed:', current_path, queue_path, error);
        }
    }

    /**
     * @param {string} topic 
     * @returns {Promise<import('fs').Dirent[]>}
     */
    async _get_queue_files(topic) {
        const queue_dir = path.join(this.dir, topic);

        try {
            const files = await nb_native().fs.readdir(this.fs_context, queue_dir);
            return files
                .sort((a, b) => a.name.localeCompare(b.name)) // TODO use number sort
                .filter(f =>
                    QUEUE_FILES_PATTERN.test(f.name) &&
                    !native_fs_utils.isDirectory(f)
                );
        } catch (error) {
            dbg.warn('FSQueue._get_queue_files: readdir failed:', queue_dir, error);
            return [];
        }
    }
}

/**
 * Producer for FSQueue for multi-process message sending.
 */
class Producer {

    /**
     * @param {FSQueue} queue
     */
    constructor(queue) {
        this.queue = queue;
        this.topic_locks = new KeysLock();
        this.fh = null;
        this.fh_stat = null;
        this.local_size = 0;
    }

    async connect() {
        this.timer = this.queue.poll_interval ?
            setTimeout(() => this._poll_file_change(), this.queue.poll_interval).unref() :
            null;
        // TODO make lazy connect
    }

    async disconnect() {
        clearTimeout(this.timer);
        this._close();
        // TODO
    }

    /**
     * @param {{
     *      topic: string;
     *      messages: object[];
     * }} arg
     */
    async send({ topic, messages }) {
        const fh = await this._init(topic);
        const { buffers, total_size } = this._encode_messages(messages);
        await fh.writev(this.queue.fs_context, buffers);
        this.local_size += total_size;
    }

    /**
     * 
     * @param {object[]} messages 
     * @returns {{
     *      buffers: Buffer[];
     *      total_size: number;
     * }}
     */
    _encode_messages(messages) {
        const NEW_LINE_BUFFER = Buffer.from('\n');
        const buffers = [];
        buffers.length = messages.length * 2;
        let i = 0;
        let total_size = 0;
        for (const msg of messages) {
            const data_object = { m: msg, t: Date.now() };
            const data_buffer = Buffer.from(JSON.stringify(data_object));
            buffers[i] = data_buffer;
            buffers[i + 1] = NEW_LINE_BUFFER;
            i += 2;
            total_size += data_buffer.length + NEW_LINE_BUFFER.length;
        }
        return { buffers, total_size };
    }


    /**
     * @param {string} topic
     * @returns {Promise<nb.NativeFile>}
     */
    async _init(topic) {
        if (this.fh) return this.fh;

        return this.topic_locks.surround_keys([topic], async () => {
            if (this.fh) return this.fh;

            const total_retries = 10;
            const backoff = 5;

            for (let retries = 0; retries < total_retries; retries++) {
                let fh = null;
                try {
                    // Open mode = O_APPEND | O_SYNC - sync is needed to prevent data loss on nodes crash.
                    const open_mode = this.no_fsync ? 'a' : 'as';
                    fh = await nb_native().fs.open(this.fs_context, this.current_path, open_mode);
                    if (this.no_flock) await fh.flock(this.fs_context, 'SHARED');
                    const fh_stat = await fh.stat(this.fs_context);
                    const path_stat = await nb_native().fs.stat(this.fs_context, this.current_path);

                    if (fh_stat.ino === path_stat.ino && fh_stat.nlink > 0) {
                        this.fh = fh;
                        this.local_size = 0;
                        this.fh_stat = fh_stat;

                        // Prevent closing the fh if we succedded in the init
                        fh = null;

                        return this.fh;
                    }

                    dbg.log0(
                        'failed to init active log file, retry:', retries + 1,
                        'current path:', this.current_path,
                    );
                    await P.delay(backoff * (1 + Math.random()));
                } catch (error) {
                    dbg.log0(
                        'an error occured during init:', error,
                        'current path:', this.current_path,
                    );
                    throw error;
                } finally {
                    if (fh) await fh.close(this.fs_context);
                }
            }

            dbg.log0(
                'init retries exceeded, total retries:',
                total_retries,
                'current path:', this.current_path,
            );
            throw new Error('init retries exceeded');
        });
    }

    async _close() {
        const fh = this.fh;

        this.fh = null;
        this.fh_stat = null;
        this.local_size = 0;

        // TODO GUYM cannot clear the interval because close() is called from poll
        // clearInterval(this.interval);
        // this.interval = null;

        try {
            if (fh) await fh.close(this.fs_context);
        } catch (error) {
            // ignore
        }
    }

    async delete_current() {
        try {
            await nb_native().fs.unlink(this.fs_context, this.current_path);
        } catch (error) {
            // ignore
        }
    }

    async _poll_file_change() {
        // Lock to avoid race with init process - Can happen if arogue/misconfigured
        // process is continuously moving the active file
        await this.init_lock.surround(async () => {
            try {
                const stat = await nb_native().fs.stat(this.fs_context, this.current_path);
                // If the file has changed, re-init
                if (stat.ino !== this.fh_stat.ino) {
                    dbg.log1('active file changed, closing log:', this.current_path);
                    await this.close();
                }
            } catch (error) {
                if (error.code === 'ENOENT') {
                    dbg.log1('active file removed, closing log:', this.current_path);
                    await this.close();
                }
            }
        });
    }
}

/**
 * Consumer for FSQueue for safe consumption of the queue messages.
 */
class Consumer {

    /**
     * @param {FSQueue} queue 
     */
    constructor(queue) {
        this.queue = queue;
    }

    async subscribe() {
        // TODO
    }

    /**
     * 
     * @param {{
     *      topic: string;
     *      eachBatch: ConsumerBatchCallback;
     * }} arg
     */
    async run({ topic, eachBatch }) {

        try {

            await this.queue._enqueue_current_file(topic);

            const queue_files = await this.queue._get_queue_files(topic);

            for (const queue_file of queue_files) {
                await this._process_queue_file({ topic, eachBatch, queue_file });
            }

        } catch (err) {
            console.error('process_logs failed', dir, base_name, err);

        }
    }


    /**
     * process_log takes 2 functions, first function iterates over the log file
     * line by line and can choose to add some entries to a batch and then the second
     * function will be invoked to a with a path to the persistent log.
     * 
     * 
     * The fact that this function allows easy iteration and then later on optional consumption
     * of that batch provides the ability to invoke this funcition recursively composed in whatever
     * order that is required.
     * @param {{
     *      topic: string;
     *      eachBatch: ConsumerBatchCallback;
     *      queue_file: import('fs').Dirent,
     * }} arg
     * @returns {Promise<boolean>}
     */
    async _process_queue_file({ topic, eachBatch, queue_file }) {
        const queue_path = path.join(this.queue.dir, topic, queue_file.name);
        let reader = null;

        try {

            dbg.log1('Processing', queue_path);
            reader = new NewlineReader(this.queue.fs_context, queue_path, 'EXCLUSIVE');

            /** @type {ConsumerBatch} */
            const batch = {
                async forEach(eachMessage) {
                    return reader.forEach(async line => {
                        const message = this._decode_message(line);
                        await eachMessage(message);
                        return true; // true means keep iterating
                    });
                }
            };

            const is_done = await eachBatch({ batch });
            if (is_done) {
                await nb_native().fs.unlink(this.queue.fs_context, queue_path);
            }

            return true;

        } catch (error) {
            dbg.error('unexpected error in consuming log file:', queue_path);
            throw error; // bubble the error to the caller

        } finally {
            if (reader) await reader.close();
        }
    }

    _decode_message(line) {
        // TODO handle parse errors
        const data_object = JSON.parse(line);
        return data_object.m;
    }
}

function new_producer(queue) {
    return new Producer(queue);
}

function new_consumer(queue) {
    return new Consumer(queue);
}

exports.FSQueue = FSQueue;
