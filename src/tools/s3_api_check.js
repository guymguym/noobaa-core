/* Copyright (C) 2016 NooBaa */
'use strict';

require('aws-sdk/lib/maintenance_mode_message').suppress = true;

const minimist = require('minimist');
const { create_s3_client } = require('../util/s3_client');

async function main() {
    const argv = minimist(process.argv);
    const s3 = create_s3_client(argv);

    await api_check(async () => s3.listBuckets().promise());
}

async function api_check(fn) {
    await fn();
}

exports.main = main;

if (require.main === module) main();
