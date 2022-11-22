
/* Copyright (C) 2016 NooBaa */
#include "../util/common.h"
#include "../util/napi.h"
// #include <malloc.h>
// #include <mcheck.h>

namespace noobaa
{

static void _print_malloc_stats(const Napi::CallbackInfo& info);
static void _start_leak_hunt(const Napi::CallbackInfo& info);
static void _finish_leak_hunt(const Napi::CallbackInfo& info);

void
malloc_napi(Napi::Env env, Napi::Object exports)
{
    exports["print_malloc_stats"] = Napi::Function::New(env, _print_malloc_stats);
    exports["start_leak_hunt"] = Napi::Function::New(env, _start_leak_hunt);
    exports["finish_leak_hunt"] = Napi::Function::New(env, _finish_leak_hunt);
}

static void
_print_malloc_stats(const Napi::CallbackInfo& info)
{
    LOG("print_malloc_stats begin...");
    // malloc_stats();
    LOG("print_malloc_stats end.");
}

static void
_start_leak_hunt(const Napi::CallbackInfo& info)
{
    LOG("start_leak_hunt");
    // mtrace();
    // mcheck();
}

static void
_finish_leak_hunt(const Napi::CallbackInfo& info)
{
    LOG("finish_leak_hunt");
    // muntrace();
    exit(1);
}

}
