/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const require_from_file = require('node:module').createRequire(__filename);

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
