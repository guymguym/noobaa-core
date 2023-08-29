# NS MULTI-WRITE POC

The use case is of writing to primary and secondary, reading from primary only, and do manual failover to secondary as read-only, or read-write (and sync data back befor failback).

```
                        /---> S3 Primary (read-write)
S3 Client ---> NS-MULTI
                        \---> S3 Secondary (write-only)
```

Thoughts:
1. To avoid many API changes for the POC we use read_resources (which is an array) used as the list of resources to WRITE (!) to, and then write_resource actually used as the only one to READ from. After POC we will just add a new list for write_resources to the API (keep backward compatible working as long as it makes sense). 
2. Error handling strategy - Should we error to the client only if primary fails?
4. How do we resync secondary after outage or other errors? 
5. How do we resync primary after failover with writes enabled on secondary?
6. Do we need buffering for the secondary writes? or does it has its own?
7. Should we be transparent to Accounts and Buckets?

### Build on Mac/Linux

```
git switch guy-5.13-ns-multi-write
npm install
npm run build
make noobaa NOOBAA_TAG=guymguym/noobaa-core:5.13-ns-multi-write
docker push guymguym/noobaa-core:5.13-ns-multi-write
```

### Test locally

Prepare the primary and secondary resource configurations -
```sh
PRIMARY_RESOURCE='{
	"resource": {
		"name": "primary",
		"endpoint": "https://localhost:4002",
		"endpoint_type": "S3_COMPATIBLE",
		"auth_method": "AWS_V4",
		"access_key": "ACCESSKEY",
		"secret_key": "SECRETKEY",
		"access_mode": "READ_WRITE"
	}
}'
SECONDARY_RESOURCE='{
	"resource": {
		"name": "secondary",
		"endpoint": "https://localhost:4003",
		"endpoint_type": "S3_COMPATIBLE",
		"auth_method": "AWS_V4",
		"access_key": "ACCESSKEY",
		"secret_key": "SECRETKEY",
		"access_mode": "READ_WRITE"
	}
}'
```

Start two local nsfs endpoint for testing to serve primary and secondary -
```sh
export CONFIG_JS_PROMETHEUS_ENABLED=false
mkdir -p primary/bucket1
mkdir -p secondary/bucket1
node --unhandled-rejections=warn src/core/nsfs --http_port 6002 --https_port 4002 primary
node --unhandled-rejections=warn src/core/nsfs --http_port 6003 --https_port 4003 secondary
```

Start the nsmulti command with variables -
```sh
node --unhandled-rejections=warn src/core/nsmulti '{
	"read_resources":  [ '${PRIMARY_RESOURCE}' ],
	"write_resources": [ '${PRIMARY_RESOURCE}', '${SECONDARY_RESOURCE}' ]
}'
```

Change to use secondary in read-only mode -
```sh
node --unhandled-rejections=warn src/core/nsmulti '{
	"read_resources":  [ '${SECONDARY_RESOURCE}' ],
	"write_resources": [ ]
}'
```


### Running as container

Build noobaa-core poc image:

```sh
git switch guy-5.13-ns-multi-write
make noobaa NOOBAA_TAG=guymguym/noobaa-core:5.13-ns-multi-write
docker push guymguym/noobaa-core:5.13-ns-multi-write
```

Get operator released version:

```sh
curl -L https://github.com/noobaa/noobaa-operator/releases/download/v5.12.4/noobaa-operator-v5.12.4-darwin-arm64.tar.gz | tar xvz noobaa-operator
alias nb="$PWD/noobaa-operator"
```

Install the operator and start the system:

```sh
kubectl config set-context --current --namespace noobaa

nb crd create
nb operator install

POD_RESOURCES='{ "requests": {"cpu":"500m","memory":"500Mi"}, "limits": {"cpu":"2","memory":"2Gi"} }'
nb system create \
    "--noobaa-image=guymguym/noobaa-core:5.13-ns-multi-write" \
    "--core-resources=$POD_RESOURCES" \
    "--db-resources=$POD_RESOURCES" \
    "--endpoint-resources=$POD_RESOURCES"

nb status
nb bucket delete first.bucket

# mini doesn't work well
# nb install -n noobaa --mini --noobaa-image=guymguym/noobaa-core:5.13-ns-multi-write
```

### Setup standalone S3 endpoint (nsfs) for primary and secondary

```sh
kubectl apply -f simple-nsfs-pod.yaml
```


### Setup port-forwarding to connect from local host

```sh
kubectl port-forward service/s3 6001:s3
kubectl port-forward service/nsfs 6002:http
alias s3='aws --endpoint http://localhost:6001 s3'
alias s3nsfs='aws --endpoint http://localhost:6002 s3'
```

### Create primary and secondary buckets

```sh
aws --endpoint http://localhost:6002 s3 mb s3://primary-bucket
aws --endpoint http://localhost:6002 s3 mb s3://secondary-bucket
aws --endpoint http://localhost:6002 s3 ls
```

### Setup Bucket

```sh
nb namespacestore create s3-compatible primary \
	--endpoint https://nsfs:6443 \
	--target-bucket primary-bucket \
	--access-key PRIMARYACCESSKEY \
	--secret-key 123456

nb namespacestore create s3-compatible secondary \
	--endpoint https://nsfs:6443 \
	--target-bucket secondary-bucket \
	--access-key SECONDARYACCESSKEY \
	--secret-key 123456 \
    --access-mode read-only

nb bucketclass create namespace-bucketclass multi multi-class \
	--write-resource primary \
	--read-resources primary,secondary

nb obc create multi-bucket \
	--bucketclass multi-class \
	--exact
```

### Use Bucket

Get OBC credentials:

```sh
nb obc status multi-bucket --show-secrets
```

Use aws cli:

```sh
export AWS_ACCESS_KEY_ID=$(kubectl get secret multi-bucket -n noobaa -o json | jq -r '.data.AWS_ACCESS_KEY_ID|@base64d')
export AWS_SECRET_ACCESS_KEY=$(kubectl get secret multi-bucket -n noobaa -o json | jq -r '.data.AWS_SECRET_ACCESS_KEY|@base64d')
s3 ls
```

### Check bucket config

```sh
nb api bucket read_bucket '{ "name": "multi-bucket" }'
```

### Failover READ-ONLY

We assume the failover trigger is going to be decided later, for now it's a manual api call.

To invoke failover and remove the primary from the namespace we would update the bucket namespace policy to use only the secondary as read-only, with:

CONFUSED ??? - this is because we swapped the meaning of write_resource and read_resources to avoid API changes for the POC - see comment at the top.

```sh
nb api bucket update_bucket '{
	"name": "multi-bucket",
	"namespace": {
		"write_resource": { "resource": "secondary" },
		"read_resources": []
	}
}'
```

### Failover READ-WRITE

NOTE - this will requires sync back to primary before failback...

```sh
nb api bucket update_bucket '{
	"name": "multi-bucket",
	"namespace": {
		"write_resource": { "resource": "secondary" },
		"read_resources": [{ "resource": "secondary" }]
	}
}'
```

### Failback

```sh
nb api bucket update_bucket '{
	"name": "multi-bucket",
	"namespace": {
		"write_resource": 
			{ "resource": "primary" },
		"read_resources": [
			{ "resource": "primary" },
			{ "resource": "secondary" }
		]
	}
}'
```
