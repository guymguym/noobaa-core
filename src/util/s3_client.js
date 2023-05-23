/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const http = require('http');
const https = require('https');


function create_s3_client(argv) {
    // @ts-ignore
    http.globalAgent.keepAlive = true;
    // @ts-ignore
    https.globalAgent.keepAlive = true;

    if (argv.presign && !_.isNumber(argv.presign)) {
        argv.presign = 3600;
    }

    const s3 = new AWS.S3({
        endpoint: argv.endpoint,
        accessKeyId: argv.access_key && String(argv.access_key),
        secretAccessKey: argv.secret_key && String(argv.secret_key),
        s3ForcePathStyle: !argv.vhost,
        s3BucketEndpoint: argv.vhost || false,
        signatureVersion: argv.sig, // s3 or v4
        computeChecksums: argv.checksum || false, // disabled by default for performance
        s3DisableBodySigning: !argv.signing || true, // disabled by default for performance
        region: argv.region || 'us-east-1',
    });

    // AWS config does not use https.globalAgent
    // so for https we need to set the agent manually
    if (s3.endpoint.protocol === 'https:') {
        s3.config.update({
            httpOptions: {
                agent: new https.Agent({
                    keepAlive: true,
                    rejectUnauthorized: !argv.selfsigned,
                })
            }
        });
        if (!argv.selfsigned) {
            // @ts-ignore
            AWS.events.on('error', err => {
                if (err.message === 'self signed certificate') {
                    setTimeout(() => console.log(
                        '\n*** You can accept self signed certificates with: --selfsigned\n'
                    ), 10);
                }
            });
        }
    }

    return s3;
}

exports.create_s3_client = create_s3_client;
