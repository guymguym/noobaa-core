import { S3, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

console.log('Hello from esbuild');

async function update() {
    const form_form = document.getElementById('form_form') as HTMLFormElement;
    const form_access_key = document.getElementById('form_access_key') as HTMLInputElement;
    const form_secret_key = document.getElementById('form_secret_key') as HTMLInputElement;
    const form_bucket = document.getElementById('form_bucket') as HTMLInputElement;
    const form_prefix = document.getElementById('form_prefix') as HTMLInputElement;
    const output = document.getElementById('output');

    const accessKeyId = form_access_key.value;
    const secretAccessKey = form_secret_key.value;
    const bucket = form_bucket.value || '';
    const prefix = form_prefix.value || '';

    const s3 = new S3({
        region: 'us-east-1',
        endpoint: window.location.origin,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
    });

    if (bucket) {
        const res = await s3.listObjectsV2({
            Bucket: bucket,
            Prefix: prefix,
            Delimiter: '/',
        });
        console.log('GGG', res);
        const list = document.createElement('ol');
        for (const it of res.CommonPrefixes || []) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.addEventListener('click', () => {
                form_prefix.value = it.Prefix;
                form_form.requestSubmit();
            });
            a.innerText = it.Prefix;
            a.href = '#';
            li.append(a);
            list.append(li);
        }
        for (const obj of res.Contents || []) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.addEventListener('click', async () => {
                const command = new GetObjectCommand({ Bucket: bucket, Key: obj.Key });
                const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
                window.open(url, '_blank').focus();
            });
            a.innerText = obj.Key;
            a.href = '#';
            li.append(a);
            li.append(' | ' + obj.Size + ' | ' + obj.StorageClass);
            list.append(li);
        }
        output.replaceChildren(list);
    } else {
        const res = await s3.listBuckets();
        console.log('GGG', res);
        const list = document.createElement('ol');
        for (const bucket of res.Buckets || []) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.addEventListener('click', () => {
                form_bucket.value = bucket.Name;
                form_prefix.value = '';
                form_form.requestSubmit();
            });
            a.innerText = bucket.Name;
            a.href = '#';
            li.append(a);
            list.append(li);
        }
        output.replaceChildren(list);
    }
}

function form_submit(event) {
    event.preventDefault();
    update();
    return false;
};

window.form_submit = form_submit;
