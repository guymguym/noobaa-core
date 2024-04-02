/* Copyright (C) 2024 NooBaa */
'use strict';

const config = require('../../config');
const dbg = require('../util/debug_module')(__filename);
const s3_utils = require('../endpoint/s3/s3_utils');
const nb_native = require('../util/nb_native');
const { FSQueue } = require('../util/fs_queue');
const { get_process_fs_context } = require('../util/native_fs_utils');

/**
 * @typedef {import('../util/fs_queue').ConsumerBatch} ConsumerBatch 
 */

/**
 * 
 */
class GlacierBackend {

    /**
     * @returns {GlacierBackend}
     */
    static get() {
        if (GlacierBackend._backend) return GlacierBackend._backend;
        const backend_type = config.NSFS_GLACIER_BACKEND;
        if (backend_type === 'TAPECLOUD') {
            const { TapeCloudGlacierBackend } = require('./glacier_tapecloud');
            GlacierBackend._backend = new TapeCloudGlacierBackend();
            return GlacierBackend._backend;
        }
        throw new Error('invalid backend type provide');
    }

    // These names start with the word 'timestamp' so as to assure
    // that it acts like a 'namespace' for the these kind of files.
    //
    // It also helps in making sure that the persistent logger does not
    // confuses these files with the WAL files.
    static MIGRATE_TIMESTAMP_FILE = 'migrate.timestamp';
    static RESTORE_TIMESTAMP_FILE = 'restore.timestamp';
    static EXPIRY_TIMESTAMP_FILE = 'expiry.timestamp';

    /**
     * XATTR_RESTORE_REQUEST is set to a NUMBER (expiry days) by `restore_object` when 
     * a restore request is made. This is unset by the underlying restore process when 
     * it finishes the request, this  is to ensure that the same object is not queued 
     * for restoration multiple times.
     */
    static XATTR_RESTORE_REQUEST = 'user.noobaa.restore.request';

    /**
     * XATTR_RESTORE_EXPIRY is set to a ISO DATE by the underlying restore process or by
     * NooBaa (in case restore is issued again while the object is on disk).
     * This is read by the underlying "disk evict" process to determine if the object
     * should be evicted from the disk or not.
     * 
     * NooBaa will use this date to determine if the object is on disk or not, if the
     * expiry date is in the future, the object is on disk, if the expiry date is in
     * the past, the object is not on disk. This may or may not represent the actual
     * state of the object on disk, but is probably good enough for NooBaa's purposes
     * assuming that restore request for already restored objects fails gracefully.
     */
    static XATTR_RESTORE_EXPIRY = 'user.noobaa.restore.expiry';

    static STORAGE_CLASS_XATTR = 'user.storage_class';

    static MIGRATE_WAL_NAME = 'migrate';
    static RESTORE_WAL_NAME = 'restore';

    /** @type {nb.RestoreState} */
    static RESTORE_STATUS_CAN_RESTORE = 'CAN_RESTORE';
    /** @type {nb.RestoreState} */
    static RESTORE_STATUS_ONGOING = 'ONGOING';
    /** @type {nb.RestoreState} */
    static RESTORE_STATUS_RESTORED = 'RESTORED';


    async migrate(fs_context) {
        await this.queue().consumer().run({
            topic: GlacierBackend.MIGRATE_WAL_NAME,
            eachBatch: async ({ batch }) => this.migrate_batch(batch)
        });
    }

    async restore(fs_context) {
        await this.queue().consumer().run({
            topic: GlacierBackend.RESTORE_WAL_NAME,
            eachBatch: async ({ batch }) => this.restore_batch(batch)
        });
    }

    /**
     * @param {ConsumerBatch} batch 
     */
    async migrate_batch(batch) {
        throw new Error('Unimplementented');
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
        throw new Error('Unimplementented');
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

    /**
     * expiry moves the restored files back to glacier
     * 
     * NOTE: This needs to be implemented by each backend.
     * @param {nb.NativeFSContext} fs_context
     */
    async expiry(fs_context) {
        throw new Error('Unimplementented');
    }

    /**
     * low_free_space must return true if the backend has
     * low free space.
     * 
     * NOTE: This may be used as a precheck before executing
     * operations like `migrate` and `restore`.
     * 
     * Example: `migrate` can be more frequently if this function
     * returns `true`.
     * 
     * @returns {Promise<boolean>}
     */
    async low_free_space() {
        throw new Error('Unimplementented');
    }

    /**
     * should_migrate returns true if the given file must be migrated
     * 
     * The caller can pass the stat data, if none is passed, stat is
     * called internally.
     * @param {string} file name of the file
     * @param {nb.NativeFSStats} [stat]
     * @returns {Promise<boolean>}
     */
    async should_migrate(fs_context, file, stat) {
        if (!stat) {
            stat = await nb_native().fs.stat(fs_context, file, {
                xattr_get_keys: [
                    GlacierBackend.XATTR_RESTORE_REQUEST,
                    GlacierBackend.XATTR_RESTORE_EXPIRY,
                    GlacierBackend.STORAGE_CLASS_XATTR,
                ],
            });
        }

        // If there are no associated blocks with the file then skip
        // the migration.
        if (stat.blocks === 0) return false;

        const restore_status = GlacierBackend.get_restore_status(stat.xattr, new Date(), file);
        if (!restore_status) return false;

        return restore_status.state === GlacierBackend.RESTORE_STATUS_CAN_RESTORE;
    }

    /**
     * get_restore_status returns status of the object at the given
     * file_path
     * 
     * NOTE: Returns undefined if `user.storage_class` attribute is not
     * `GLACIER`
     * @param {nb.NativeFSXattr} xattr 
     * @param {Date} now 
     * @param {string} file_path 
     * @returns {nb.RestoreStatus | undefined}
     */
    static get_restore_status(xattr, now, file_path) {
        if (xattr[GlacierBackend.STORAGE_CLASS_XATTR] !== s3_utils.STORAGE_CLASS_GLACIER) return;

        // Total 6 states (2x restore_request, 3x restore_expiry)
        let restore_request;
        let restore_expiry;

        const restore_request_xattr = xattr[GlacierBackend.XATTR_RESTORE_REQUEST];
        if (restore_request_xattr) {
            const num = Number(restore_request_xattr);
            if (!isNaN(num) && num > 0) {
                restore_request = num;
            } else {
                dbg.error('unexpected value for restore request for', file_path);
            }
        }
        if (xattr[GlacierBackend.XATTR_RESTORE_EXPIRY]) {
            const expiry = new Date(xattr[GlacierBackend.XATTR_RESTORE_EXPIRY]);
            if (isNaN(expiry.getTime())) {
                dbg.error('unexpected value for restore expiry for', file_path);
            } else {
                restore_expiry = expiry;
            }
        }

        if (restore_request) {
            if (restore_expiry > now) {
                dbg.warn('unexpected restore state - (restore_request, request_expiry > now) for', file_path);
            }

            return {
                ongoing: true,
                state: GlacierBackend.RESTORE_STATUS_ONGOING,
            };
        } else {
            if (!restore_expiry || restore_expiry <= now) {
                return {
                    ongoing: false,
                    state: GlacierBackend.RESTORE_STATUS_CAN_RESTORE,
                };
            }

            return {
                ongoing: false,
                expiry_time: restore_expiry,
                state: GlacierBackend.RESTORE_STATUS_RESTORED,
            };
        }
    }

    /**
     * @param {Date} from
     * @param {Number} days - float
     * @param {string} date - in format HH:MM:SS
     * @param {'UTC' | 'LOCAL'} tz 
     * @returns {Date}
     */
    static generate_expiry(from, days, date, tz) {
        const expires_on = new Date(from);

        const days_dec = (days % 1);

        let hours = Math.round(days_dec * 24);
        let mins = 0;
        let secs = 0;

        const parsed = date.split(':');
        if (parsed.length === 3) {
            const parsed_hrs = Number(parsed[0]);
            if (Number.isInteger(parsed_hrs) && parsed_hrs < 24) {
                hours += parsed_hrs;
            }

            const parsed_mins = Number(parsed[1]);
            if (Number.isInteger(parsed_mins) && parsed_mins < 60) {
                mins = parsed_mins;
            }

            const parsed_secs = Number(parsed[2]);
            if (Number.isInteger(parsed_secs) && parsed_secs < 60) {
                secs = parsed_secs;
            }
        }

        if (tz === 'UTC') {
            expires_on.setUTCDate(expires_on.getUTCDate() + (days - days_dec));
            expires_on.setUTCHours(hours, mins, secs, 0);
        } else {
            expires_on.setDate(expires_on.getDate() + (days - days_dec));
            expires_on.setHours(hours, mins, secs, 0);
        }

        return expires_on;
    }

    /**
     * should_restore returns true if the give file must be restored
     * 
     * The caller can pass the stat data, if none is passed, stat is
     * called internally.
     * @param {string} file name of the file
     * @param {nb.NativeFSStats} [stat]
     * @returns {Promise<boolean>}
     */
    async should_restore(fs_context, file, stat) {
        if (!stat) {
            stat = await nb_native().fs.stat(fs_context, file, {
                xattr_get_keys: [
                    GlacierBackend.XATTR_RESTORE_REQUEST,
                    GlacierBackend.STORAGE_CLASS_XATTR,
                ],
            });
        }

        const restore_status = GlacierBackend.get_restore_status(stat.xattr, new Date(), file);
        if (!restore_status) return false;

        return restore_status.state === GlacierBackend.RESTORE_STATUS_ONGOING;
    }


    /**
     * @returns {FSQueue}
     */
    queue() {
        if (!this._queue) {
            this._queue = new FSQueue({
                dir: config.NSFS_GLACIER_LOGS_DIR,
                fs_context: get_process_fs_context(),
            });
        }
        return this._queue;
    }

}

/** @type {GlacierBackend} */
GlacierBackend._backend = null;

exports.GlacierBackend = GlacierBackend;
