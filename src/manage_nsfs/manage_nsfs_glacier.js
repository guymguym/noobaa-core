/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const native_fs_utils = require('../util/native_fs_utils');
const { GlacierBackend, getGlacierBackend } = require('../sdk/glacier_backend');

const CLUSTER_LOCK = 'cluster.lock';
const SCAN_LOCK = 'scan.lock';

async function process_migrations() {
    const fs_context = native_fs_utils.get_process_fs_context();

    await lock_and_run(fs_context, CLUSTER_LOCK, async () => {
        const backend = getGlacierBackend();

        const is_low_free_space = await backend.low_free_space();
        const is_time_exceeded = await time_exceeded(
            fs_context,
            config.NSFS_GLACIER_MIGRATE_INTERVAL,
            GlacierBackend.MIGRATE_TIMESTAMP_FILE,
        );
        if (!is_low_free_space && !is_time_exceeded) return;

        await backend.migrate(fs_context);
        await record_current_time(fs_context, GlacierBackend.MIGRATE_TIMESTAMP_FILE);
    });
}

async function process_restores() {
    const fs_context = native_fs_utils.get_process_fs_context();

    await lock_and_run(fs_context, CLUSTER_LOCK, async () => {
        const backend = getGlacierBackend();

        const is_low_free_space = await backend.low_free_space();
        if (is_low_free_space) return;

        const is_time_exceeded = await time_exceeded(
            fs_context,
            config.NSFS_GLACIER_RESTORE_INTERVAL,
            GlacierBackend.RESTORE_TIMESTAMP_FILE,
        );
        if (!is_time_exceeded) return;

        await backend.restore(fs_context);
        await backend.queue().consumer().run({
            topic: GlacierBackend.RESTORE_WAL_NAME,
            eachBatch: async ({ batch }) => backend.restore_batch(batch)
        });

        await record_current_time(fs_context, GlacierBackend.RESTORE_TIMESTAMP_FILE);
    });
}

async function process_expiry() {
    const fs_context = native_fs_utils.get_process_fs_context();

    await lock_and_run(fs_context, SCAN_LOCK, async () => {
        const backend = getGlacierBackend();

        const is_time_exceeded = await time_exceeded(
            fs_context,
            config.NSFS_GLACIER_EXPIRY_INTERVAL,
            GlacierBackend.EXPIRY_TIMESTAMP_FILE,
        );
        if (!is_time_exceeded) return;

        await backend.expiry(fs_context);
        await record_current_time(fs_context, GlacierBackend.EXPIRY_TIMESTAMP_FILE);
    });
}

/**
 * time_exceeded returns true if the time between last run recorded in the given
 * timestamp_file and now is greater than the given interval.
 * @param {nb.NativeFSContext} fs_context 
 * @param {number} interval 
 * @param {string} timestamp_file 
 * @returns {Promise<boolean>}
 */
async function time_exceeded(fs_context, interval, timestamp_file) {
    try {
        const { data } = await nb_native().fs.readFile(fs_context, path.join(config.NSFS_GLACIER_LOGS_DIR, timestamp_file));
        const lastrun = new Date(data.toString());

        if (lastrun.getTime() + interval < Date.now()) return true;
    } catch (error) {
        console.error('failed to read last run timestamp:', error, 'timestamp_file:', timestamp_file);
        if (error.code === 'ENOENT') return true;

        throw error;
    }

    return false;
}

/**
 * record_current_time stores the current timestamp in ISO format into
 * the given timestamp file
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} timestamp_file 
 */
async function record_current_time(fs_context, timestamp_file) {
    await nb_native().fs.writeFile(
        fs_context,
        path.join(config.NSFS_GLACIER_LOGS_DIR, timestamp_file),
        Buffer.from(new Date().toISOString()),
    );
}


/**
 * lock_and_run acquires a flock and calls the given callback after
 * acquiring the lock
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} lockfilename
 * @param {Function} cb 
 */
async function lock_and_run(fs_context, lockfilename, cb) {
    const lockfd = await nb_native().fs.open(fs_context, path.join(config.NSFS_GLACIER_LOGS_DIR, lockfilename), 'w');

    try {
        await lockfd.flock(fs_context, 'EXCLUSIVE');
        await cb();
    } finally {
        await lockfd.close(fs_context);
    }
}

exports.process_migrations = process_migrations;
exports.process_restores = process_restores;
exports.process_expiry = process_expiry;
