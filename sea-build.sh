#!/bin/bash

MAIN="src/cmd/nsfs.js"
BUNDLE="build/Release/sea-bundle.js"
BLOB="build/Release/sea-prep.blob"
BIN="build/Release/noobaa-sea"

./node_modules/.bin/esbuild "$MAIN" \
    --bundle \
    --platform=node \
    --target=node$(cat .nvmrc) \
    "--outfile=$BUNDLE" \
    '--external:@mapbox/node-pre-gyp' \
    '--external:heapdump' \
    || exit $?

node --experimental-sea-config sea-config.json || exit $?

cp -f $(command -v node) "$BIN"
codesign --remove-signature "$BIN"
npx postject "$BIN" NODE_SEA_BLOB "$BLOB" \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    --macho-segment-name NODE_SEA \
    || exit $?
codesign --sign - "$BIN"

"./$BIN" --help

