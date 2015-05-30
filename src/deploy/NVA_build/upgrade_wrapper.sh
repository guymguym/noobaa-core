#!/bin/bash

EXTRACTION_PATH="/tmp/test/"
. ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/deploy_base.sh

function pre_upgrade {
  #yum install -y lsof

  #fix iptables
  #TODO: CHECK if rules already exist, is so skip this part
  iptables -I INPUT 1 -i eth0 -p tcp --dport 80 -j ACCEPT
  iptables -I INPUT 1 -i eth0 -p tcp --dport 443 -j ACCEPT
  #/sbin/iptables -A INPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
  #/sbin/iptables -A OUTPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
  service iptables save

  #set locale
  echo "export LC_ALL=C" >> ~/.bashrc

  #helper aliases in bashrc
  echo "alias services_status='/usr/bin/supervisorctl status'" >> ~/.bashrc
  echo "alias ll='ls -lha'" >> ~/.bashrc
  echo "alias less='less -R'" >> ~/.bashrc
  echo "alias zless='zless -R'" >> ~/.bashrc
  echo "export GREP_OPTIONS='--color=auto'" >> ~/.bashrc
  if grep -Fxq "* hard nofile" /etc/security/limits.conf
  then
      echo "hard limit already exists"
  else
      echo "* hard nofile 102400" >> /etc/security/limits.conf
  fi
  if grep -Fxq "* soft nofile" /etc/security/limits.conf
  then
      echo "soft limit already exists"
  else
      echo "* soft nofile 102400" >> /etc/security/limits.conf
  fi
  sysctl -w fs.file-max=102400
  sysctl -p
}

function post_upgrade {
  #.env changes
  #bump agent version.
  #TODO: do it only if md5 of the executable is different

  AGENT_VERSION_VAR=$( grep   AGENT_VERSION ${CORE_DIR}/.env)
  if [ -n "$AGENT_VERSION_VAR" ]; then
      AGENT_VERSION_NUMBER=${AGENT_VERSION_VAR:14}
      AGENT_VERSION_NUMBER=$((AGENT_VERSION_NUMBER+1))
      AGENT_VERSION_VAR='AGENT_VERSION='$((AGENT_VERSION_NUMBER))
  else
      AGENT_VERSION_VAR='AGENT_VERSION=1'
  fi
  cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env
  echo "$AGENT_VERSION_VAR" >>${CORE_DIR}/.env
  #NooBaa supervisor services configuration changes
  cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord
  chmod 777 /etc/rc.d/init.d/supervisord
  rm -f /tmp/*.tar.gz
}


case $1 in
  pre)
    pre_upgrade
    ;;
  post)
    post_upgrade
    ;;
  *)
    exit 1
    ;;
esac
