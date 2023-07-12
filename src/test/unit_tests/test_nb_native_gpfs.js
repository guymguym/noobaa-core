/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const mocha = require('mocha');
const assert = require('assert');
const nb_native = require('../../util/nb_native');
const fs_utils = require('../../util/fs_utils');

const FS_CONTEXT = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: 'GPFS',
    warn_threshold_ms: 100,
};

mocha.describe('nb_native fs', function() {

    mocha.it('gpfs linkat - success', async function() {
        const { open } = nb_native().fs;
        const dir_path = '/gpfs/gpfs1/';
        const PATH = `link_success${Date.now()}_1`;
        const full_path = dir_path + PATH;

        const temp_file = await open(FS_CONTEXT, dir_path, 'wt');
        await temp_file.linkfileat(FS_CONTEXT, full_path);
        await temp_file.close(FS_CONTEXT);
        await fs_utils.file_must_exist(full_path);

    });

    mocha.it('gpfs linkat - success', async function() {
        const { open } = nb_native().fs;
        const dir_path = '/gpfs/gpfs1/';
        const PATH = `unlink${Date.now()}_2`;
        const full_path = dir_path + PATH;

        await create_file(full_path);
        const p2_file = await open(FS_CONTEXT, full_path);

        const temp_file = await open(FS_CONTEXT, dir_path, 'wt');
        await temp_file.linkfileat(FS_CONTEXT, full_path, p2_file.fd);
        await temp_file.close(FS_CONTEXT);
        await p2_file.close(FS_CONTEXT);
        await fs_utils.file_must_exist(full_path);

    });

    mocha.it('gpfs linkat - failure', async function() {
        const { open } = nb_native().fs;
        const dir_path = '/gpfs/gpfs1/';
        const PATH = `unlink${Date.now()}_2`;
        const full_path = dir_path + PATH;

        await create_file(full_path);
        const p2_file = await open(FS_CONTEXT, full_path);
        const temp_file = await open(FS_CONTEXT, dir_path, 'wt');
        try {
            await temp_file.linkfileat(FS_CONTEXT, full_path, p2_file.fd);
        } catch (err) {
            assert.equal(err.code, 'EEXIST');
        }
        await temp_file.close(FS_CONTEXT);
        await p2_file.close(FS_CONTEXT);
    });

    mocha.it('gpfs unlinkat - failure - verified fd = 0', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const full_p = dir_path + PATH1;

        await create_file(full_p);
        const dir_file = await nb_native().fs.open(FS_CONTEXT, dir_path);
        try {
            await dir_file.unlinkfileat(FS_CONTEXT, PATH1);
        } catch (err) {
            assert.equal(err.code, 'EINVAL');
        } finally {
            await dir_file.close(FS_CONTEXT);
        }
        await fs_utils.file_must_exist(full_p);
        });

    mocha.it('gpfs unlinkat - success - gpfs verification', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const full_p = dir_path + PATH1;

        await create_file(full_p);
        const dir_file = await nb_native().fs.open(FS_CONTEXT, dir_path);
        const file = await nb_native().fs.open(FS_CONTEXT, full_p);
        await dir_file.unlinkfileat(FS_CONTEXT, PATH1, file.fd);
        await fs_utils.file_must_not_exist(full_p);
        await dir_file.close(FS_CONTEXT);
        await file.close(FS_CONTEXT);
    });

    mocha.it('gpfs unlink - failure EEXIST', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const PATH2 = `unlink${Date.now()}_2`;
        const full_p = dir_path + PATH1;
        const full_p2 = dir_path + PATH2;

        await create_file(full_p);
        await create_file(full_p2);
        const dir_file = await nb_native().fs.open(FS_CONTEXT, dir_path);
        const file = await nb_native().fs.open(FS_CONTEXT, full_p);
        const file2 = await nb_native().fs.open(FS_CONTEXT, full_p2);
        await file2.linkfileat(FS_CONTEXT, full_p);
        try {
            await dir_file.unlinkfileat(FS_CONTEXT, PATH1, file.fd);
        } catch (err) {
            assert.equal(err.code, 'EEXIST');
            await fs_utils.file_must_exist(full_p);
        } finally {
            await file2.close(FS_CONTEXT);
            await file.close(FS_CONTEXT);
            await dir_file.close(FS_CONTEXT);
        }
    });

    // non existing throw invalid argument
    mocha.it('gpfs unlink - failure EINVAL', async function() {
        const dir_path = '/gpfs/gpfs1/';
        const PATH1 = `unlink${Date.now()}_1`;
        const full_p = dir_path + PATH1;
        await create_file(full_p);
        const dir_file = await nb_native().fs.open(FS_CONTEXT, dir_path);
        try {
            await dir_file.unlinkfileat(FS_CONTEXT, PATH1, 135); // 135
        } catch (err) {
            assert.equal(err.code, 'EINVAL');
        } finally {
            await dir_file.close(FS_CONTEXT);
        }
        await fs_utils.file_must_exist(full_p);
    });
});

function create_file(file_path) {
    return fs.promises.appendFile(file_path, file_path + '\n');
}
