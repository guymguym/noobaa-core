/*
Usage:
-----
g++ -g -Og -o cuguy cuguy.cpp -I/usr/local/cuda/include -Wl,--unresolved-symbols=ignore-in-object-files -ldl
// or
g++ -g -Og -o cuguy cuguy.cpp -I/usr/local/cuda/include -L/usr/local/cuda/lib64 -lcuobjclient -lcuda -ldl
./cuguy
-----
*/

#include <dlfcn.h>
#include <iostream>
#include <sstream>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <thread>
#include <vector>

#include "cuobjclient.h"
#include <cuda.h>
typedef off_t loff_t;

using namespace std;

static const int GPU = 0;
static const int THREADS = 32;
static const int ITER = 100;
static const size_t SIZE = 16 * 1024 * 1024;

static CUdevice cuda_device = 0;
static CUcontext cuda_ctx = 0;
static thread_local cuObjClient* cuobj = nullptr;

#define MUST_EQ(x, y) MUST((x) == (y), (x) << " != " << (y))
#define MUST(x, msg)                                             \
    do {                                                         \
        if (!(x)) {                                              \
            cerr << "MUST ERROR: " << #x << ": " << msg << endl; \
            abort();                                             \
        }                                                        \
    } while (0)

#define CU(fn)                                                           \
    do {                                                                 \
        CUresult r = fn;                                                 \
        if (r != CUDA_SUCCESS) {                                         \
            const char* cuda_err = "";                                   \
            cuGetErrorName(r, &cuda_err);                                \
            cerr << "CUDA ERROR: " << cuda_err << " at " << #fn << endl; \
            abort();                                                     \
        }                                                                \
    } while (0)

static ssize_t get_op(const void* handle, char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info);
static ssize_t put_op(const void* handle, const char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info);

struct Buf
{
    size_t size;
    void* host_buf;
    CUdeviceptr cuda_buf;

    Buf(size_t sz) : size(sz)
    {
        host_buf = malloc(size);
        memset(host_buf, 'A', size);

        CUmemorytype mem_type = CUmemorytype(0);
        CU(cuMemAlloc(&cuda_buf, size));
        CU(cuMemsetD8(cuda_buf, 'B', size));
        CU(cuPointerGetAttribute(&mem_type, CU_POINTER_ATTRIBUTE_MEMORY_TYPE, cuda_buf));
        CU(cuCtxSynchronize());
        cerr << "Buf::Buf(" << this << "): size=" << size << " cuda_buf=" << (void*)cuda_buf << " host_buf=" << host_buf << " mem_type=" << mem_type << endl;
    }

    ~Buf()
    {
        cerr << "Buf::~Buf(" << this << "): size=" << size << " cuda_buf=" << (void*)cuda_buf << " host_buf=" << host_buf << endl;

        free(host_buf);
        host_buf = 0;

        CU(cuMemFree(cuda_buf));
        cuda_buf = 0;
    }

    void reg()
    {
        void* addr = (void*)cuda_buf;

        cuObjMemoryType_t mem_type = cuObjClient::getMemoryType(addr);
        cerr << "Buf::reg(" << this << "): getMemoryType: mem_type=" << mem_type << endl;

        cuObjErr_t cuobj_err = cuobj->cuMemObjGetDescriptor(addr, size);
        cerr << "Buf::reg(" << this << "): cuMemObjGetDescriptor: cuobj_err=" << cuobj_err << endl;

        ssize_t max_size = cuobj->cuMemObjGetMaxRequestCallbackSize(addr);
        cerr << "Buf::reg(" << this << "): cuMemObjGetMaxRequestCallbackSize: max_size=" << max_size << endl;

        MUST_EQ(mem_type, CUOBJ_MEMORY_CUDA_DEVICE);
        MUST_EQ(cuobj_err, CU_OBJ_SUCCESS);
        MUST(max_size >= size, "max callback size " << max_size << " is smaller than buffer size " << size);
    }

    void get()
    {
        cerr << "Buf::get(" << this << "): calling cuObjGet..." << endl;
        ssize_t ret_size = cuobj->cuObjGet(this, (void*)cuda_buf, size);
        cerr << "Buf::get(" << this << "): cuObjGet: ret_size=" << ret_size << endl;
        MUST_EQ(ret_size, size);
    }

    void put()
    {
        cerr << "Buf::put(" << this << "): calling cuObjPut..." << endl;
        ssize_t ret_size = cuobj->cuObjPut(this, (void*)cuda_buf, size);
        cerr << "Buf::put(" << this << "): cuObjPut: ret_size=" << ret_size << endl;
        MUST_EQ(ret_size, size);
    }

    void check_descriptor(const cufileRDMAInfo_t* rdma_info)
    {
        string desc(rdma_info->desc_str, rdma_info->desc_len - 1);
        stringstream ss(desc);
        string ptr;
        string sz;
        getline(ss, ptr, ':');
        getline(ss, sz, ':');
        size_t desc_size = stoull(sz, nullptr, 16);
        MUST_EQ(desc_size, size);
    }

    ssize_t get_op(char* ptr, size_t sz, loff_t offset, const cufileRDMAInfo_t* rdma_info)
    {
        cerr << "Buf::get_op(" << this << "): ptr=" << (void*)ptr << " size=" << sz << " offset=" << offset << " desc=" << rdma_info->desc_str << endl;
        check_descriptor(rdma_info);
        CU(cuMemcpyHtoD(cuda_buf, host_buf, size));
        return size;
    }

    ssize_t put_op(const char* ptr, size_t sz, loff_t offset, const cufileRDMAInfo_t* rdma_info)
    {
        cerr << "Buf::put_op(" << this << "): ptr=" << (void*)ptr << " size=" << sz << " offset=" << offset << " desc=" << rdma_info->desc_str << endl;
        check_descriptor(rdma_info);
        CU(cuMemcpyDtoH(host_buf, cuda_buf, size));
        return size;
    }
};

static ssize_t
get_op(const void* handle, char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    Buf* b = (Buf*)cuObjClient::getCtx(handle);
    return b->get_op(ptr, size, offset, rdma_info);
}

static ssize_t
put_op(const void* handle, const char* ptr, size_t size, loff_t offset, const cufileRDMAInfo_t* rdma_info)
{
    Buf* b = (Buf*)cuObjClient::getCtx(handle);
    return b->put_op(ptr, size, offset, rdma_info);
}

void
worker(int id)
{
    CU(cuCtxSetCurrent(cuda_ctx));

    CUObjIOOps ops = { .get = get_op, .put = put_op };
    cuobj = new cuObjClient(ops, CUOBJ_PROTO_RDMA_DC_V1);
    if (!cuobj->isConnected()) {
        cerr << "ERROR: Failed to connect cuObjClient (check rdma_dev_addr_list in cufile.json)" << endl;
        exit(1);
    }

    Buf* b = new Buf(SIZE);
    b->reg();
    for (int i = 0; i < ITER; ++i) {
        b->get();
        memset(b->host_buf, 0, b->size);
        b->put();
    }
    delete b;
}

int
main()
{
    cerr << "Loading libraries..." << endl;
    const char* cuda_lib_path = "/usr/lib/x86_64-linux-gnu/libcuda.so";
    if (!dlopen(cuda_lib_path, RTLD_NOW | RTLD_GLOBAL)) {
        cerr << "dlopen failed: " << cuda_lib_path << endl;
        exit(1);
    }
    const char* cuobj_lib_path = "/usr/local/cuda/lib64/libcuobjclient.so";
    if (!dlopen(cuobj_lib_path, RTLD_NOW | RTLD_GLOBAL)) {
        cerr << "dlopen failed: " << cuobj_lib_path << endl;
        exit(1);
    }

    cerr << "Initializing CUDA..." << endl;
    CU(cuInit(/* flags */ 0));
    CU(cuDeviceGet(&cuda_device, GPU));
    CU(cuDevicePrimaryCtxRetain(&cuda_ctx, cuda_device));
    CU(cuCtxSetCurrent(cuda_ctx));
    cerr << "CUDA initialized: gpu=" << GPU << " cuda_device=" << cuda_device << " cuda_ctx=" << (void*)cuda_ctx << endl;

    std::vector<std::thread> threads;

    for (int i = 0; i < THREADS; ++i) {
        threads.emplace_back(worker, i); // constructs and start thread
    }
    for (auto& t : threads) {
        if (t.joinable()) t.join();
    }

    CU(cuDevicePrimaryCtxRelease(cuda_device));
    cerr << "CUDA freed" << endl;
    return 0;
}
