/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const mocha = require('mocha');
const assert = require('assert');
const nb_native = require('../../util/nb_native');
const fs_utils = require('../../util/fs_utils');

const FS_CONTEXT = {
    warn_threshold_ms: 100,
};
const MAC_PLATFORM = 'darwin';

mocha.describe('nb_native fs', function() {

    mocha.describe('stat', function() {
        mocha.it('works', async function() {
            const path = 'package.json';
            const res = await nb_native().fs.stat(FS_CONTEXT, path);
            const res2 = await fs.promises.stat(path);
            // birthtime in non mac platforms is ctime
            //https://nodejs.org/api/fs.html#statsbirthtime
            if (process.platform !== MAC_PLATFORM) {
                res2.birthtime = res2.ctime;
                res2.birthtimeMs = res2.ctimeMs;
            }
            assert.deepStrictEqual(
                _.omit(res, 'xattr', 'mtimeNsBigint', 'atimeNsBigint', 'ctimeNsBigint'), // we need to remove xattr, mtimeSec, mtimeNsec from fs_napi response as the node JS stat doesn't return them
                _.omitBy(res2, v => typeof v === 'function'),
            );
        });
    });

    mocha.describe('lstat', function() {
        mocha.it('works', async function() {
            const path = 'package.json';
            const res = await nb_native().fs.stat(FS_CONTEXT, path, { use_lstat: true });
            const res2 = await fs.promises.stat(path);
            // birthtime in non mac platforms is ctime
            // https://nodejs.org/api/fs.html#statsbirthtime
            if (process.platform !== MAC_PLATFORM) {
                res2.birthtime = res2.ctime;
                res2.birthtimeMs = res2.ctimeMs;
            }
            assert.deepStrictEqual(
                _.omit(res, 'xattr', 'mtimeNsBigint', 'atimeNsBigint', 'ctimeNsBigint'), // we need to remove xattr, mtimeSec, mtimeNsec from fs_napi response as the node JS stat doesn't return them
                _.omitBy(res2, v => typeof v === 'function'),
            );
        });
    });

    mocha.describe('Readdir', function() {
        mocha.it('works', async function() {
            const { readdir } = nb_native().fs;
            const r = await readdir(FS_CONTEXT, '.');
            console.log('JEINA THIS IS DIR', r, r.length);
        });
        mocha.it('works FS', async function() {
            const { readdir } = fs.promises;
            const r = await readdir('.', { withFileTypes: true });
            console.log('JEINA THIS IS FS DIR', r, r.length);
        });

    });

    mocha.describe('Readdir DIRWRAP', function() {
        mocha.it('works', async function() {
            const { opendir } = nb_native().fs;
            const r = await opendir(FS_CONTEXT, '.');
            let dir = await r.read(FS_CONTEXT);
            while (dir) {
                console.log('JEINA THIS IS DIR', dir);
                dir = await r.read(FS_CONTEXT);
            }
            await r.close(FS_CONTEXT);
        });

        mocha.it('works FS', async function() {
            const { opendir } = fs.promises;
            const r = await opendir('.');
            let dir = await r.read();
            while (dir) {
                console.log('JEINA THIS IS DIR FS', dir);
                dir = await r.read();
            }
            await r.close();
        });
    });

    mocha.describe('FileWrap Getxattr, Replacexattr', function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key': 'value' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const xattr_res = (await tmpfile.stat(FS_CONTEXT)).xattr;
            tmpfile.close(FS_CONTEXT);
            assert.deepEqual(xattr_obj, xattr_res);
        });
    });

    mocha.describe('FileWrap Getxattr, Replacexattr clear prefixes override', function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const xattr_res1 = (await tmpfile.stat(FS_CONTEXT)).xattr;
            const set_options = { 'user.key3': 'value3' };
            const clear_prefix = 'user.key1';
            await tmpfile.replacexattr(FS_CONTEXT, set_options, clear_prefix);
            const xattr_res2 = (await tmpfile.stat(FS_CONTEXT)).xattr;
            tmpfile.close(FS_CONTEXT);
            assert.deepEqual(xattr_obj, xattr_res1);
            assert.deepEqual({ 'user.key2': 'value2', 'user.key3': 'value3' }, xattr_res2);

        });
    });


    mocha.describe('FileWrap Getxattr, Replacexattr clear prefixes add xattr - no clear', function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const xattr_res1 = (await tmpfile.stat(FS_CONTEXT)).xattr;
            const set_options = { 'user.key3': 'value3' };
            await tmpfile.replacexattr(FS_CONTEXT, set_options);
            const xattr_res2 = (await tmpfile.stat(FS_CONTEXT)).xattr;
            tmpfile.close(FS_CONTEXT);
            assert.deepEqual(xattr_obj, xattr_res1);
            assert.deepEqual({ ...xattr_obj, ...set_options }, xattr_res2);

        });
    });


    mocha.describe('FileWrap GetSinglexattr', function() {
        mocha.it('get single existing xattr', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const xattr_res = await nb_native().fs.getsinglexattr(FS_CONTEXT, PATH, 'user.key11');
            tmpfile.close(FS_CONTEXT);
            assert.deepEqual(xattr_obj['user.key11'], xattr_res);

        });

        mocha.it('get single not existing xattr', async function() {
            let error_message = 'No data available';
            if (process.platform === MAC_PLATFORM) {
                error_message = 'Attribute not found';
            }
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            try {
                await nb_native().fs.getsinglexattr(FS_CONTEXT, PATH, 'user.key12');
                assert.fail('should have failed with No data availble - xattr doesnt exist');
            } catch (err) {
                // err.code ENODATA not availble in libuv, comparing by err.message
                // opened https://github.com/libuv/libuv/issues/3795 to track it
                assert.equal(err.message, error_message);
            } finally {
                tmpfile.close(FS_CONTEXT);
            }
        });

        mocha.it('stat -  not existing xattr', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const res = await nb_native().fs.stat(FS_CONTEXT, PATH, { skip_user_xattr: true });
            tmpfile.close(FS_CONTEXT);
            console.log(res);
        });
    });

    mocha.describe('Stat with xattr', function() {
        mocha.it('get xattr with FileWrap Stat', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const stat_res = await tmpfile.stat(FS_CONTEXT);
            tmpfile.close(FS_CONTEXT);
            assert.deepEqual(xattr_obj, stat_res.xattr);
        });

        mocha.it('get xattr with FS Stat', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const stat_res = await nb_native().fs.stat(FS_CONTEXT, PATH);
            tmpfile.close(FS_CONTEXT);
            assert.deepEqual(xattr_obj, stat_res.xattr);
        });

        mocha.it('get xattr with FS Stat with only basic attributes', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(FS_CONTEXT, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.content_md5': 'md5' };
            await tmpfile.replacexattr(FS_CONTEXT, xattr_obj);
            const stat_res = await nb_native().fs.stat(FS_CONTEXT, PATH, { skip_user_xattr: true });
            tmpfile.close(FS_CONTEXT);
            assert.deepEqual({ 'user.content_md5': 'md5' }, stat_res.xattr);
        });
    });


    mocha.describe('Safe link/unlink', function() {
        mocha.it('safe link - success', async function() {
            const { safe_link } = nb_native().fs;
            const PATH1 = `/tmp/safe_link${Date.now()}_1`;
            const PATH2 = `/tmp/safe_link${Date.now()}_2`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(FS_CONTEXT, PATH1);
            console.log('link success - stat res: ', res1);
            await safe_link(FS_CONTEXT, PATH1, PATH2, res1.mtimeNsBigint, res1.ino);
            const res2 = await nb_native().fs.stat(FS_CONTEXT, PATH2);
            assert.deepEqual(res1.ino, res2.ino);
            assert.deepEqual(res1.mtimeNsBigint, res2.mtimeNsBigint);
            await fs_utils.file_delete(PATH1);
            await fs_utils.file_delete(PATH2);
        });


        mocha.it('safe link - failure', async function() {
            const { safe_link } = nb_native().fs;
            const PATH1 = `/tmp/safe_link${Date.now()}_1`;
            const PATH2 = `/tmp/safe_link${Date.now()}_2`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(FS_CONTEXT, PATH1);
            console.log('link failure - stat res: ', res1);
            const fake_ino = 12345678;

            try {
                await safe_link(FS_CONTEXT, PATH1, PATH2, res1.mtimeNsBigint, fake_ino);
                await nb_native().fs.stat(FS_CONTEXT, PATH2);
                await fs_utils.file_delete(PATH2);
                assert.fail('should have failed');
            } catch (err) {
                const actual_err_msg = err.message;
                assert.equal(actual_err_msg, 'FS::SafeLink ERROR link target doesn\'t match expected inode and mtime');
                await fs_utils.file_must_exist(PATH1);
            }
            await fs_utils.file_delete(PATH1);
        });

        mocha.it('safe unlink - success', async function() {
            const { safe_unlink } = nb_native().fs;
            const PATH1 = `/tmp/safe_unlink${Date.now()}_1`;
            const tmp_mv_path = `/tmp/safe_unlink${Date.now()}_rand`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(FS_CONTEXT, PATH1);
            await safe_unlink(FS_CONTEXT, PATH1, tmp_mv_path, res1.mtimeNsBigint, res1.ino);
            await fs_utils.file_must_not_exist(PATH1);
            await fs_utils.file_delete(PATH1);
        });

        mocha.it('safe unlink - failure', async function() {
            const { safe_unlink } = nb_native().fs;
            const PATH1 = `/tmp/safe_unlink${Date.now()}_1`;
            const tmp_mv_path = `/tmp/safe_unlink${Date.now()}_rand`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(FS_CONTEXT, PATH1);
            const fake_mtime_sec = 12345678;
            try {
                await safe_unlink(FS_CONTEXT, PATH1, tmp_mv_path, BigInt(fake_mtime_sec), res1.ino);
                assert.fail('file should have not been deleted');
            } catch (err) {
                assert.equal(err.message, 'FS::SafeUnlink ERROR unlink target doesn\'t match expected inode and mtime');
                const res2 = await nb_native().fs.stat(FS_CONTEXT, PATH1);
                // source file & target file should still exist
                assert.equal(res1.ino.toString(), res2.ino.toString());
                await fs_utils.file_must_exist(PATH1);
                await fs_utils.file_must_exist(tmp_mv_path);
                await fs_utils.file_delete(PATH1);
                await fs_utils.file_delete(tmp_mv_path);
            }
        });
    });
});

function create_file(file_path) {
    return fs.promises.appendFile(file_path, file_path + '\n');
}
