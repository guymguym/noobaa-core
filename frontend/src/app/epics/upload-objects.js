/* Copyright (C) 2016 NooBaa */

import { Subject } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { UPLOAD_OBJECTS } from 'action-types';
import { deepFreeze } from 'utils/core-utils';
import { mapErrorObject } from 'utils/state-utils';
import { createS3Client } from 'utils/aws-utils';
import { unitsInBytes } from 'utils/size-utils';
import { updateObjectUpload, completeObjectUpload, failObjectUpload } from 'action-creators';

const s3UploadOptions = deepFreeze({
    partSize: 10 * unitsInBytes.MB,
    queueSize: 4
});

export default function(action$, { AWS }) {
    return action$.pipe(
        ofType(UPLOAD_OBJECTS),
        mergeMap(action => {
            const { objects, connection } = action.payload;
            const s3 = createS3Client(AWS, connection);
            const uploadEvent$ = new Subject();

            let uploading = objects.length;
            for (const { id, bucket, file } of objects) {
                s3.upload(
                    {
                        Key: file.name,
                        Bucket: bucket,
                        Body: file,
                        ContentType: file.type
                    },
                    s3UploadOptions,
                    (error, data) => {
                        const action = error ?
                            failObjectUpload(id, mapErrorObject(error)) :
                            completeObjectUpload(id, { verisonId: data.VersionId || 'null' });

                        uploadEvent$.next(action);

                        if (--uploading == 0) {
                            uploadEvent$.complete();
                        }
                    }
                ).on(
                    'httpUploadProgress',
                    ({ loaded }) => uploadEvent$.next(updateObjectUpload(id, loaded))
                );
            }

            return uploadEvent$;
        })
    );
}
