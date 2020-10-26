/* Copyright (C) 2016 NooBaa */
'use strict';

const xml_utils = require('../../util/xml_utils');

/**
 * @typedef {{
 *      code?: string, 
 *      message: string, 
 *      http_code: number,
 *      detail?: string
 * }} S3ErrorSpec
 */

class S3Error extends Error {

    /**
     * @param {S3ErrorSpec} error_spec 
     */
    constructor({ code, message, http_code, detail }) {
        super(message); // sets this.message
        this.code = code;
        this.http_code = http_code;
        this.detail = detail;
    }

    reply(resource, request_id) {
        const xml = {
            Error: {
                Code: this.code,
                Message: this.message,
                Resource: resource || '',
                RequestId: request_id || '',
                Detail: this.detail,
            }
        };
        return xml_utils.encode_xml(xml);
    }

}

// See http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html


S3Error.AccessDenied = {
    code: 'AccessDenied',
    message: 'Access Denied',
    http_code: 403,
};
S3Error.AccountProblem = {
    code: 'AccountProblem',
    message: 'There is a problem with your AWS account that prevents the operation from completing successfully. Please Contact Us.',
    http_code: 403,
};
S3Error.AmbiguousGrantByEmailAddress = {
    code: 'AmbiguousGrantByEmailAddress',
    message: 'The email address you provided is associated with more than one account.',
    http_code: 400,
};
S3Error.BadDigest = {
    code: 'BadDigest',
    message: 'The Content-MD5 you specified did not match what we received.',
    http_code: 400,
};
S3Error.BucketAlreadyExists = {
    code: 'BucketAlreadyExists',
    message: 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.',
    http_code: 409,
};
S3Error.BucketAlreadyOwnedByYou = {
    code: 'BucketAlreadyOwnedByYou',
    message: 'Your previous request to create the named bucket succeeded and you already own it. You get this error in all AWS regions except US East (N. Virginia) region, us-east-1. In us-east-1 region, you will get 200 OK, but it is no-op (if bucket exists it Amazon S3 will not do anything).',
    http_code: 409,
};
S3Error.BucketNotEmpty = {
    code: 'BucketNotEmpty',
    message: 'The bucket you tried to delete is not empty. You must delete all versions in the bucket.',
    http_code: 409,
};
S3Error.CredentialsNotSupported = {
    code: 'CredentialsNotSupported',
    message: 'This request does not support credentials.',
    http_code: 400,
};
S3Error.CrossLocationLoggingProhibited = {
    code: 'CrossLocationLoggingProhibited',
    message: 'Cross-location logging not allowed. Buckets in one geographic location cannot log information to a bucket in another location.',
    http_code: 403,
};
S3Error.EntityTooSmall = {
    code: 'EntityTooSmall',
    message: 'Your proposed upload is smaller than the minimum allowed object size.',
    http_code: 400,
};
S3Error.EntityTooLarge = {
    code: 'EntityTooLarge',
    message: 'Your proposed upload exceeds the maximum allowed object size.',
    http_code: 400,
};
S3Error.ExpiredToken = {
    code: 'ExpiredToken',
    message: 'The provided token has expired.',
    http_code: 400,
};
S3Error.IllegalVersioningConfigurationException = {
    code: 'IllegalVersioningConfigurationException',
    message: 'Indicates that the versioning configuration specified in the request is invalid.',
    http_code: 400,
};
S3Error.IncompleteBody = {
    code: 'IncompleteBody',
    message: 'You did not provide the number of bytes specified by the Content-Length HTTP header',
    http_code: 400,
};
S3Error.IncorrectNumberOfFilesInPostRequest = {
    code: 'IncorrectNumberOfFilesInPostRequest',
    message: 'POST requires exactly one file upload per request.',
    http_code: 400,
};
S3Error.InlineDataTooLarge = {
    code: 'InlineDataTooLarge',
    message: 'Inline data exceeds the maximum allowed size.',
    http_code: 400,
};
S3Error.InternalError = {
    code: 'InternalError',
    message: 'We encountered an internal error. Please try again.',
    http_code: 500,
};
S3Error.InvalidAccessKeyId = {
    code: 'InvalidAccessKeyId',
    message: 'The AWS access key Id you provided does not exist in our records.',
    http_code: 403,
};
S3Error.InvalidAddressingHeader = {
    code: 'InvalidAddressingHeader',
    message: 'You must specify the Anonymous role.',
    http_code: 400, // N/A,
};
S3Error.InvalidArgument = {
    code: 'InvalidArgument',
    message: 'Invalid Argument',
    http_code: 400,
};
S3Error.InvalidBucketName = {
    code: 'InvalidBucketName',
    message: 'The specified bucket is not valid.',
    http_code: 400,
};
S3Error.InvalidBucketState = {
    code: 'InvalidBucketState',
    message: 'The request is not valid with the current state of the bucket.',
    http_code: 409,
};
S3Error.InvalidDigest = {
    code: 'InvalidDigest',
    message: 'The Content-MD5 you specified is not valid.',
    http_code: 400,
};
S3Error.InvalidEncryptionAlgorithmError = {
    code: 'InvalidEncryptionAlgorithmError',
    message: 'The encryption request you specified is not valid. The valid value is AES256.',
    http_code: 400,
};
S3Error.ServerSideEncryptionConfigurationNotFoundError = {
    code: 'ServerSideEncryptionConfigurationNotFoundError',
    message: 'The server side encryption configuration was not found.',
    http_code: 404,
};
S3Error.InvalidLocationConstraint = {
    code: 'InvalidLocationConstraint',
    message: 'The specified location constraint is not valid. For more information about regions, see How to Select a Region for Your Buckets.',
    http_code: 400,
};
S3Error.InvalidObjectState = {
    code: 'InvalidObjectState',
    message: 'The operation is not valid for the current state of the object.',
    http_code: 403,
};
S3Error.InvalidPart = {
    code: 'InvalidPart',
    message: 'One or more of the specified parts could not be found. The part might not have been uploaded, or the specified entity tag might not have matched the part\'s entity tag.',
    http_code: 400,
};
S3Error.InvalidPartOrder = {
    code: 'InvalidPartOrder',
    message: 'The list of parts was not in ascending order.Parts list must specified in order by part number.',
    http_code: 400,
};
S3Error.InvalidPayer = {
    code: 'InvalidPayer',
    message: 'All access to this object has been disabled.',
    http_code: 403,
};
S3Error.InvalidPolicyDocument = {
    code: 'InvalidPolicyDocument',
    message: 'The content of the form does not meet the conditions specified in the policy document.',
    http_code: 400,
};
S3Error.InvalidRange = {
    code: 'InvalidRange',
    message: 'The requested range cannot be satisfied.',
    http_code: 416,
};
S3Error.InvalidRequest = {
    code: 'InvalidRequest',
    message: 'SOAP requests must be made over an HTTPS connection.',
    http_code: 400,
};
S3Error.InvalidSecurity = {
    code: 'InvalidSecurity',
    message: 'The provided security credentials are not valid.',
    http_code: 403,
};
S3Error.InvalidSOAPRequest = {
    code: 'InvalidSOAPRequest',
    message: 'The SOAP request body is invalid.',
    http_code: 400,
};
S3Error.InvalidStorageClass = {
    code: 'InvalidStorageClass',
    message: 'The storage class you specified is not valid.',
    http_code: 400,
};
S3Error.InvalidTargetBucketForLogging = {
    code: 'InvalidTargetBucketForLogging',
    message: 'The target bucket for logging does not exist, is not owned by you, or does not have the appropriate grants for the log-delivery group.',
    http_code: 400,
};
S3Error.InvalidToken = {
    code: 'InvalidToken',
    message: 'The provided token is malformed or otherwise invalid.',
    http_code: 400,
};
S3Error.InvalidURI = {
    code: 'InvalidURI',
    message: 'Couldn\'t parse the specified URI.',
    http_code: 400,
};
S3Error.KeyTooLong = {
    code: 'KeyTooLong',
    message: 'Your key is too long.',
    http_code: 400,
};
S3Error.MalformedACLError = {
    code: 'MalformedACLError',
    message: 'The XML you provided was not well-formed or did not validate against our published schema.',
    http_code: 400,
};
S3Error.MalformedPOSTRequest = {
    code: 'MalformedPOSTRequest',
    message: 'The body of your POST request is not well-formed multipart/form-data.',
    http_code: 400,
};
S3Error.MalformedXML = {
    code: 'MalformedXML',
    message: 'This happens when the user sends malformed xml (xml that doesn\'t conform to the published xsd) for the configuration. The error message is, "The XML you provided was not well-formed or did not validate against our published schema."',
    http_code: 400,
};
S3Error.InvalidTag = {
    code: 'InvalidTag',
    message: 'The tag provided was not a valid tag.',
    http_code: 400,
};
S3Error.MaxMessageLengthExceeded = {
    code: 'MaxMessageLengthExceeded',
    message: 'Your request was too big.',
    http_code: 400,
};
S3Error.MaxPostPreDataLengthExceededError = {
    code: 'MaxPostPreDataLengthExceededError',
    message: 'Your POST request fields preceding the upload file were too large.',
    http_code: 400,
};
S3Error.MetadataTooLarge = {
    code: 'MetadataTooLarge',
    message: 'Your metadata headers exceed the maximum allowed metadata size.',
    http_code: 400,
};
S3Error.MethodNotAllowed = {
    code: 'MethodNotAllowed',
    message: 'The specified method is not allowed against this resource.',
    http_code: 405,
};
S3Error.MissingAttachment = {
    code: 'MissingAttachment',
    message: 'A SOAP attachment was expected, but none were found.',
    http_code: 400, // N/A,
};
S3Error.MissingContentLength = {
    code: 'MissingContentLength',
    message: 'You must provide the Content-Length HTTP header.',
    http_code: 411,
};
S3Error.MissingRequestBodyError = {
    code: 'MissingRequestBodyError',
    message: 'Request body is empty.',
    http_code: 400,
};
S3Error.MissingSecurityElement = {
    code: 'MissingSecurityElement',
    message: 'The SOAP 1.1 request is missing a security element.',
    http_code: 400,
};
S3Error.MissingSecurityHeader = {
    code: 'MissingSecurityHeader',
    message: 'Your request is missing a required header.',
    http_code: 400,
};
S3Error.NoLoggingStatusForKey = {
    code: 'NoLoggingStatusForKey',
    message: 'There is no such thing as a logging status subresource for a key.',
    http_code: 400,
};
S3Error.NoSuchBucket = {
    code: 'NoSuchBucket',
    message: 'The specified bucket does not exist.',
    http_code: 404,
};
S3Error.NoSuchKey = {
    code: 'NoSuchKey',
    message: 'The specified key does not exist.',
    http_code: 404,
};
S3Error.NoSuchLifecycleConfiguration = {
    code: 'NoSuchLifecycleConfiguration',
    message: 'The lifecycle configuration does not exist.',
    http_code: 404,
};
S3Error.NoSuchUpload = {
    code: 'NoSuchUpload',
    message: 'The specified multipart upload does not exist. The upload ID might be invalid, or the multipart upload might have been aborted or completed.',
    http_code: 404,
};
S3Error.NoSuchVersion = {
    code: 'NoSuchVersion',
    message: 'Indicates that the version ID specified in the request does not match an existing version.',
    http_code: 404,
};
S3Error.NotImplemented = {
    code: 'NotImplemented',
    message: 'A header you provided implies functionality that is not implemented.',
    http_code: 501,
};
S3Error.NotSignedUp = {
    code: 'NotSignedUp',
    message: 'Your account is not signed up for the Amazon S3 service. You must sign up before you can use, Amazon S3. You can sign up at the following URL: http://aws.amazon.com/s3',
    http_code: 403,
};
S3Error.NoSuchBucketPolicy = {
    code: 'NoSuchBucketPolicy',
    message: 'The specified bucket does not have a bucket policy.',
    http_code: 404,
};
S3Error.OperationAborted = {
    code: 'OperationAborted',
    message: 'A conflicting conditional operation is currently in progress against this resource. Try again.',
    http_code: 409,
};
S3Error.PermanentRedirect = {
    code: 'PermanentRedirect',
    message: 'The bucket you are attempting to access must be addressed using the specified endpoint. Send all future requests to this endpoint.',
    http_code: 301,
};
S3Error.PreconditionFailed = {
    code: 'PreconditionFailed',
    message: 'At least one of the preconditions you specified did not hold.',
    http_code: 412,
};
S3Error.Redirect = {
    code: 'Redirect',
    message: 'Temporary redirect.',
    http_code: 307,
};
S3Error.RestoreAlreadyInProgress = {
    code: 'RestoreAlreadyInProgress',
    message: 'Object restore is already in progress.',
    http_code: 409,
};
S3Error.RequestIsNotMultiPartContent = {
    code: 'RequestIsNotMultiPartContent',
    message: 'Bucket POST must be of the enclosure-type multipart/form-data.',
    http_code: 400,
};
S3Error.RequestTimeout = {
    code: 'RequestTimeout',
    message: 'Your socket connection to the server was not read from or written to within the timeout period.',
    http_code: 400,
};
S3Error.RequestTimeTooSkewed = {
    code: 'RequestTimeTooSkewed',
    message: 'The difference between the request time and the server\'s time is too large.',
    http_code: 403,
};
S3Error.RequestTorrentOfBucketError = {
    code: 'RequestTorrentOfBucketError',
    message: 'Requesting the torrent file of a bucket is not permitted.',
    http_code: 400,
};
S3Error.SignatureDoesNotMatch = {
    code: 'SignatureDoesNotMatch',
    message: 'The request signature we calculated does not match the signature you provided. Check your AWS secret access key and signing method. For more information, see REST Authentication and SOAP Authentication for details.',
    http_code: 403,
};
S3Error.ServiceUnavailable = {
    code: 'ServiceUnavailable',
    message: 'Reduce your request rate.',
    http_code: 503,
};
S3Error.SlowDown = {
    code: 'SlowDown',
    message: 'Reduce your request rate.',
    http_code: 503,
};
S3Error.TemporaryRedirect = {
    code: 'TemporaryRedirect',
    message: 'You are being redirected to the bucket while DNS updates.',
    http_code: 307,
};
S3Error.TokenRefreshRequired = {
    code: 'TokenRefreshRequired',
    message: 'The provided token must be refreshed.',
    http_code: 400,
};
S3Error.TooManyBuckets = {
    code: 'TooManyBuckets',
    message: 'You have attempted to create more buckets than allowed.',
    http_code: 400,
};
S3Error.UnexpectedContent = {
    code: 'UnexpectedContent',
    message: 'This request does not support content.',
    http_code: 400,
};
S3Error.UnresolvableGrantByEmailAddress = {
    code: 'UnresolvableGrantByEmailAddress',
    message: 'The email address you provided does not match any account on record.',
    http_code: 400,
};
S3Error.UserKeyMustBeSpecified = {
    code: 'UserKeyMustBeSpecified',
    message: 'The bucket POST must contain the specified field name. If it is specified, check the order of the fields.',
    http_code: 400,
};



/////////////////////////////////////
// Errors for generic HTTP replies //
/////////////////////////////////////
S3Error.NotModified = {
    code: 'NotModified',
    message: 'The resource was not modified according to the conditions in the provided headers.',
    http_code: 304,
};
S3Error.BadRequest = {
    code: 'BadRequest',
    message: 'Bad Request',
    http_code: 400,
};
S3Error.BadRequestWithoutCode = {
    // same as BadRequest but without encoding the <Code> field
    // was needed for one of the cases in ceph/s3tests
    message: 'Bad Request',
    http_code: 400,
};

////////////////////////////////////////////////////////////////
// Errors actually returned by AWS S3 although not documented //
////////////////////////////////////////////////////////////////
S3Error.ReplicationConfigurationNotFoundError = {
    code: 'ReplicationConfigurationNotFoundError',
    message: 'The replication configuration was not found',
    http_code: 404,
};
S3Error.NoSuchWebsiteConfiguration = {
    code: 'NoSuchWebsiteConfiguration',
    message: 'The specified bucket does not have a website configuration',
    http_code: 404,
};
S3Error.XAmzContentSHA256Mismatch = {
    code: 'XAmzContentSHA256Mismatch',
    message: 'The provided \'x-amz-content-sha256\' header does not match what was computed.',
    http_code: 400,
    // ClientComputedContentSHA256: '...',
    // S3ComputedContentSHA256: '...',
};
S3Error.MalformedPolicy = {
    code: 'MalformedPolicy',
    message: 'Invalid principal in policy',
    http_code: 400,
    detail: '...', // will be overridden from rpc_data, see handle_error in s3_rest.js
};
S3Error.NoSuchObjectLockConfiguration = {
    code: 'NoSuchObjectLockConfiguration',
    message: 'The specified object does not have a ObjectLock configuration',
    http_code: 404,
};
S3Error.ObjectLockConfigurationNotFoundError = {
    code: 'ObjectLockConfigurationNotFoundError',
    message: 'Object Lock configuration does not exist for this bucket',
    http_code: 404,
};

exports.S3Error = S3Error;
