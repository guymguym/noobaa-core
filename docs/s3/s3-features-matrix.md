# NooBaa S3 Compatibility

Unsupported Protocol Features:

## API Features

Fully Supported API Features:
- [Authentication](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html) - Sigv4, Sigv2, Presigned URL.
- Bucket addressing - Path-style ("domain.io/bucket"), Host-style ("bucket.domain.com").
- [Common Request Headers](https://docs.aws.amazon.com/AmazonS3/latest/API/RESTCommonRequestHeaders.html) - Authorization, Content-Length, Content-Type, Content-MD5, Date, Expect, Host, x-amz-content-sha256, x-amz-date, x-amz-security-token.
- [Common Response Headers](https://docs.aws.amazon.com/AmazonS3/latest/API/RESTCommonResponseHeaders.html) - Content-Length, Content-Type, Connection, Date, ETag, ~~Server~~.
- Multipart Uploads
- Bucket Policy - details [s3-bucket-policy](s3-bucket-policy.md)

Partially Supported API Features:
- Versioning
- Website and Anonymous access
- Encryption - support AES256 and kms.
- Logging
- Lifecycle
- ObjectLocking 

Usupported API Features:
- ACL - use Bucket Policy instead.
- Replication
- Notifications
- RequestPayer

Legend:
✅ - Fully supported
 - Partially supported - see gaps and detailed docs per feature.
 - Not supported

## Bucket Operations

|| S3 operation | BucketSpaceNB | BucketSpaceFS | Gaps |
|:-:|:-|:-:|:-:|:-|
| __Basic__ |||||
|| HeadBucket                           | ✅ | ✅ ||
|| GetBucketLocation                    | ✅ | ✅ ||
|| CreateBucket                         | ✅ | ✅ ||
|| DeleteBucket                         | ✅ | ✅ ||
|| ListBuckets                          | ✅ | ✅ ||
| __Policy__ |||||
|| GetBucketPolicy                      | ✅ | ✅ | [#7997](https://github.com/noobaa/noobaa-core/pull/7997) |
|| GetBucketPolicyStatus                | ✅ | ✅ ||
|| PutBucketPolicy                      | ✅ | ✅ ||
|| DeleteBucketPolicy                   | ✅ | ✅ ||
| __Tagging__ |||||
|| GetBucketTagging                     | ✅ | 🇽 | [#8047](https://github.com/noobaa/noobaa-core/issues/8047) |
|| PutBucketTagging                     | ✅ | 🇽 ||
|| DeleteBucketTagging                  | ✅ | 🇽 ||
| __Versioning__ |||||
|| GetBucketVersioning                  | ✅ | ✅ ||
|| PutBucketVersioning                  | ✅ | ✅ ||
| __Website__ |||||
|| GetBucketWebsite                     | ✅ | ✅ ||
|| PutBucketWebsite                     | ✅ | ✅ ||
|| DeleteBucketWebsite                  | ✅ | ✅ ||
| __Encryption__ |||| AES256 |
|| GetBucketEncryption                  | ✅ | ✅ ||
|| PutBucketEncryption                  | ✅ | ✅ ||
|| DeleteBucketEncryption               | ✅ | ✅ ||
| __Logging__ |||||
|| GetBucketLogging                     | ✅ | 🇽 ||
|| PutBucketLogging                     | ✅ | 🇽 ||
| __Lifecycle__ |||||
|| GetBucketLifecycle                   | ✅ | 🇽 ||
|| PutBucketLifecycle                   | ✅ | 🇽 ||
|| DeleteBucketLifecycle                | ✅ | 🇽 ||
|| GetBucketLifecycleConfiguration      | ✅ | 🇽 ||
|| PutBucketLifecycleConfiguration      | ✅ | 🇽 ||


Unsupported Bucket Operations:

|| S3 operation | Roadmap | Issue/PR |
|-|-|:-:|:-|
| __Replication__ ||||
|| GetBucketReplication                 | 🇽 ||
|| PutBucketReplication                 | 🇽 ||
|| DeleteBucketReplication              | 🇽 ||
| __Notification__ ||||
|| GetBucketNotification                | 🇽 ||
|| PutBucketNotification                | 🇽 ||
|| GetBucketNotificationConfiguration   | 🇽 ||
|| PutBucketNotificationConfiguration   | 🇽 ||
| __CORS__ ||| [#6080](https://github.com/noobaa/noobaa-core/issues/6080) |
|| GetBucketCors                        | 🇽 ||
|| PutBucketCors                        | 🇽 ||
|| DeleteBucketCors                     | 🇽 ||
| __DirectoryBuckets__ ||||
|| ListDirectoryBuckets                 | 🇽 ||

GetBucketAccelerateConfiguration
PutBucketAccelerateConfiguration

GetBucketAnalyticsConfiguration
PutBucketAnalyticsConfiguration
DeleteBucketAnalyticsConfiguration
ListBucketAnalyticsConfigurations

GetBucketIntelligentTieringConfiguration
PutBucketIntelligentTieringConfiguration
DeleteBucketIntelligentTieringConfiguration
ListBucketIntelligentTieringConfigurations

GetBucketInventoryConfiguration
PutBucketInventoryConfiguration
DeleteBucketInventoryConfiguration
ListBucketInventoryConfigurations

GetBucketMetricsConfiguration
PutBucketMetricsConfiguration
DeleteBucketMetricsConfiguration
ListBucketMetricsConfigurations

GetBucketOwnershipControls
PutBucketOwnershipControls
DeleteBucketOwnershipControls

GetBucketRequestPayment
PutBucketRequestPayment

GetPublicAccessBlock
PutPublicAccessBlock
DeletePublicAccessBlock

- ACL - Deprecated
GetBucketAcl
PutBucketAcl

---

## Supported Object Operations

HeadObject
GetObject
GetObjectAttributes
PutObject
CopyObject
DeleteObject
DeleteObjects

ListObjects
ListObjectsV2
ListObjectVersions

ListMultipartUploads
CreateMultipartUpload
CompleteMultipartUpload
AbortMultipartUpload

ListParts
UploadPart
UploadPartCopy

GetObjectTagging
PutObjectTagging
DeleteObjectTagging

RestoreObject

SelectObjectContent


## Unsupported Object Operations

GetObjectAcl
PutObjectAcl

GetObjectLegalHold
PutObjectLegalHold

GetObjectLockConfiguration
PutObjectLockConfiguration

GetObjectRetention
PutObjectRetention

GetObjectTorrent


WriteGetObjectResponse

CreateSession

## Headers

Request Headers:

Response Headers:

