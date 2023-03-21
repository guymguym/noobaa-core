#!/bin/bash

# download nodejs binary 
node_arch="x64"
node_platform="linux"
node_version="$(cat .nvmrc)"
node_dir="node-v${node_version}-${node_platform}-${node_arch}"
wget "https://nodejs.org/download/release/v${node_version}/${node_dir}.tar.gz"
tar xzf "${node_dir}.tar.gz"

# build nasm from source and symlink to the node bin dir for ease of use
nasm_version="2.15.05"
nasm_dir="nasm-${nasm_version}"
wget "https://github.com/netwide-assembler/nasm/archive/${nasm_dir}.tar.gz"
tar xzf "${nasm_dir}.tar.gz"
pushd "${nasm_dir}"
./autogen.sh
./configure
make
popd
pushd "${node_dir}/bin"
ln -s "../../${nasm_dir}/nasm" nasm
popd

PATH="${PWD}/${node_dir}/bin:$PATH"

git clone "https://github.com/guymguym/noobaa-core"
cd noobaa-core
git switch guy-tape-pr1

npm install
npm run build
./node_modules/.bin/pkg . --public --target host
cd ..

mv noobaa-core/build/noobaa-core ./noobaa-nsfs-rh8-x86