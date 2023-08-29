/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');

const P = require('../util/promise');
const config = require('../../config');
const stream_utils = require('../util/stream_utils');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;

const EXCEPT_REASONS = [
    'NO_SUCH_OBJECT'
];

/**
 * @implements {nb.Namespace}
 */
class NamespaceMulti {

    /**
     * about `config.NAMESPACE_MULTI_WRITE_HACK`:
     * 
     * This hack is needed to allow NamespaceMulti to have multiple writers and
     * single reader - without changing bucket api and schema.
     * 
     * It does that by swapping the meaning of `read_resources` (plural) and 
     * `write_resource` (single) to mean `write_resources` and `read_resource`
     * respectively.
     * 
     * This is needed for a full deployment, but when running just standalone
     * with src/cmd/nsmulti.js we don't want this because it already added
     * `write_resources`, so we avoided the confusing meaning swap there.
     * 
     * @param {{
     *      namespaces: {
     *          read_resources: nb.Namespace[];
     *          write_resource?: nb.Namespace;
     *          write_resources?: nb.Namespace[];
     *      },
     *      active_triggers: any,
     * }} params 
     */
    constructor({ namespaces, active_triggers }) {
        this.active_triggers = active_triggers;
        if (config.NAMESPACE_MULTI_WRITE_HACK) {
            // swap meaning to allow multi writes while avoiding api changes
            this._read_resources = [namespaces.write_resource].filter(Boolean);
            this._write_resources = namespaces.read_resources.filter(Boolean);
        } else {
            // keep regular meaning, just add option to send list of write_resources
            this._read_resources = namespaces.read_resources.filter(Boolean);
            this._write_resources = namespaces.write_resources?.filter(Boolean) || [namespaces.write_resource].filter(Boolean);
        }
        this._is_readonly = this._write_resources.every(ns => ns.is_readonly_namespace());
    }

    get_write_resource() {
        return this;
    }

    is_server_side_copy(other, params) {
        return false; // ObjectSDK will copy
    }

    get_bucket(bucket) {
        return bucket;
    }

    is_readonly_namespace() {
        return this._is_readonly;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    list_objects(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.list_objects(params, object_sdk),
            // reducer: responses => this._reduce_list_responses(responses, params),
            // except_reasons: ['NoSuchBucket', 'ContainerNotFound'],
            // cast_error_func: this._cast_err_to_s3err,
        });
    }

    list_uploads(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.list_uploads(params, object_sdk),
            // reducer: responses => this._reduce_list_responses(responses, params),
            // except_reasons: ['NoSuchBucket', 'ContainerNotFound'],
            // cast_error_func: this._cast_err_to_s3err,
        });
    }

    list_object_versions(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.list_object_versions(params, object_sdk),
            // reducer: responses => this._reduce_list_responses(responses, params),
            // except_reasons: ['NoSuchBucket', 'ContainerNotFound'],
            // cast_error_func: this._cast_err_to_s3err,
        });
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params, object_sdk) {
        return this._ns_get({
            mapper: async ns => {
                const res = await ns.read_object_md(params, object_sdk);
                // save the ns in the response for optimizing read_object_stream
                res.ns ||= ns;
                return res;
            },
            // reducer: responses => _.maxBy(responses, 'create_time'),
            // except_reasons: EXCEPT_REASONS,
        });
    }

    read_object_stream(params, object_sdk) {
        delete params.noobaa_trigger_agent;
        const object_md_ns = params.object_md?.ns; // use the saved ns from read_object_md
        return object_md_ns ?
            object_md_ns.read_object_stream(params, object_sdk) :
            this._ns_get({
                mapper: ns => ns.read_object_stream(params, object_sdk),
            });
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    upload_object(params, object_sdk) {
        return this._ns_put({
            mapper: ns => this._ns_put_streams(params,
                new_params => ns.upload_object(new_params, object_sdk))
        });
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.create_object_upload(params, object_sdk),
            reducer: responses => {
                let obj_id = '';
                for (const res of responses) {
                    if (res.error) throw res.error;
                    obj_id += '#' + res.response.obj_id;
                }
                return { obj_id: obj_id.slice(1) };
            }
        });
    }
    upload_multipart(params, object_sdk) {
        const ids = params.obj_id.split('#');
        return this._ns_put({
            mapper: ns => {
                const obj_id = ids.shift();
                return this._ns_put_streams(params, new_params =>
                    ns.upload_multipart({ ...new_params, obj_id }, object_sdk));
            },
            reducer: responses => {
                let etag = '';
                for (const res of responses) {
                    if (res.error) throw res.error;
                    etag += '#' + res.response.etag;
                }
                const res = {
                    ...responses[0].response,
                    etag: etag.slice(1),
                };
                return res;
            },
        });
    }
    complete_object_upload(params, object_sdk) {
        const ids = params.obj_id.split('#');
        const count = ids.length;
        return this._ns_put({
            mapper: ns => {
                const index = count - ids.length;
                const obj_id = ids.shift();
                const multiparts = params.multiparts.map(
                    ({ num, etag }) => ({ num, etag: etag.split('#')[index] })
                );
                return ns.complete_object_upload({ ...params, obj_id, multiparts }, object_sdk);
            },
        });
    }
    abort_object_upload(params, object_sdk) {
        const ids = params.obj_id.split('#');
        return this._ns_put({
            mapper: ns => {
                const obj_id = ids.shift();
                return ns.abort_object_upload({ ...params, obj_id }, object_sdk);
            },
        });
    }
    list_multiparts(params, object_sdk) {
        const ids = params.obj_id.split('#');
        // todo we need to get the etags of the other namespaces too
        return this._ns_put({
            mapper: ns => {
                const obj_id = ids.shift();
                return ns.list_multiparts({ ...params, obj_id }, object_sdk);
            },
        });
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.delete_object(params, object_sdk),
            // except_reasons: EXCEPT_REASONS,
        });
    }
    delete_multiple_objects(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.delete_multiple_objects(params, object_sdk),
            // reducer: responses => this._merge_multiple_delete_responses({
            //     // head_res,
            //     responses,
            //     total_objects: params.objects.length
            // })
            // return _.map(merged_res, obj => obj.res);
        });
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    get_object_tagging(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.get_object_tagging(params, object_sdk),
        });
    }
    delete_object_tagging(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.delete_object_tagging(params, object_sdk),
        });
    }
    put_object_tagging(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.put_object_tagging(params, object_sdk),
        });
    }

    //////////
    // ACLs //
    //////////

    get_object_acl(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.get_object_acl(params, object_sdk),
        });
    }
    put_object_acl(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.put_object_acl(params, object_sdk),
        });
    }

    ///////////////////
    //  OBJECT LOCK  //
    ///////////////////

    get_object_legal_hold(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.get_object_legal_hold(params, object_sdk),
        });
    }
    put_object_legal_hold(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.put_object_legal_hold(params, object_sdk),
        });
    }
    get_object_retention(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.get_object_retention(params, object_sdk),
        });
    }
    put_object_retention(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.put_object_retention(params, object_sdk),
        });
    }

    ////////////
    //  BLOB  //
    ////////////

    upload_blob_block(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.upload_blob_block(params, object_sdk),
        });
    }
    commit_blob_block_list(params, object_sdk) {
        return this._ns_put({
            mapper: ns => ns.commit_blob_block_list(params, object_sdk),
        });
    }
    get_blob_block_lists(params, object_sdk) {
        return this._ns_get({
            mapper: ns => ns.get_blob_block_lists(params, object_sdk),
        });
    }


    //////////////
    // INTERNAL //
    //////////////

    /**
     * @template R
     * @param {{
     *      mapper: (ns:nb.Namespace) => Promise<R>;
     *      reducer?: (responses: {response?:R, error?:Error}[]) => R;
     *      except_reasons?: string[];
     *      cast_error_func?: (err: Error) => any;
     * }} params
     */
    async _ns_get({ mapper, reducer = null, except_reasons = [], cast_error_func = null }) {
        const responses = await P.map(this._read_resources, async ns => {
            try {
                const response = await mapper(ns);
                return { response };
            } catch (err) {
                return { error: cast_error_func ? cast_error_func(err) : err };
            }
        });
        if (reducer) return reducer(responses);
        const res = responses[0];
        if (res.error) throw res.error;
        return res.response;
    }

    /**
     * @template R
     * @param {{
     *      mapper: (ns:nb.Namespace) => Promise<R>;
     *      reducer?: (responses: {response?:R, error?:Error}[]) => R;
     *      except_reasons?: string[];
     *      cast_error_func?: (err: Error) => any;
     * }} params
     */
    async _ns_put({ mapper, reducer = null, except_reasons, cast_error_func = null }) {
        const responses = await P.map(this._write_resources, async ns => {
            try {
                const response = await mapper(ns);
                return { response };
            } catch (err) {
                return { error: cast_error_func ? cast_error_func(err) : err };
            }
        });
        if (reducer) return reducer(responses);
        const res = responses[0];
        if (res.error) throw res.error;
        return res.response;
    }

    /**
     * @param {{ source_stream: stream.Readable }} params
     * @param {(params:{ source_stream: stream.Readable }) => Promise} func
     */
    async _ns_put_streams(params, func) {
        const new_stream = new stream.PassThrough();
        const new_params = { ...params, source_stream: new_stream };
        const pipeline_promise = stream_utils.pipeline([params.source_stream, new_stream]);
        try {
            const res = await func(new_params);
            await pipeline_promise;
            return res;
        } finally {
            if (!params.source_stream.destroyed) params.source_stream.destroy();
            if (!new_stream.destroyed) new_stream.destroy();
        }
    }

    // /**
    //  * @param {(ns:nb.Namespace) => Promise} func
    //  */
    // async _ns_map(func, except_reasons, cast_error_func = null) {
    //     const replies = await P.map(this._read_resources, async ns => {
    //         try {
    //             const res = await func(ns);
    //             return { reply: res, success: true };
    //         } catch (err) {
    //             return {
    //                 error: cast_error_func ? cast_error_func(err) : err,
    //                 success: false
    //             };
    //         }
    //     });
    //     return this._throw_if_any_failed_or_get_succeeded(replies, except_reasons);
    // }


    // _throw_if_any_failed_or_get_succeeded(reply_array, except_reasons) {
    //     const failed = this._get_failed_responses(reply_array, except_reasons);
    //     if (!_.isEmpty(failed)) throw _.first(failed);
    //     const succeeded = this._get_succeeded_responses(reply_array);
    //     // Since we did not have any success and all of the errors were except_reasons we rely on the first error.
    //     if (_.isEmpty(succeeded)) throw _.first(reply_array).error;
    //     return succeeded;
    // }

    // _throw_if_all_failed_or_get_succeeded(reply_array, except_reasons) {
    //     const succeeded = this._get_succeeded_responses(reply_array);
    //     if (!_.isEmpty(succeeded)) return succeeded;
    //     const failed = this._get_failed_responses(reply_array, except_reasons);
    //     throw _.first(failed);
    // }

    // _get_succeeded_responses(reply_array) {
    //     return reply_array.filter(res => res.success).map(rec => rec.reply);
    // }

    // _get_failed_responses(reply_array, except_reasons) {
    //     return reply_array.filter(
    //         res => !res.success &&
    //             !_.includes(except_reasons || [], res.error.rpc_code || res.error.code || 'UNKNOWN_ERR')
    //     )
    //         .map(rec => rec.error);
    // }


    // TODO: Currently it only takes the most recent objects without duplicates
    // This means that in list_object_versions we will only see the is_latest objects
    // Which is not what we wanted since we want to see all of the versions
    /**
     * @param {nb.NamespaceListResult[]} res 
     * @param {object} params 
     * @returns {nb.NamespaceListResult}
     */
    _reduce_list_responses(res, params) {
        if (res.length === 1) return res[0];
        var i;
        var j;
        const map = {};
        var is_truncated;
        for (i = 0; i < res.length; ++i) {
            for (j = 0; j < res[i].objects.length; ++j) {
                const obj = res[i].objects[j];
                if (!map[obj.key] ||
                    (map[obj.key] && obj.create_time > map[obj.key].create_time)
                ) map[obj.key] = obj;
            }
            for (j = 0; j < res[i].common_prefixes.length; ++j) {
                const prefix = res[i].common_prefixes[j];
                map[prefix] = prefix;
            }
            if (res[i].is_truncated) is_truncated = true;
        }
        const all_names = Object.keys(map);
        all_names.sort();
        const names = all_names.slice(0, params.limit || 1000);
        const objects = [];
        const common_prefixes = [];
        for (i = 0; i < names.length; ++i) {
            const name = names[i];
            const obj_or_prefix = map[name];
            if (typeof obj_or_prefix === 'string') {
                common_prefixes.push(obj_or_prefix);
            } else {
                objects.push(obj_or_prefix);
            }
        }
        if (names.length < all_names.length) {
            is_truncated = true;
        }
        // TODO picking the name as marker is not according to spec of both S3 and Azure
        // because the marker is opaque to the client and therefore it is not safe to assume that using this as next marker
        // will really provide a stable iteration.
        const next_marker = is_truncated ? names[names.length - 1] : undefined;
        // In case of prefix there will be no object (which means undefined)
        const last_obj_or_prefix = map[names[names.length - 1]];
        const next_version_id_marker =
            is_truncated && (typeof last_obj_or_prefix === 'object') ?
                last_obj_or_prefix.version_id : undefined;
        const next_upload_id_marker =
            is_truncated && (typeof last_obj_or_prefix === 'object') ?
                last_obj_or_prefix.obj_id : undefined;

        return {
            objects,
            common_prefixes,
            is_truncated,
            next_marker,
            next_version_id_marker,
            next_upload_id_marker
        };
    }

    _cast_err_to_s3err(err) {
        if (!err) return;
        const err_to_s3err_map = {
            'NoSuchBucket': S3Error.NoSuchBucket,
            'ContainerNotFound': S3Error.NoSuchBucket,
        };
        let exist = err_to_s3err_map[err.code];
        if (!exist) return err;
        let s3error = new S3Error(exist);
        s3error.message = err.message;
        return s3error;
    }

    _merge_multiple_delete_responses(params) {
        const { head_res, deleted_res } = params;
        let ns_conslusion;
        if (head_res && (head_res.length !== deleted_res.length)) throw new S3Error(S3Error.InternalError);

        for (let ns = 0; ns < deleted_res.length; ++ns) {
            const deleted_ns = deleted_res[ns];
            const head_ns = head_res && head_res[ns];
            const ns_merged = this._handle_single_namespace_deletes({ deleted_ns, head_ns });
            if (ns_conslusion) {
                for (let obj_index = 0; obj_index < ns_conslusion.length; obj_index++) {
                    ns_conslusion[obj_index] =
                        this._pick_ns_obj_reply({ curr: ns_conslusion[obj_index], cand: ns_merged[obj_index] });
                }
            } else {
                ns_conslusion = ns_merged;
            }
        }

        return ns_conslusion;
    }


    _handle_single_namespace_deletes(params) {
        let response = [];
        const { deleted_ns, head_ns } = params;
        for (let i = 0; i < deleted_ns.length; ++i) {
            const res = deleted_ns[i];
            const obj = head_ns && head_ns[i];
            if (_.isUndefined(res && res.err_code)) {
                response.push({ success: true, obj, res });
            } else {
                response.push({ success: false, res });
            }
        }
        return response;
    }


    _pick_ns_obj_reply(params) {
        const { curr, cand } = params;
        const STATUSES = {
            FAILED_WITH_INFO: 3,
            FAILED_WITHOUT_INFO: 2,
            SUCCEEDED_WITH_INFO: 1,
            SUCCEEDED_WITHOUT_INFO: 0
        };
        const get_object_status = object => {
            if (object.success && object.obj) return STATUSES.SUCCEEDED_WITH_INFO;
            if (object.success) return STATUSES.SUCCEEDED_WITHOUT_INFO;
            if (object.obj) return STATUSES.FAILED_WITH_INFO;
            return STATUSES.FAILED_WITHOUT_INFO;
        };
        const curr_status = get_object_status(curr);
        const cand_status = get_object_status(cand);

        if (curr_status > cand_status) return curr;
        if (cand_status > curr_status) return cand;
        if ((cand_status === STATUSES.FAILED_WITH_INFO || cand_status === STATUSES.SUCCEEDED_WITH_INFO) &&
            (cand.obj.create_time > curr.obj.create_time)) return cand;
        return curr;
    }

}


module.exports = NamespaceMulti;
