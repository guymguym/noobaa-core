/* Copyright (C) 2016 NooBaa */
#include "../../../git_modules/s3select/include/s3select.h"
#include "../util/common.h"
#include "../util/napi.h"

namespace noobaa
{

static Napi::Value _run_s3select(const Napi::CallbackInfo& info);

void
s3select_napi(Napi::Env env, Napi::Object exports)
{
    exports["s3select"] = Napi::Function::New(env, _run_s3select);
}

static Napi::Value
_run_s3select(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    std::string query = info[0].As<Napi::String>().Utf8Value();
    std::string input = info[1].As<Napi::String>().Utf8Value();

    s3selectEngine::s3select s3select;
    s3select.parse_query(query.c_str());
    if (!s3select.get_error_description().empty()) {
        throw Napi::Error::New(env, XSTR() << "s3select: parse_query failed " << s3select.get_error_description());
    }

    s3selectEngine::csv_object::csv_defintions csv_defs;
    csv_defs.row_delimiter = ';';
    csv_defs.column_delimiter = ',';
    csv_defs.use_header_info = false;
    csv_defs.quote_fields_always = false;
    s3selectEngine::csv_object csv_object(&s3select, csv_defs);

    std::string output;
    int rc = csv_object.run_s3select_on_stream(output, input.c_str(), input.size(), input.size());
    if (rc < 0) {
        throw Napi::Error::New(env, XSTR() << "s3select: csv.run_s3select_on_stream failed " << csv_object.get_error_description());
    }

    return Napi::String::New(env, output);
}

} // namespace noobaa
