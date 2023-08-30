# NS MULTI-WRITE POC

The use case is of writing to primary and secondary, reading from primary only, and do manual failover to secondary as read-only, or read-write (and sync data back befor failback).

In the regular situation we would like to write to two targets, but reading only from primary:
```
S3 Client ---> NS-MULTI
                       \---> S3 Primary (read-write)
                       \---> S3 Secondary (write-only)
```

On primary failure, the configuration can be changed to read only from secondary:
```
S3 Client ---> NS-MULTI
                       \---> S3 Secondary (read-only)
```

Or if preferred, we can configure to read-write to secondary,
which means we will have to sync back changes the primary before failback:
```
S3 Client ---> NS-MULTI
                       \---> S3 Secondary (read-write)
```

In this POC we will provide manual switchig between modes, and will not handle the syncing of data written during failover.

Open questions:
1. Error handling strategy - Should we error to the client only if primary fails?
1. How do we resync secondary after outage or other errors? 
1. How do we resync primary after failover with writes enabled on secondary?
1. Do we need buffering for the secondary writes? or does it has its own?
1. Should we be transparent to Accounts and Buckets?

## Developer mode

Build:
```sh
git clone https://github.com/guymguym/noobaa-core.git
cd noobaa-core
git switch guy-5.13-ns-multi-write
npm install
npm run build
make noobaa NOOBAA_TAG=guymguym/noobaa-core:5.13-ns-multi-write
docker push guymguym/noobaa-core:5.13-ns-multi-write
```

Set shell variables:
```sh
export AWS_ACCESS_KEY_ID=ACCESSKEY
export AWS_SECRET_ACCESS_KEY=SECRETKEY
export CONFIG_JS_PROMETHEUS_ENABLED=false
S3_CREDS=(--access_key $AWS_ACCESS_KEY_ID --secret_key $AWS_SECRET_ACCESS_KEY)
S3_HOST=localhost:6001
BKT="test-bucket"
S3BKT="s3://$BKT"
alias x3='aws --endpoint http://$S3_HOST s3'
alias x3api='aws --endpoint http://$S3_HOST s3api'
```

Start two local nsfs endpoint for testing to serve primary and secondary:
```sh
rm -rf primary && mkdir -p primary/$BKT
rm -rf secondary && mkdir -p secondary/$BKT
node --unhandled-rejections=warn src/core/nsfs $S3_CREDS --http_port 6002 --https_port 4002 primary
node --unhandled-rejections=warn src/core/nsfs $S3_CREDS --http_port 6003 --https_port 4003 secondary
```

Start s3 server with ns-multi config over default port 6001 (see --help):
```sh
node --unhandled-rejections=warn src/core/nsmulti $S3_CREDS ns-multi-write-config.json
```

Failover to secondary in read-only mode:
```sh
node --unhandled-rejections=warn src/core/nsmulti $S3_CREDS ns-multi-failover-ro-config.json
```

Failover to secondary in read-write mode:
```sh
node --unhandled-rejections=warn src/core/nsmulti $S3_CREDS ns-multi-failover-rw-config.json
```

Tests:
```sh
x3 cp --recursive src $S3BKT
x3 ls $S3BKT
find primary -type f | head -n 10
find secondary -type f | head -n 10
du -sh primary/*
du -sh secondary/*
diff -r primary secondary
```

Benchmarks:
```sh
WARP_OPTS=(--host $S3_HOST --bucket $BKT --duration 10s --objects 1000 --obj.size 1MiB)
warp mixed 	$WARP_OPTS
warp put 	$WARP_OPTS
warp get 	$WARP_OPTS --noclear
warp get 	$WARP_OPTS --noclear --list-existing
```

## Kubernetes/Openshift mode

Create a namespace and set it as current
```sh
kubectl create ns noobaa-ns-multi-write-poc
kubectl config set-context --current --namespace noobaa-ns-multi-write-poc
```

Prepare configs -
```sh
PRIMARY='{
	"name": "primary",
	"endpoint": "https://192.168.0.95:4002",
	"endpoint_type": "S3_COMPATIBLE",
	"auth_method": "AWS_V4",
	"access_key": "ACCESSKEY",
	"secret_key": "SECRETKEY",
	"access_mode": "READ_WRITE"
}'
SECONDARY='{
	"name": "secondary",
	"endpoint": "https://192.168.0.95:4003",
	"endpoint_type": "S3_COMPATIBLE",
	"auth_method": "AWS_V4",
	"access_key": "ACCESSKEY",
	"secret_key": "SECRETKEY",
	"access_mode": "READ_WRITE"
}'
echo '{
	"write_resources": [ { "resource": '$PRIMARY' }, { "resource": '$SECONDARY' } ],
	"read_resources":  [ { "resource": '$PRIMARY' } ]
}' | jq > ns-multi-write-normal.json
echo '{
	"write_resources": [ ],
	"read_resources":  [ { "resource": '$SECONDARY' } ]
}' | jq > ns-multi-write-failover.json
```

Create a secret to keep the configuration json -
```sh
kubectl create secret generic ns-multi-write-secret \
	--from-file=normal.json=ns-multi-write-normal.json \
	--from-file=failover.json=ns-multi-write-failover.json
```

Create deployment -
```sh
kubectl apply -f ns-multi-write-deploy.yaml
```

Start port forwarding in the background to test -
```sh
kubectl port-forward service/s3 6001:80
```

Use the port forwarded endpoint -
```sh
aws --endpoint http://localhost:6001 s3 ls
aws --endpoint http://localhost:6001 s3 ls s3://test-bucket
aws --endpoint http://localhost:6001 s3 cp --recursive DIR_TO_UPLOAD s3://test-bucket
aws --endpoint http://localhost:6001 s3 ls s3://test-bucket
```

Change to failover mode -
```sh
kubectl set env deploy/ns-multi-write MODE=failover
```

Change back to normal mode -
```sh
kubectl set env deploy/ns-multi-write MODE=normal
```

## Operator mode - NOT YET IMPLEMENTED

Get operator released version:

```sh
curl -L https://github.com/noobaa/noobaa-operator/releases/download/v5.12.4/noobaa-operator-v5.12.4-darwin-arm64.tar.gz | tar xvz noobaa-operator
alias nb="$PWD/noobaa-operator"
```

Install the operator and start the system:

```sh
POD_RESOURCES='{
	"requests": { "cpu":"500m", "memory":"500Mi" },
	"limits":   { "cpu":"2",    "memory":"2Gi"   }
}'

kubectl config set-context --current --namespace noobaa
nb crd create
nb operator install
nb system create \
    "--noobaa-image=guymguym/noobaa-core:5.13-ns-multi-write" \
    "--core-resources=$POD_RESOURCES" \
    "--db-resources=$POD_RESOURCES" \
    "--endpoint-resources=$POD_RESOURCES"
nb status
nb bucket delete first.bucket

# NOTICE that --mini doesn't work well
# nb install -n noobaa --mini --noobaa-image=guymguym/noobaa-core:5.13-ns-multi-write
```

Configure and create a bucket with OBC -
```sh
## TODO - this will require allowing a namespacestore without a target bucket ...
nb namespacestore create s3-compatible primary \
	--endpoint https://primary-endpoint \
	--access-key ACCESSKEY \
	--secret-key SECRETKEY

## TODO - this will require allowing a namespacestore without a target bucket ...
nb namespacestore create s3-compatible secondary \
	--endpoint https://secondary-endpoint \
	--access-key ACCESSKEY \
	--secret-key SECRETKEY

## TODO - this will require new field write-resource**s** for multiple write targets
nb bucketclass create namespace-bucketclass multi multi-class \
	--write-resources primary,secondary \
	--read-resources primary

## TODO - this will need to create the bucket on all write targets
nb obc create multi-bucket \
	--bucketclass multi-class \
	--exact
```

Get OBC credentials:

```sh
nb obc status multi-bucket --show-secrets
```

Use aws cli:

```sh
S3_HOST='...get from service...'
export AWS_ACCESS_KEY_ID=$(kubectl get secret multi-bucket -n noobaa -o json | jq -r '.data.AWS_ACCESS_KEY_ID|@base64d')
export AWS_SECRET_ACCESS_KEY=$(kubectl get secret multi-bucket -n noobaa -o json | jq -r '.data.AWS_SECRET_ACCESS_KEY|@base64d')
x3 ls
```

Get the bucket namespace policy:

```sh
nb api bucket read_bucket '{ "name": "multi-bucket" }'
```

Failover READ-ONLY:

We assume the failover trigger is going to be decided later, for now it's a manual api call.

To invoke failover and remove the primary from the namespace we would update the bucket namespace policy to use only the secondary as read-only, with:

CONFUSED ??? - this is because we swapped the meaning of write_resource and read_resources to avoid API changes for the POC - see comment at the top.

```sh
nb api bucket update_bucket '{ "name": "multi-bucket", "namespace": {
	"write_resources": [],
	"read_resources":  [{ "resource": "secondary" }]
}}'
```

Failover READ-WRITE:

NOTE - this will requires sync back to primary before failback...

```sh
nb api bucket update_bucket '{ "name": "multi-bucket", "namespace": {
	"write_resources": [{ "resource": "secondary" }],
	"read_resources":  [{ "resource": "secondary" }]
}}'
```

Failback:

```sh
nb api bucket update_bucket '{ "name": "multi-bucket", "namespace": {
	"write_resources": [{ "resource": "primary" },
	"read_resources":  [{ "resource": "primary" }, { "resource": "secondary" }]
}}'
```
