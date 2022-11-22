/* Copyright (C) 2016 NooBaa */
'use strict';

const nb_native = require('../util/nb_native');
const crypto = require('crypto');

main();

async function main() {
    await Promise.all(new Array(20).fill(0).map((v, k) => worker(k)));
}

async function worker(k) {
    const size = 1024 * 1024;
    for (let i = 0; i < 20000; i++) {
        const chunk = {
            size,
            data: crypto.randomBytes(size),
            chunk_coder_config: {
                digest_type: 'sha384',
                frag_digest_type: 'sha1',
                compress_type: 'snappy',
                cipher_type: 'aes-256-gcm',
                data_frags: 1,
            },
        };
        await encode_chunk(chunk);
        await decode_chunk(chunk);
        if (i % 1000 === 0) {
            console.log(`worker ${k} processed ${i} chunks`);
        }
    }
}

async function decode_chunk(chunk) {
    await new Promise((resolve, reject) =>
        nb_native().chunk_coder('dec', chunk, err => (err ? reject(err) : resolve()))
    );
}

async function encode_chunk(chunk) {
    await new Promise((resolve, reject) =>
        nb_native().chunk_coder('enc', chunk, err => (err ? reject(err) : resolve()))
    );
}
