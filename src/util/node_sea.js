/* Copyright (C) 2024 NooBaa */
/** 
 * https://nodejs.org/docs/latest/api/single-executable-applications.html
 * Build a single executable by combining node-js binary and injecting a script into it.
 * Steps:
 *  1. Bundle the code to a single script with esbuild:
 *      `npx esbuild path-to-main.js --bundle --platform=node --outfile= ...`
 *  2. Compile the bundled script to a blob with: 
 *      `node --experimental-sea-config sea-config.json`
 *  3. Inject it into the nodejs binary with postject:
 *      `npx postject path-to-bin NODE_SEA_BLOB path-to-blob ...`
 */
'use strict';

const path = require('path');
const require_from_file = require('node:module').createRequire(__filename);

// process.env.NOOBAA_SEA = 'true';

// just a mock until require('node:sea') is available
function isSea() {
    return process.env.NOOBAA_SEA === 'true';
}

function bindings(name) {
    return isSea() ?
        require_from_file(path.join(__dirname, name)) :
        require('bindings')(name);
}

exports.isSea = isSea;
exports.bindings = bindings;
