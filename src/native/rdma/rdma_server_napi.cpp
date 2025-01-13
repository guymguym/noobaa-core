/* Copyright (C) 2016 NooBaa */
#include "../util/b64.h"
#include "../util/buf.h"
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/os.h"
#include "../util/worker.h"

/**
 * Use build option: GYP_DEFINES="CUOBJ_SERVER=1" npm run build
 */
#define CUOBJ_SERVER 1

#if CUOBJ_SERVER
typedef off_t loff_t;
struct rdma_buffer;
    #include "cuobjserver.h"
    #include "protocol.h"
#endif

namespace noobaa
{

DBG_INIT(0);

#if CUOBJ_SERVER

/**
 * CuObjServerNapi is a napi object wrapper for cuObjServer.
 */
struct CuObjServerNapi : public Napi::ObjectWrap<CuObjServerNapi>
{
    static Napi::FunctionReference constructor;
    std::shared_ptr<cuObjServer> _server;
    Napi::Reference<Napi::Symbol> _buffer_symbol;

    static Napi::Function Init(Napi::Env env);
    CuObjServerNapi(const Napi::CallbackInfo& info);
    ~CuObjServerNapi();
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value registerBuffer(const Napi::CallbackInfo& info);
    Napi::Value deRegisterBuffer(const Napi::CallbackInfo& info);
    Napi::Value rdma(const Napi::CallbackInfo& info);
};

struct CuObjServerWorker : public ObjectWrapWorker<CuObjServerNapi>
{
    std::shared_ptr<cuObjServer> _server;
    cuObjOpType_t _op_type;
    std::string _op_key;
    void* _ptr;
    size_t _size;
    struct rdma_buffer* _rdma_buf;
    std::string _rdma_desc;
    uint64_t _rdma_addr;
    size_t _rdma_size;
    loff_t _rdma_offset;
    ssize_t _ret_size;
    thread_local static uint16_t _thread_channel_id;

    CuObjServerWorker(const Napi::CallbackInfo& info);
    virtual void Execute() override;
    virtual void OnOK() override;
};

Napi::FunctionReference CuObjServerNapi::constructor;
thread_local uint16_t CuObjServerWorker::_thread_channel_id = INVALID_CHANNEL_ID;
typedef Napi::External<struct rdma_buffer> ExternalRdmaBuf;

static inline int32_t asi32(Napi::Value v);
static inline uint32_t asu32(Napi::Value v);
static inline uint32_t asi64(Napi::Value v);
static inline std::string asstr(Napi::Value v);

Napi::Function
CuObjServerNapi::Init(Napi::Env env)
{
    constructor = Napi::Persistent(DefineClass(env,
        "CuObjServerNapi",
        {
            InstanceMethod<&CuObjServerNapi::close>("close"),
            InstanceMethod<&CuObjServerNapi::registerBuffer>("registerBuffer"),
            InstanceMethod<&CuObjServerNapi::deRegisterBuffer>("deRegisterBuffer"),
            InstanceMethod<&CuObjServerNapi::rdma>("rdma"),
        }));
    constructor.SuppressDestruct();
    return constructor.Value();
}

/**
 * @param {{
 *      ip: string,
 *      port: number,
 *      log_level?: 'ERROR'|'INFO'|'DEBUG',
 *      num_dcis?: number,
 *      cq_depth?: number,
 *      dc_key?: number,
 *      ibv_poll_max_comp_event?: number,
 *      service_level?: number,
 *      min_rnr_timer?: number,
 *      hop_limit?: number,
 *      pkey_index?: number,
 *      max_wr?: number,
 *      max_sge?: number,
 *      delay_mode?: number,
 *      delay_interval?: number,
 * }} params = info[0]
 */
CuObjServerNapi::CuObjServerNapi(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CuObjServerNapi>(info)
{
    auto env = info.Env();
    const Napi::Object params = info[0].As<Napi::Object>();
    std::string ip = params["ip"].As<Napi::String>().Utf8Value();
    unsigned short port = params["port"].As<Napi::Number>().Uint32Value();

    uint32_t log_flags = 0;
    if (params["log_level"].IsString()) {
        std::string log_level = asstr(params["log_level"]);
        if (log_level == "DEBUG") {
            log_flags |= CUOBJ_LOG_PATH_ERROR;
            log_flags |= CUOBJ_LOG_PATH_INFO;
            log_flags |= CUOBJ_LOG_PATH_DEBUG;
        } else if (log_level == "INFO") {
            log_flags |= CUOBJ_LOG_PATH_ERROR;
            log_flags |= CUOBJ_LOG_PATH_INFO;
        } else if (log_level == "ERROR") {
            log_flags |= CUOBJ_LOG_PATH_ERROR;
        } else {
            throw Napi::Error::New(env,
                XSTR() << "CuObjServerNapi::ctor bad " << DVAL(log_level));
        }
    }

    cuObjRDMATunable rdma_params;
    if (params["num_dcis"].IsNumber()) {
        rdma_params.setNumDcis(asi32(params["num_dcis"]));
    }
    if (params["cq_depth"].IsNumber()) {
        rdma_params.setCqDepth(asu32(params["cq_depth"]));
    }
    if (params["dc_key"].IsNumber()) {
        rdma_params.setDcKey(asi64(params["dc_key"]));
    }
    if (params["ibv_poll_max_comp_event"].IsNumber()) {
        rdma_params.setIbvPollMaxCompEv(asi32(params["ibv_poll_max_comp_event"]));
    }
    if (params["service_level"].IsNumber()) {
        rdma_params.setServiceLevel(asi32(params["service_level"]));
    }
    if (params["min_rnr_timer"].IsNumber()) {
        rdma_params.setMinRnrTimer(asi32(params["min_rnr_timer"]));
    }
    if (params["hop_limit"].IsNumber()) {
        rdma_params.setHopLimit(asu32(params["hop_limit"]));
    }
    if (params["pkey_index"].IsNumber()) {
        rdma_params.setPkeyIndex(asi32(params["pkey_index"]));
    }
    if (params["max_wr"].IsNumber()) {
        rdma_params.setMaxWr(asi32(params["max_wr"]));
    }
    if (params["max_sge"].IsNumber()) {
        rdma_params.setMaxSge(asi32(params["max_sge"]));
    }
    if (params["delay_mode"].IsNumber()) {
        rdma_params.setDelayMode(cuObjDelayMode_t(asi32(params["delay_mode"])));
    }
    if (params["delay_interval"].IsNumber()) {
        rdma_params.setDelayInterval(asu32(params["delay_interval"]));
    }

    DBG0("CuObjServerNapi::ctor "
        << DVAL(ip) << DVAL(port) << DVAL(log_flags)
        << "num_dcis=" << rdma_params.getNumDcis() << " "
        << "cq_depth=" << rdma_params.getCqDepth() << " "
        << "dc_key=" << rdma_params.getDcKey() << " "
        << "ibv_poll_max_comp_event=" << rdma_params.getIbvPollMaxCompEv() << " "
        << "service_level=" << rdma_params.getServiceLevel() << " "
        << "min_rnr_timer=" << rdma_params.getMinRnrTimer() << " "
        << "hop_limit=" << rdma_params.getHopLimit() << " "
        << "pkey_index=" << rdma_params.getPkeyIndex() << " "
        << "max_wr=" << rdma_params.getMaxWr() << " "
        << "max_sge=" << rdma_params.getMaxSge() << " "
        << "delay_mode=" << rdma_params.getDelayMode() << " "
        << "delay_interval=" << rdma_params.getDelayInterval() << " ");

    cuObjServer::setupTelemetry(true, &std::cout);
    cuObjServer::setTelemFlags(log_flags);

    std::shared_ptr<cuObjServer> server(new cuObjServer(
        ip.c_str(), port, CUOBJ_PROTO_RDMA_DC_V1, rdma_params));

    if (!server->isConnected()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi::ctor connect failed " << DVAL(ip) << DVAL(port));
    }

    _server = server;
    _buffer_symbol = Napi::Persistent(Napi::Symbol::New(env, "CuObjServerNapiBufferSymbol"));
}

CuObjServerNapi::~CuObjServerNapi()
{
    DBG0("CuObjServerNapi::dtor");
    _server.reset();
}

Napi::Value
CuObjServerNapi::close(const Napi::CallbackInfo& info)
{
    DBG0("CuObjServerNapi::close");
    _server.reset();
    return info.Env().Undefined();
}

/**
 * @param {Buffer} buf = info[0]
 */
Napi::Value
CuObjServerNapi::registerBuffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    void* ptr = buf.Data();
    size_t size = buf.Length();
    auto sym = _buffer_symbol.Value();

    if (buf.Get(sym).IsExternal()) {
        return env.Undefined();
        // throw Napi::Error::New(env,
        //     XSTR() << "CuObjServerWorker: Already registered rdma buffer " << DVAL(ptr) << DVAL(size));
    }

    struct rdma_buffer* rdma_buf = _server->registerBuffer(ptr, size);
    if (!rdma_buf) {
        std::string err = strerror(errno);
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: Failed to register rdma buffer " << DVAL(err) << DVAL(ptr) << DVAL(size));
    }

    buf.Set(sym, ExternalRdmaBuf::New(env, rdma_buf));
    return env.Undefined();
}

/**
 * @param {Buffer} buf = info[0]
 */
Napi::Value
CuObjServerNapi::deRegisterBuffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    void* ptr = buf.Data();
    size_t size = buf.Length();
    auto sym = _buffer_symbol.Value();

    if (!buf.Get(sym).IsExternal()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: No registered rdma buffer " << DVAL(ptr) << DVAL(size));
    }

    auto rdma_buf = buf.Get(sym).As<ExternalRdmaBuf>().Data();
    _server->deRegisterBuffer(rdma_buf);

    buf.Delete(sym);
    return env.Undefined();
}

/**
 * async function to start and await a CuObjServerWorker threadpool worker
 *
 * @param {'GET'|'PUT'} op_type = info[0]
 * @param {string} op_key = info[1]
 * @param {Buffer} buf = info[2]
 * @param {{
 *      desc: string,
 *      addr: string,
 *      size: number,
 *      offset: number,
 *  }} rdma_info = info[3]
 */
Napi::Value
CuObjServerNapi::rdma(const Napi::CallbackInfo& info)
{
    return await_worker<CuObjServerWorker>(info);
}

CuObjServerWorker::CuObjServerWorker(const Napi::CallbackInfo& info)
    : ObjectWrapWorker<CuObjServerNapi>(info)
    , _server(_wrap->_server)
    , _op_type(CUOBJ_INVALID)
    , _ptr(0)
    , _size(0)
    , _rdma_buf(0)
    , _rdma_addr(0)
    , _rdma_size(0)
    , _rdma_offset(0)
    , _ret_size(-1)
{
    auto env = info.Env();
    auto op_type = info[0].As<Napi::String>().Utf8Value();
    _op_key = info[1].As<Napi::String>().Utf8Value();
    auto buf = info[2].As<Napi::Buffer<uint8_t>>();
    auto rdma_info = info[3].As<Napi::Object>();

    _rdma_desc = rdma_info.Get("desc").As<Napi::String>().Utf8Value();
    auto rdma_addr = rdma_info.Get("addr").As<Napi::String>().Utf8Value();
    auto rdma_size = rdma_info.Get("size").As<Napi::Number>().Int64Value();
    _rdma_offset = rdma_info.Get("offset").As<Napi::Number>().Int64Value();

    if (op_type == "GET") {
        _op_type = CUOBJ_GET;
    } else if (op_type == "PUT") {
        _op_type = CUOBJ_PUT;
    } else {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad op type " << DVAL(op_type));
    }

    _ptr = buf.Data();
    _size = buf.Length();
    _rdma_addr = strtoull(rdma_addr.c_str(), 0, 16);
    _rdma_size = size_t(rdma_size);
    auto sym = _wrap->_buffer_symbol.Value();

    if (_rdma_desc.size() + 1 != sizeof RDMA_DESC_STR) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma desc " << DVAL(_rdma_desc));
    }
    if (_rdma_addr == 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma addr " << DVAL(rdma_addr) << DVAL(_rdma_addr));
    }
    if (rdma_size <= 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma size " << DVAL(rdma_size));
    }
    if (_rdma_offset < 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma offset " << DVAL(_rdma_offset));
    }
    if (_size < _rdma_size) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: buffer too small for rdma size " << DVAL(_size) << DVAL(_rdma_size));
    }
    if (!buf.Get(sym).IsExternal()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: No registered rdma buffer " << DVAL(_ptr) << DVAL(_size));
    }

    _rdma_buf = buf.Get(sym).As<ExternalRdmaBuf>().Data();
}

void
CuObjServerWorker::Execute()
{
    DBG1("CuObjServerWorker: Execute "
        << DVAL(_op_type)
        << DVAL(_op_key)
        << DVAL(_ptr)
        << DVAL(_size)
        << DVAL(_rdma_buf)
        << DVAL(_rdma_desc)
        << DVAL(_rdma_addr)
        << DVAL(_rdma_size)
        << DVAL(_rdma_offset));

    // lazy allocate channel id and keep it in thread local storage
    // we currently do not free those channel ids
    if (_thread_channel_id == INVALID_CHANNEL_ID) {
        _thread_channel_id = _server->allocateChannelId();
        if (_thread_channel_id == INVALID_CHANNEL_ID) {
            std::string err = strerror(errno);
            SetError(XSTR() << "CuObjServerWorker: Failed to allocate channel id " << DVAL(err));
            return;
        }
    }

    if (_op_type == CUOBJ_GET) {
        _ret_size = _server->handleGetObject(
            _op_key, _rdma_buf, _rdma_addr, _rdma_size, _rdma_desc, _thread_channel_id);
    } else if (_op_type == CUOBJ_PUT) {
        _ret_size = _server->handlePutObject(
            _op_key, _rdma_buf, _rdma_addr, _rdma_size, _rdma_desc, _thread_channel_id);
    } else {
        PANIC("bad op type " << DVAL(_op_type));
    }

    if (_ret_size < 0) {
        std::string err = strerror(errno);
        SetError(XSTR() << "CuObjServerWorker: op failed "
                        << DVAL(_op_type) << DVAL(_ret_size) << DVAL(err));
    }
}

void
CuObjServerWorker::OnOK()
{
    _promise.Resolve(Napi::Number::New(Env(), _ret_size));
}

static inline int32_t
asi32(Napi::Value v)
{
    return v.As<Napi::Number>().Int32Value();
}

static inline uint32_t
asu32(Napi::Value v)
{
    return v.As<Napi::Number>().Uint32Value();
}

static inline uint32_t
asi64(Napi::Value v)
{
    return v.As<Napi::Number>().Int64Value();
}

static inline std::string
asstr(Napi::Value v)
{
    return v.As<Napi::String>().Utf8Value();
}

#endif // #if CUOBJ_SERVER

void
rdma_server_napi(Napi::Env env, Napi::Object exports)
{
#if CUOBJ_SERVER
    exports["CuObjServerNapi"] = CuObjServerNapi::Init(env);
    DBG0("RDMA: CUOBJ_SERVER loaded");
#else
    DBG1("RDMA: CUOBJ_SERVER not loaded - use build option: GYP_DEFINES=\"CUOBJ_SERVER=1\" npm run build");
#endif
}

} // namespace noobaa
