NOOBAA_CORE_IMAGE=noobaa/noobaa-core:5

docker network create --driver bridge noobaa-net

docker run --name noobaa-db \
    --net noobaa-net \
    --detach \
    -e MONGODB_ADMIN_PASSWORD=admin \
    -e MONGODB_USER=noobaa \
    -e MONGODB_PASSWORD=noobaa \
    -e MONGODB_DATABASE=nbcore \
    centos/mongodb-36-centos7

docker run --name noobaa-core \
    --net noobaa-net \
    --detach \
    -p 6001:6001 \
    -p 8080:8080 \
    -e MONGODB_URL=mongodb://noobaa:noobaa@noobaa-db/nbcore \
    -e CONTAINER_PLATFORM=DOCKER \
    -e JWT_SECRET=123 \
    -e SERVER_SECRET=123 \
    -e "AGENT_PROFILE={ \"image\": \"$NOOBAA_CORE_IMAGE\" }" \
    -e DISABLE_DEV_RANDOM_SEED=true \
    -e ENDPOINT_FORKS_NUMBER=1 \
    -e OAUTH_AUTHORIZATION_ENDPOINT= \
    -e OAUTH_TOKEN_ENDPOINT= \
    $NOOBAA_CORE_IMAGE

open http://127.0.0.1:8080
