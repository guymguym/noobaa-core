# Hadoop S3A Tests

https://hadoop.apache.org/docs/stable/hadoop-aws/tools/hadoop-aws/testing.html
https://hadoop.apache.org/docs/stable/hadoop-aws/tools/hadoop-aws/third_party_stores.html

## Install

```sh
dnf install -y maven
git clone https://github.com/apache/hadoop
cd hadoop
git checkout rel/release-3.4.2
cd hadoop-tools/hadoop-aws
```

## Configure S3A Settings

Configure the test using the example below in `src/test/resources/auth-keys.xml`:

```xml
<configuration>
	
  <!-- Endpoint and bucket -->

  <property>
    <name>fs.s3a.endpoint</name>
    <value>http://10.41.68.56:6001</value>
  </property>
  <property>
    <name>test.fs.s3a.name</name>
    <value>s3a://hadoop/</value>
  </property>


  <!-- S3A settings -->

  <property>
    <name>fs.contract.test.fs.s3a</name>
    <value>${test.fs.s3a.name}</value>
  </property>
  <property>
    <name>fs.s3a.endpoint.region</name>
    <value>us-east-1</value>
  </property>
  <property>
    <name>fs.s3a.connection.ssl.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>fs.s3a.path.style.access</name>
    <value>true</value>
  </property>
  <property>
    <name>fs.s3a.change.detection.mode</name>
    <value>server</value> <!-- "server" | "client" | "none" -->
  </property>


  <!-- Test settings -->

  <property>
    <name>fs.s3a.scale.test.huge.filesize</name>
    <value>10G</value>
  </property>
  <property>
    <name>fs.s3a.scale.test.timeout</name>
    <value>432000</value>
  </property>

  <property>
    <name>test.fs.s3a.content.encoding.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.create.create.acl.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.create.storage.class.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.encryption.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.sts.enabled</name>
    <value>false</value>
  </property>


  <!-- Credentials -->

  <property>
    <name>fs.s3.awsAccessKeyId</name>
    <value>XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</value>
  </property>
  <property>
    <name>fs.s3.awsSecretAccessKey</name>
    <value>YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY</value>
  </property>
  <property>
    <name>fs.s3n.awsAccessKeyId</name>
    <value>XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</value>
  </property>
  <property>
    <name>fs.s3n.awsSecretAccessKey</name>
    <value>YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY</value>
  </property>
  <property>
    <name>fs.s3a.access.key</name>
    <description>AWS access key ID. Omit for Role-based authentication.</description>
    <value>XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</value>
  </property>
  <property>
    <name>fs.s3a.secret.key</name>
    <description>AWS secret key. Omit for Role-based authentication.</description>
    <value>YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY</value>
  </property>

</configuration>
``` 


## Run S3A Tests

```sh
mvn clean verify -Dtest=TestS3A* -Dit.test=ITestS3A* | tee -a /tmp/s3a-tests.log
```
