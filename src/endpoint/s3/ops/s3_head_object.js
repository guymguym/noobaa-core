/* Copyright (C) 2016 NooBaa */
'use strict';

// const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const S3Error = require('../s3_errors').S3Error;
const http_utils = require('../../../util/http_utils');
const rdma_utils = require('../../../util/rdma_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
 * @param {nb.S3Request} req
 * @param {nb.S3Response} res
 */
async function head_object(req, res) {
    const encryption = s3_utils.parse_encryption(req);
    const rdma_info = rdma_utils.parse_rdma_info(req);
    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: s3_utils.parse_version_id(req.query.versionId),
        md_conditions: http_utils.get_md_conditions(req),
        encryption,
        rdma_info,
    };
    if (req.query.partNumber) {
        params.part_number = s3_utils.parse_part_number(req.query.partNumber, S3Error.InvalidArgument);
    }
    if (req.query.get_from_cache !== undefined) {
        params.get_from_cache = true;
    }
    const object_md = await req.object_sdk.read_object_md(params);

    s3_utils.set_response_object_md(res, object_md);
    s3_utils.set_encryption_response_headers(req, res, object_md.encryption);
    http_utils.set_response_headers_from_request(req, res);
    rdma_utils.set_rdma_response_header(req, res, rdma_info, object_md.rdma_reply);
}

module.exports = {
    handler: head_object,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
