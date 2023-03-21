### Install tools

```sh

wget https://dl.min.io/client/mc/release/linux-amd64/mc
wget https://dl.min.io/server/minio/release/linux-amd64/minio
wget https://github.com/minio/warp/releases/download/v0.6.6/warp_0.6.6_Linux_x86_64.tar.gz

tar xvf warp_0.6.6_Linux_x86_64.tar.gz warp
rm -f warp_0.6.6_Linux_x86_64.tar.gz

chmod +x mc
chmod +x minio
chmod +x warp

./mc alias set nb http://localhost:6001
./mc ls nb/

```

### Benchmarks

```sh

UV_THREADPOOL_SIZE=64 \
    node src/tools/fs_speed_guym.js \
    --dir /nsfs/noobaa-s3res-4080029599/realfast/guym/speed1 \
    --file_size 4 --file_size_units KB \
    --block_size 4 --block_size_units KB \
    --time 30 --concur 64 \
    --mode nsfs --read
    # --mode nsfs --write

UV_THREADPOOL_SIZE=64 \
    node src/tools/s3perf.js \
    --endpoint http://localhost:6001 \
    --bucket node_modules \
    --size 4 --size_units KB \
    --time 30 --concur 64 \
    --head
    # --get
    # --put

./warp get \
    --host localhost:6001 \
    --obj.size 4KiB \
    --duration 30s \
    --concurrent 64

```

### NSFS

```sh
UV_THREADPOOL_SIZE=64 \
    NOOBAA_LOG_LEVEL=warn \
    CONFIG_JS_EP_METRICS_SERVER_PORT=9004 \
    node src/core nsfs \
    /nsfs/noobaa-s3res-4080029599/realfast/guym/ \
    --backend GPFS \
    --http_port 9001 \
    --https_port 9002 \
    --https_port_sts 9003
```

### Minio

```sh

MINIO_ROOT_USER=admin MINIO_ROOT_PASSWORD=password ./minio server /mnt/data --console-address ":9001"

```

