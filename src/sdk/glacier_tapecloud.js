/* Copyright (C) 2024 NooBaa */
'use strict';

const os = require('os');
const path = require('path');
const events = require('events');
const { spawn } = require('child_process');
const { exec } = require('../util/os_utils');

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const nb_native = require('../util/nb_native');
const { GlacierBackend } = require('./glacier_backend');
const { NewlineReader, NewlineReaderEntry } = require('../util/file_reader');
const { get_process_fs_context } = require('../util/native_fs_utils');

const MIGRATE_SCRIPT = 'migrate';
const RECALL_SCRIPT = 'recall';
const TASK_SHOW_SCRIPT = 'task_show';
const PROCESS_EXPIRED_SCRIPT = 'process_expired';
const LOW_FREE_SPACE_SCRIPT = 'low_free_space';

const EEADM_ERROR_DUPLICATE_TASK = 'GLESM431E';

/**
 * @typedef {import('../util/fs_queue').ConsumerBatch} ConsumerBatch 
 */

/**
 * 
 */
class TapeCloudGlacierBackend extends GlacierBackend {

    /**
     * @param {ConsumerBatch} batch 
     */
    async migrate_batch(batch) {
        // open text file
        // await batch.forEach(async message => {
        // if (should_restore) {
        //      file.write
        // }
        // });
        // call eeadm
        // task show for failures
        // close text file
    }

    /**
     * @param {ConsumerBatch} batch 
     */
    async restore_batch(batch) {
        // open text file
        // await batch.forEach(async message => {
        // if (should_restore) {
        //      file.write
        // }
        // });
        // call eeadm
        // task show for failures
        // read the text file again
        // NewlineReader.forEach()
        // if (should_resubmit / had failure) {
        //      producer.send()
        // }
        // close text file

    }


    async migrate_entry_collector(fs_context, entry, batch_recorder, failure_recorder) {
        let should_migrate = true;
        try {
            should_migrate = await this.should_migrate(fs_context, entry);
        } catch (err) {
            if (err.code === 'ENOENT') {
                // Skip this file
                return;
            }

            dbg.log0(
                'adding log entry', entry,
                'to failure recorder due to error', err,
            );

            // Can't really do anything if this fails - provider
            // needs to make sure that appropriate error handling
            // is being done there
            await failure_recorder(entry);
            return;
        }

        // Skip the file if it shouldn't be migrated
        if (!should_migrate) return;

        // Can't really do anything if this fails - provider
        // needs to make sure that appropriate error handling
        // is being done there
        await batch_recorder(entry);
    }

    async migrate_batch_processor(fs_context, batch_log_file, failure_recorder) {
        // This will throw error only if our eeadm error handler
        // panics as well and at that point it's okay to
        // not handle the error and rather keep the log file around
        await this._migrate(batch_log_file, failure_recorder);
    }

    async restore_entry_collector(fs_context, entry, batch_recorder, failure_recorder) {
        try {
            const should_restore = await this.should_restore(fs_context, entry);
            if (!should_restore) {
                // Skip this file
                return;
            }

            // Add entry to the tempwal
            await batch_recorder(entry);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Skip this file
                return;
            }

            dbg.log0(
                'adding log entry', entry,
                'to failure recorder due to error', error,
            );
            await failure_recorder(entry);
        }
    }

    async restore_batch_processor(fs_context, batch_log_file, failure_recorder) {
        await this._recall(batch_log_file, failure_recorder);
    }

    async restore_entry_post_processor(fs_context, entry, batch_recorder, failure_recorder) {
        const reader = new NewlineReaderEntry(fs_context, entry);
        let fh = null;
        try {
            fh = await reader.open();

            const stat = await fh.stat(fs_context, {
                xattr_get_keys: [
                    GlacierBackend.XATTR_RESTORE_REQUEST,
                ]
            });

            const days = Number(stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST]);
            const expires_on = GlacierBackend.generate_expiry(
                new Date(),
                days,
                config.NSFS_GLACIER_EXPIRY_TIME_OF_DAY,
                config.NSFS_GLACIER_EXPIRY_TZ,
            );

            await fh.replacexattr(fs_context, {
                [GlacierBackend.XATTR_RESTORE_EXPIRY]: expires_on.toISOString(),
            }, GlacierBackend.XATTR_RESTORE_REQUEST);
        } catch (error) {
            dbg.error(`failed to process ${entry.path}`, error);
        } finally {
            if (fh) await fh.close(fs_context);
        }
    }

    async expiry(fs_context) {
        try {
            await this._process_expired();
        } catch (error) {
            dbg.error('unexpected error occured while running tapecloud.expiry:', error);
        }
    }

    async low_free_space() {
        const result = await exec(get_bin_path(LOW_FREE_SPACE_SCRIPT), { return_stdout: true });
        return result.toLowerCase() === 'true';
    }

    // ============= PRIVATE FUNCTIONS =============

    /**
     * _migrate should perform migration
     * 
     * NOTE: Must be overwritten for tests
     * @param {string} log_path 
     * @param {import("../util/persistent_logger").Recorder} recorder 
     */
    async _migrate(log_path, recorder) {
        return migrate(log_path, recorder);
    }

    /**
     * _recall should perform recall
     * 
     * NOTE: Must be overwritten for tests
     * @param {string} log_path 
     * @param {import("../util/persistent_logger").Recorder} recorder 
     */
    async _recall(log_path, recorder) {
        return recall(log_path, recorder);
    }

    /**
     * _process_expired should process expired objects
     * 
     * NOTE: Must be overwritten for tests
     */
    async _process_expired() {
        return process_expired();
    }
}

function get_bin_path(bin_name) {
    return path.join(config.NSFS_GLACIER_TAPECLOUD_BIN_DIR, bin_name);
}

/**
 * @param {*} task_id 
 * @param {(entry: string) => Promise<void>} recorder 
 */
async function record_failed_tasks(task_id, recorder) {
    const fs_context = get_process_fs_context();
    const tmp = path.join(os.tmpdir(), `eeadm_task_out_${Date.now()}`);

    let temp_fh = null;
    let reader = null;
    try {
        temp_fh = await nb_native().fs.open(fs_context, tmp, 'rw');

        const proc = spawn(get_bin_path(TASK_SHOW_SCRIPT), [task_id], {
            stdio: ['pipe', temp_fh.fd, temp_fh.fd],
        });

        const [errcode] = await events.once(proc, 'exit');
        if (errcode) {
            throw new Error('process exited with non-zero exit code:', errcode);
        }

        reader = new NewlineReader(fs_context, tmp);
        await reader.forEach(async line => {
            if (!line.startsWith("Fail")) return;

            const parsed = line.split(/\s+/);
            if (parsed.length !== 6) {
                throw new Error('failed to parse task show');
            }

            if (parsed[1] !== EEADM_ERROR_DUPLICATE_TASK) {
                // Column 5 is the filename (refer tapecloud [eeadm] manual)
                await recorder(parsed[5]);
            }

            return true;
        });
    } finally {
        if (temp_fh) {
            await temp_fh.close(fs_context);
            await nb_native().fs.unlink(fs_context, tmp);
        }

        if (reader) {
            await reader.close();
        }
    }
}

/**
 * tapecloud_failure_handler takes the error and runs task_show on the task
 * ID to identify the failed entries and record them to the recorder
 * @param {*} error 
 * @param {(entry: string) => Promise<void>} recorder 
 */
async function tapecloud_failure_handler(error, recorder) {
    const { stdout } = error;

    // Find the line in the stdout which has the line 'task ID is, <id>' and extract id
    const match = stdout.match(/task ID is (\d+)/);
    if (match.length !== 2) {
        throw error;
    }

    const task_id = match[1];

    // Fetch task status and see what failed
    await record_failed_tasks(task_id, recorder);
}

/**
 * migrate takes name of a file which contains the list
 * of the files to be migrated to tape.
 * 
 * The file should be in the following format: <filename>
 * 
 * The function returns the names of the files which failed
 * to migrate.
 * @param {string} file filename
 * @param {import("../util/persistent_logger").Recorder} recorder 
 */
async function migrate(file, recorder) {
    try {
        dbg.log1("Starting migration for file", file);
        const out = await exec(`${get_bin_path(MIGRATE_SCRIPT)} ${file}`, { return_stdout: true });
        dbg.log4("migrate finished with:", out);
        dbg.log1("Finished migration for file", file);
    } catch (error) {
        await tapecloud_failure_handler(error, recorder);
    }
}

/**
 * recall takes name of a file which contains the list
 * of the files to be recall to tape.
 * 
 * The file should be in the following format: <filename>
 * 
 * The function returns the names of the files which failed
 * to recall.
 * @param {string} file filename
 * @param {(entry: string) => Promise<void>} recorder 
 */
async function recall(file, recorder) {
    try {
        dbg.log1("Starting recall for file", file);
        const out = await exec(`${get_bin_path(RECALL_SCRIPT)} ${file}`, { return_stdout: true });
        dbg.log4("recall finished with:", out);
        dbg.log1("Finished recall for file", file);
    } catch (error) {
        await tapecloud_failure_handler(error, recorder);
    }
}

async function process_expired() {
    dbg.log1("Starting process_expired");
    const out = await exec(`${get_bin_path(PROCESS_EXPIRED_SCRIPT)}`, { return_stdout: true });
    dbg.log4("process_expired finished with:", out);
    dbg.log1("Finished process_expired");
}


exports.TapeCloudGlacierBackend = TapeCloudGlacierBackend;
