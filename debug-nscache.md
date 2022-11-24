HUB

```shell
node src/core nsfs .
```

CACHE

```shell
node src/core/nscache 'http://localhost:6001'
```

CLIENT

```shell
curl -s 'http://localhost:7001/src?prefix=core/&delimiter=/' | xmllint --format - | bat
```

PERF

```shell
node src/tools/s3perf.js --endpoint 'http://localhost:7001' --bucket build --get Release/nb_native.node
```

