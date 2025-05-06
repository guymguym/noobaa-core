FROM registry.access.redhat.com/ubi9/ubi-init
WORKDIR /root
RUN dnf -y update && dnf -y install wget unzip which vim make procps && dnf -y clean all
RUN curl -L "https://rpmfind.net/linux/centos-stream/9-stream/AppStream/x86_64/os/Packages/boost-system-1.75.0-8.el9.x86_64.rpm" \
  -o boost-system.rpm && rpm -i boost-system.rpm && rm -f boost-system.rpm
RUN curl -L "https://rpmfind.net/linux/centos-stream/9-stream/AppStream/x86_64/os/Packages/boost-thread-1.75.0-8.el9.x86_64.rpm" \
  -o boost-thread.rpm && rpm -i boost-thread.rpm && rm -f boost-thread.rpm
RUN curl -L "https://noobaa-core-rpms.s3.amazonaws.com/noobaa-core-5.19.0-20250401-master.el9.x86_64.rpm" \
  -o noobaa-core.rpm && rpm -i noobaa-core.rpm && rm -f noobaa-core.rpm
WORKDIR /opt/noobaa
RUN systemctl enable noobaa
EXPOSE 6001
EXPOSE 6443
EXPOSE 7004
EXPOSE 7005
EXPOSE 7443
CMD [ "/sbin/init" ]
