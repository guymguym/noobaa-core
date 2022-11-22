# https://github.com/noobaa/noobaa-core/pull/7018

# set env
cat <<EOF >>.env
LOCAL_MD_SERVER=true
CREATE_SYS_NAME=demo
CREATE_SYS_EMAIL=demo@noobaa.com
CREATE_SYS_PASSWD=DeMo1
NOOBAA_ROOT_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
JWT_SECRET=123
EOF

mkdir -p memleak/db
mkdir -p memleak/storage

# start db
initdb -D memleak/db
postgres -D memleak/db
createuser postgres
createdb nbcore

# start core
npm run web
npm run bg
npm run hosted_agents

# start endpoint with stack logging enabled
MallocStackLogging=1 npm run s3

# start nsfs (for s3 compat backing store)
node src/core nsfs --http_port 6003 --https_port 6004 memleak/

# call apis to set up the bucket with nsfs backing store (token + conn + pool + tier + policy + bucket)
function nbapi() {
    curl localhost:5001/rpc -sd '{
        "api": "'$1'",
        "method": "'$2'",
        "params": '$3',
        "auth_token": "'$TOKEN'"
    }'
}
TOKEN=$(nbapi auth_api create_auth '{
    "role": "admin",
    "system": "demo",
    "email": "demo@noobaa.com",
    "password": "DeMo1"
}' | jq -r '.reply.token')
nbapi account_api add_external_connection '{
    "name": "conn1",
    "endpoint_type": "S3_COMPATIBLE",
    "endpoint": "http://localhost:6003",
    "identity": "unused",
    "secret": "unused"
}'
nbapi pool_api create_cloud_pool '{
    "name": "pool1",
    "connection": "conn1",
    "target_bucket": "storage"
}'
nbapi tier_api create_tier '{
    "name": "tier1",
    "attached_pools": ["pool1"]
}'
nbapi tiering_policy_api create_policy '{
    "name": "policy1",
    "tiers": [{ "order": 1, "tier": "tier1" }]
}'
nbapi bucket_api create_bucket '{
    "name": "bucket1",
    "tiering": "policy1"
}'

# put objects
alias s3='AWS_ACCESS_KEY_ID=123 AWS_SECRET_ACCESS_KEY=abc aws --endpoint http://localhost:6001 s3'
s3 ls
for i in `seq 33`; do echo "hello $i" | s3 cp - s3://bucket1/file$i; done
for i in `seq 33`; do s3 cp s3://bucket1/file$i -; done
s3 ls bucket1

# find leaks
leaks $(pgrep -f "node src/s3")
