/* Copyright (C) 2016 NooBaa */
#include "../util/b64.h"
#include "../util/buf.h"
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/os.h"
#include "../util/worker.h"
#include <condition_variable>

/**
 * Use build option: GYP_DEFINES="CUOBJ_CLIENT=1" npm run build
 */
#define CUOBJ_CLIENT 1

#if CUOBJ_CLIENT
typedef off_t loff_t;
    #include "cuobjclient.h"
    #include "protocol.h"
#endif

namespace noobaa
{

DBG_INIT(0);

#if CUOBJ_CLIENT

typedef enum cuObjOpType_enum
{
    CUOBJ_GET = 0, /**< GET operation */
    CUOBJ_PUT = 1, /**< PUT operation */
    CUOBJ_INVALID = 9999
} cuObjOpType_t;

/**
 * CuObjClientNapi is a napi object wrapper for cuObjClient.
 */
struct CuObjClientNapi : public Napi::ObjectWrap<CuObjClientNapi>
{
    static Napi::FunctionReference constructor;
    std::shared_ptr<cuObjClient> _client;
    Napi::ThreadSafeFunction _thread_callback;

    static Napi::Function Init(Napi::Env env);
    CuObjClientNapi(const Napi::CallbackInfo& info);
    ~CuObjClientNapi();
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value rdma(const Napi::CallbackInfo& info);
};

struct CuObjClientWorker : public ObjectWrapWorker<CuObjClientNapi>
{
    cuObjOpType_t _op_type;
    void* _ptr;
    size_t _size;
    std::string _rdma_desc;
    std::string _rdma_addr;
    size_t _rdma_size;
    loff_t _rdma_offset;
    ssize_t _ret_size;
    std::mutex _mutex;
    std::condition_variable _cond;
    Napi::FunctionReference _func;

    CuObjClientWorker(const Napi::CallbackInfo& info);
    virtual void Execute() override;
    virtual void OnOK() override;

    ssize_t start_op(
        cuObjOpType_t op_type,
        const void* handle,
        const void* ptr,
        size_t size,
        loff_t offset,
        const cufileRDMAInfo_t* rdma_info);
    void send_op(Napi::Env env);
};

Napi::FunctionReference CuObjClientNapi::constructor;

Napi::Function
CuObjClientNapi::Init(Napi::Env env)
{
    constructor = Napi::Persistent(DefineClass(env,
        "CuObjClientNapi",
        {
            InstanceMethod<&CuObjClientNapi::close>("close"),
            InstanceMethod<&CuObjClientNapi::rdma>("rdma"),
        }));
    constructor.SuppressDestruct();
    return constructor.Value();
}

static ssize_t
get_op_fn(const void* handle, char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    CuObjClientWorker* w = reinterpret_cast<CuObjClientWorker*>(cuObjClient::getCtx(handle));
    return w->start_op(CUOBJ_GET, handle, ptr, size, offset, rdma_info);
}

static ssize_t
put_op_fn(const void* handle, const char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    CuObjClientWorker* w = reinterpret_cast<CuObjClientWorker*>(cuObjClient::getCtx(handle));
    return w->start_op(CUOBJ_PUT, handle, ptr, size, offset, rdma_info);
}

CuObjClientNapi::CuObjClientNapi(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CuObjClientNapi>(info)
{
    DBG0("CuObjClientNapi::ctor");

    uint32_t log_flags =
        // CUOBJ_LOG_PATH_DEBUG |
        // CUOBJ_LOG_PATH_INFO |
        CUOBJ_LOG_PATH_ERROR;

    cuObjClient::setupTelemetry(true, &std::cout);
    cuObjClient::setTelemFlags(log_flags);

    CUObjOps_t ops = {
        .get = &get_op_fn,
        .put = &put_op_fn,
    };
    std::shared_ptr<cuObjClient> client(new cuObjClient(ops, CUOBJ_PROTO_RDMA_DC_V1));

    if (!client->isConnected()) {
        throw Napi::Error::New(info.Env(),
            XSTR() << "CuObjClientNapi::ctor connect failed (check rdma_dev_addr_list in cufile.json)");
    }

    // initialize a thread safe callback to the main thread
    // actual callback will be set in the worker
    auto noop = Napi::Function::New(
        info.Env(), [](const Napi::CallbackInfo& info) {});
    _thread_callback = Napi::ThreadSafeFunction::New(
        info.Env(), noop, "CuObjClientNapiThreadCallback", 0, 1, [](Napi::Env) {});

    _client = client;
}

CuObjClientNapi::~CuObjClientNapi()
{
    DBG0("CuObjClientNapi::dtor");
    _client.reset();
}

Napi::Value
CuObjClientNapi::close(const Napi::CallbackInfo& info)
{
    DBG0("CuObjClientNapi::close");
    _client.reset();
    return info.Env().Undefined();
}

Napi::Value
CuObjClientNapi::rdma(const Napi::CallbackInfo& info)
{
    return await_worker<CuObjClientWorker>(info);
}

CuObjClientWorker::CuObjClientWorker(const Napi::CallbackInfo& info)
    : ObjectWrapWorker<CuObjClientNapi>(info)
    , _op_type(CUOBJ_INVALID)
    , _ptr(0)
    , _size(0)
    , _rdma_size(0)
    , _rdma_offset(0)
    , _ret_size(-1)
{
    auto op_type = info[0].As<Napi::String>().Utf8Value();
    auto buf = info[1].As<Napi::Buffer<uint8_t>>();
    auto func = info[2].As<Napi::Function>();

    if (op_type == "GET") {
        _op_type = CUOBJ_GET;
    } else if (op_type == "PUT") {
        _op_type = CUOBJ_PUT;
    } else {
        throw Napi::Error::New(info.Env(),
            XSTR() << "CuObjClientWorker: bad op type " << DVAL(op_type));
    }

    _ptr = buf.Data();
    _size = buf.Length();
    _func = Napi::Persistent(func);
}

void
CuObjClientWorker::Execute()
{
    DBG1("CuObjClientWorker: Execute "
        << DVAL(_op_type)
        << DVAL(_ptr)
        << DVAL(_size));
    std::shared_ptr<cuObjClient> client(_wrap->_client);

    // register rdma buffer
    cuObjErr_t ret_get_mem = client->cuMemObjGetDescriptor(_ptr, _size);
    if (ret_get_mem != CU_OBJ_SUCCESS) {
        std::string err = strerror(errno);
        SetError(XSTR() << "CuObjClientWorker: Failed to register rdma buffer " << DVAL(err));
        return;
    }
    StackCleaner cleaner([&] {
        // release rdma buffer
        cuObjErr_t ret_put_mem = client->cuMemObjPutDescriptor(_ptr);
        if (ret_put_mem != CU_OBJ_SUCCESS) {
            std::string err = strerror(errno);
            SetError(XSTR() << "CuObjClientWorker: Failed to release rdma buffer " << DVAL(err));
        }
    });

    if (_op_type == CUOBJ_GET) {
        _ret_size = client->cuObjGet(this, _ptr, _size);
    } else if (_op_type == CUOBJ_PUT) {
        _ret_size = client->cuObjPut(this, _ptr, _size);
    } else {
        PANIC("bad op type " << DVAL(_op_type));
    }

    if (_ret_size < 0 || _ret_size != ssize_t(_size)) {
        std::string err = strerror(errno);
        SetError(XSTR() << "CuObjClientWorker: op failed "
                        << DVAL(_op_type) << DVAL(_ret_size) << DVAL(err));
    }
}

void
CuObjClientWorker::OnOK()
{
    _promise.Resolve(Napi::Number::New(Env(), _ret_size));
}

ssize_t
CuObjClientWorker::start_op(
    cuObjOpType_t op_type,
    const void* handle,
    const void* ptr,
    size_t size,
    loff_t offset,
    const cufileRDMAInfo_t* rdma_info)
{
    std::string rdma_desc(rdma_info->desc_str, rdma_info->desc_len - 1);
    DBG1("CuObjClientWorker::start_op " << DVAL(op_type) << DVAL(ptr) << DVAL(size) << DVAL(offset) << DVAL(rdma_desc));

    std::unique_lock lock(_mutex);

    ASSERT(op_type == _op_type, DVAL(op_type) << DVAL(_op_type));
    ASSERT(ptr == _ptr, DVAL(ptr) << DVAL(_ptr));
    ASSERT(size == _size, DVAL(size) << DVAL(_size));
    ASSERT(offset == 0, DVAL(offset));

    _rdma_desc = rdma_desc;
    _rdma_addr = XSTR() << std::hex << std::setw(16) << uintptr_t(ptr);
    _rdma_size = size;
    _rdma_offset = offset;

    _wrap->_thread_callback.Acquire();
    _wrap->_thread_callback.BlockingCall(
        [this](Napi::Env env, Napi::Function noop) {
            send_op(env);
        });
    _wrap->_thread_callback.Release();

    // after sending the op on main thread, the worker now waits for wakeup
    _cond.wait(lock);
    lock.unlock();

    DBG1("CuObjClientWorker::start_op done " << DVAL(_ret_size));
    return size;
}

void
CuObjClientWorker::send_op(Napi::Env env)
{
    DBG1("CuObjClientWorker::send_op");
    Napi::HandleScope scope(env);

    auto rdma_info = Napi::Object::New(env);
    rdma_info["desc"] = Napi::String::New(env, _rdma_desc);
    rdma_info["addr"] = Napi::String::New(env, _rdma_addr);
    rdma_info["size"] = Napi::Number::New(env, _rdma_size);
    rdma_info["offset"] = Napi::Number::New(env, _rdma_offset);

    // define a node-style callback function(err, result)
    auto callback = Napi::Function::New(env, [this](const Napi::CallbackInfo& info) {
        std::unique_lock lock(_mutex);

        // TODO handle error/result better
        if (info[0].IsNull()) {
            _ret_size = _size;
        } else {
            _ret_size = -1;
        }

        _cond.notify_one();
        lock.unlock();
    });

    _func.Call({ rdma_info, callback });
}

#endif // #if CUOBJ_CLIENT

void
rdma_client_napi(Napi::Env env, Napi::Object exports)
{
#if CUOBJ_CLIENT
    exports["CuObjClientNapi"] = CuObjClientNapi::Init(env);
    DBG0("RDMA: CUOBJ_CLIENT loaded");
#else
    DBG1("RDMA: CUOBJ_CLIENT not loaded - use build option: GYP_DEFINES=\"CUOBJ_CLIENT=1\" npm run build");
#endif
}

} // namespace noobaa
