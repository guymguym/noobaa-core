# S3 Compatibility for NamespaceFS (NSFS)

S3 API Features:
- Multipart Upload

Unsupported:
- Website and Anonymous access
- Versioning
- Encryption
- Replication
- Logging
- Notifications
- ...
- RequestPayer
- ObjectLocking 
- 







HeadBucket
None	None	
ListBuckets
None	<ListAllMyBucketsResult>
    …
</ListAllMyBucketsResult>

CreateBucket
None	None	
DeleteBucket
None	None	
=====================	=====================	=====================	=====================
GetBucketPolicy
None	{ Policy in JSON format }	
GetBucketPolicyStatus
None	<PolicyStatus>
   <IsPublic>boolean</IsPublic>
</PolicyStatus>

PutBucketPolicy
{ Policy in JSON format }	None	
DeleteBucketPolicy
None	None	
=====================	=====================	=====================	=====================
ListObjects
/?delimiter=Delimiter
 &encoding-type=EncodingType
 &marker=Marker
 &max-keys=MaxKeys
 &prefix=Prefix	<ListBucketResult> 
    … 
</ListBucketResult>
https://github.com/noobaa/noobaa-core/issues/8048

ListObjectsV2
/?list-type=2
 &continuation-token=ContinuationToken
 &delimiter=Delimiter
 &encoding-type=EncodingType
 &fetch-owner=FetchOwner
 &max-keys=MaxKeys
 &prefix=Prefix
 &start-after=StartAfter	<ListBucketResult>
    …
</ListBucketResult>
https://github.com/noobaa/noobaa-core/issues/8048

ListMultipartUploads
/?uploads
 &delimiter=Delimiter
 &encoding-type=EncodingType
 &key-marker=KeyMarker
 &max-uploads=MaxUploads
 &prefix=Prefix
 &upload-id-marker=UploadIdMarker	<ListMultipartUploadsResult>
    …
</ListMultipartUploadsResult>

    
=====================	=====================	=====================	=====================
HeadObject
HEAD /Key+?partNumber=PartNumber&versionId=VersionId HTTP/1.1
Host: Bucket.s3.amazonaws.com
If-Match: IfMatch
If-Modified-Since: IfModifiedSince
If-None-Match: IfNoneMatch
If-Unmodified-Since: IfUnmodifiedSince
Range: Range
x-amz-server-side-encryption-customer-algorithm: SSECustomerAlgorithm
x-amz-server-side-encryption-customer-key: SSECustomerKey
x-amz-server-side-encryption-customer-key-MD5: SSECustomerKeyMD5
x-amz-request-payer: RequestPayer
x-amz-expected-bucket-owner: ExpectedBucketOwner
x-amz-checksum-mode: ChecksumMode

        
GetObject			
PutObject			
CopyObject			
DeleteObject			
DeleteObjects			
RestoreObject			
=====================	=====================	=====================	=====================
CreateMultipartUpload			
CompleteMultipartUpload			
AbortMultipartUpload			
UploadPart			
UploadPartCopy			
ListParts			
