# NSFS Lifecycle & Inventory


## OVERVIEW
S3 Bucket Lifecycle rules help users store objects cost effectively throughout their lifecycle by automatically deleting expired objects, or transitioning them to lower-cost storage classes. For more information see [AWS S3 lifecycle documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html).

S3 Bucket Inventory helps to simplify and speed up workflows and big data jobs by providing a scheduled alternative to the Amazon S3 synchronous List API operations. For more information see [AWS S3 inventory documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-inventory.html).

NooBaa NSFS buckets supports these features using filesystem scanning methods, which can be optimized using the backend filesystem scan tools.


## SCOPE
* S3 bucket lifecycle API's -
  * GetBucketLifecycleConfiguration 
  * PutBucketLifecycleConfiguration
  * DeleteBucketLifecycle
* Schedule lifecycle worker in the background -
  * Invoke periodically (daily/weekly)
  * Process buckets with lifecycle/inventory policy
  * Scan bucket contents and filter objects
  * Implement lifecycle expiration/transition actions
* Integration with other bucket features
  * Versioning - versioning can be used to prevent expiration, unless specifically used to expire non-current versions.
  * Notifications - lifecycle events are distinct from regular user operations to be able to monitor it specifically.
  * Glacier storage-class - lifecycle rules can transition objects between classes - see [NSFSGlacierStorageClass](NSFSGlacierStorageClass.md).


## DESIGN
The [noobaa-cli](../NooBaaNonContainerized/NooBaaCLI.md) will provide commands to process the lifecycle rules for buckets and will be scheduled to run periodically on the system.

Scanning filesystems using an iterative/recursive directory-scan is a fallback naive implementation that will work for all filesystems, however it will not be scalable for large NSFS buckets. Integrating with filesystem-specific scan tools will be much faster to run for distributed filesystems, but requires integration with the backend filesystem scan engine. We will design this integration as hooks that can be provided by the system tools, for example [GPFS mmapplypolicy](https://www.ibm.com/docs/en/storage-scale/5.2.1?topic=administering-information-lifecycle-management-storage-scale).

AbortIncompleteMultipartUpload rules allows to specify how many days to keep incomplete multipart uploads before aborting them automatically. It is simple to implement efficiently in NSFS with simple readdir on the multipart-uploads directory, and will not require any hook from the filesystem backend.

For all other rule types - Expiration, Transition, NoncurrentVersionExpiration, NoncurrentVersionTransition, a filesystem scan hook script will be used if provided.

Lifecycle hook scripts should be placed in `config.NSFS_LIFECYCLE_BIN_DIR` dir. A `scan_bucket_lifecycle` script should accept a bucket json file, translate the rule's filters from the bucket's `lifecycle_configuration_rules` to the format supported by the backend filesystem tools, and run the filesystem scan. The scan should produce an output file per rule id, where each line in the output contains a file path that was filtered by that rule. Once the scan script returns, the output files will be consumed, and the rules actions will be applied. The directory of the scan output files should be configured with `config.NSFS_LIFECYCLE_SCAN_OUTPUT_DIR` and the detailed structure of it will be described below.

Before applying the actions on the scan output, the rule filters should be re-checked to match the target object/version, which is needed to avoid applying actions to unintended objects, for example, if the scan filtered objects by size/age, and by the time the scan ends the object got replaced with a smaller/newer object before the rule action runs.


## CLI COMMANDS

```sh
noobaa-cli lifecycle run
```
This command should be scheduled to run daily on the system, it will read the buckets with lifecycle configurations and run the rules.

```sh
noobaa-cli lifecycle run --bucket bucket-name
```
This command will run the rules for a specific bucket on demand.


## FS SCAN HOOK

## FILTERS SEMANTICS

Prefix:
1. For regular objects the prefix is the file path relative to the bucket root.
2. For versions the prefix should be split to a base directory and a file prefix and matched to the path `pbasedir/.versions/pfilename*`
3. For multipart uploads the prefix applies to the desired key of the upload, which NSFS stores in the multipart upload manifest file (`create_object_upload` file) and will be checked by the NSFS code.

Size:
1. Size conditions should check the file size for objects and versions.
2. For multipart uploads the size filter seems irrelevant as the size is unknown.

Tags:
1. For regular objects and versions the filter should match xattrs of the form `user.noobaa.<tag-key>: <tag-value>`.
2. For multipart uploads the tags will be stored in the upload manifest file if provided in the CreateMultipartUpload operation.

## DATES

Days:
1. Expiration rules can specify number of days - this should be added to the scan filters, and checked against the LastModifiedTime of the object, which is the file's mtime in the NSFS case.
   
Date:
1. Expiration rules can specify a date - this date is to be understood as a cutoff date, not related to a specific object attribute, but the rule should not run until that date at all, and from that date it should run.
2. Transition rules - the same as Expiration.

