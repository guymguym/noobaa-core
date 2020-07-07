/* Copyright (C) 2016 NooBaa */
'use strict';

class BucketSpaceFS {

    constructor({ fs_path }) {
        this.fs_path = fs_path;
    }

    set_auth_token(auth_token) {
        // TODO
    }

    ////////////
    // BUCKET //
    ////////////

    list_buckets() {
        // TODO
    }

    read_bucket(params) {
        // TODO
    }

    create_bucket(params) {
        // TODO
    }

    delete_bucket(params) {
        // TODO
    }

    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    get_bucket_lifecycle_configuration_rules(params) {
        // TODO
    }

    set_bucket_lifecycle_configuration_rules(params) {
        // TODO
    }

    delete_bucket_lifecycle(params) {
        // TODO
    }

    ///////////////////////
    // BUCKET VERSIONING //
    ///////////////////////

    set_bucket_versioning(params) {
        // TODO
    }

    ////////////////////
    // BUCKET TAGGING //
    ////////////////////

    put_bucket_tagging(params) {
        // TODO
    }

    delete_bucket_tagging(params) {
        // TODO
    }

    get_bucket_tagging(params) {
        // TODO
    }

    ///////////////////////
    // BUCKET ENCRYPTION //
    ///////////////////////

    put_bucket_encryption(params) {
        // TODO
    }

    get_bucket_encryption(params) {
        // TODO
    }

    delete_bucket_encryption(params) {
        // TODO
    }

    ////////////////////
    // BUCKET WEBSITE //
    ////////////////////

    put_bucket_website(params) {
        // TODO
    }

    delete_bucket_website(params) {
        // TODO
    }

    get_bucket_website(params) {
        // TODO
    }

    ////////////////////
    // BUCKET POLICY  //
    ////////////////////

    put_bucket_policy(params) {
        // TODO
    }

    delete_bucket_policy(params) {
        // TODO
    }

    get_bucket_policy(params) {
        // TODO
    }

    /////////////////////////
    // DEFAULT OBJECT LOCK //
    /////////////////////////

    get_object_lock_configuration(params) {
        // TODO
    }

    put_object_lock_configuration(params) {
        // TODO
    }
}

module.exports = BucketSpaceFS;
