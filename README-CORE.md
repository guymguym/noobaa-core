1. DB

```shell
initdb -D db.IGNORE
postgres -D db.IGNORE
createuser postgres
createdb nbcore
```

1. NSFS (port 6001)

```shell
mkdir 'storage.IGNORE'
node src/core nsfs 'storage.IGNORE'
```

2. NSSTORE (port 6002)

```shell
node src/core nsstore 's3://localhost:6001/backingstore-s3-to-nsfs'
node src/core nsstore 'storage.IGNORE/backingstore-fs'
node src/core nsstore \
    --no-dedupe \
    --no-compression  \
    --no-encryption \
    --chunk-size '64MB' \
    --ec '2+2' \
    'storage.IGNORE/tape1' \
    'storage.IGNORE/tape2' \
    'storage.IGNORE/tape3' \
    'storage.IGNORE/tape4'

# backingstores over network
node src/core backingstore 'storage.IGNORE/tape1' --port 6061
node src/core backingstore 'storage.IGNORE/tape2' --port 6062
node src/core backingstore 'storage.IGNORE/tape3' --port 6063
node src/core backingstore 'storage.IGNORE/tape4' --port 6064

node src/core nsstore \
    --no-dedupe \
    --no-compression  \
    --no-encryption \
    --ec '2+2' \
    --chunk-size '64MB' \
    'bs://localhost:6061' \
    'bs://localhost:6062' \
    'bs://localhost:6063' \
    'bs://localhost:6064'
```

3. NSCACHE (port 6003)

```shell
node src/core nscache \
    --hub 's3://localhost:6001/bucket-1' \
    --cache 'storage.IGNORE/cache' \
    --cache-size '1GB'
```

4. NSMERGE (port 6004)

```shell
node src/core nsmerge \
    'storage.IGNORE/bucket-1' \
    's3://localhost:6001/bucket-2'
```



---

CLIENT

```shell
curl -s 'http://localhost:7001/src?prefix=core/&delimiter=/' | xmllint --format - | bat
```

PERF

```shell
node src/tools/s3perf.js --endpoint 'http://localhost:7001' --bucket build --get Release/nb_native.node
```
