# make_x86_on_mac_lima

## Configure lima:

See https://lima-vm.io/?file=docs/multi-arch.md and https://github.com/containerd/nerdctl/blob/main/docs/multi-platform.md

The default vm config is created at `~/.lima/default/lima.yaml` and should be added with:

```yaml
vmType: "vz"
mountType: "virtiofs"
# cpus: 4
# memory: 4GiB
```

## Control the lima vm:

```sh
limactl stop && limactl start
lima
```

## Cross compile to x86:

```sh
make noobaa CONTAINER_ENGINE=nerdctl CONTAINER_PLATFORM='--platform=amd64' NOOBAA_TAG='guymguym/noobaa-core:5.10-nsfs-direct'
nerdctl push guymguym/noobaa-core:5.10-nsfs-direct
```