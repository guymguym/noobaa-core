/* Copyright (C) 2016 NooBaa */
#include "../util/b64.h"
#include "../util/common.h"
#include "../util/napi.h"

#include <uv.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <dirent.h>
#include <vector>
#include <math.h>
#include <unistd.h>
#if !defined(_POSIX_C_SOURCE) || defined(_DARWIN_C_SOURCE)
#else
    #include <sys/fsuid.h>
#endif

namespace noobaa
{

DBG_INIT(0);

struct Entry {
    std::string name;
    ino_t ino;
    uint8_t type;
};

int fs_setuid(uid_t uid) {
    #if !defined(_POSIX_C_SOURCE) || defined(_DARWIN_C_SOURCE)
        int r = setuid(uid);
    #else
        //  No error indications of any kind are returned to the caller, and
        //  the fact that both successful and unsuccessful calls return the
        //  same value makes it impossible to directly determine whether the
        //  call succeeded or failed.  Instead, the caller must resort to
        //  looking at the return value from a further call such as
        //  setfsuid(-1) (which will always fail), in order to determine if a
        //  preceding call to setfsuid() changed the filesystem user ID.
        int current = setfsuid(-1);
        int r = setfsuid(uid);
        if (current == r) {
            r = -1;
        }
    #endif
    return r;
}

int fs_setgid(gid_t gid) {
    #if !defined(_POSIX_C_SOURCE) || defined(_DARWIN_C_SOURCE)
        int r = setgid(gid);
    #else
        //  No error indications of any kind are returned to the caller, and
        //  the fact that both successful and unsuccessful calls return the
        //  same value makes it impossible to directly determine whether the
        //  call succeeded or failed.  Instead, the caller must resort to
        //  looking at the return value from a further call such as
        //  setfsgid(-1) (which will always fail), in order to determine if a
        //  preceding call to setfsgid() changed the filesystem user ID.
        int current = setfsgid(-1);
        int r = setfsgid(gid);
        if (current == r) {
            r = -1;
        }
    #endif
    return r;
}

uid_t fs_getuid() {
    #if !defined(_POSIX_C_SOURCE) || defined(_DARWIN_C_SOURCE)
        int r = getuid();
    #else
        // There is no getfsuid, using set without value allows us to get the current id
        int r = setfsuid(-1);
    #endif
    return r;
}

gid_t fs_getgid() {
    #if !defined(_POSIX_C_SOURCE) || defined(_DARWIN_C_SOURCE)
        int r = getgid();
    #else
        // There is no getfsgid, using set without value allows us to get the current id
        int r = setfsgid(-1);
    #endif
    return r;
}

static uid_t orig_uid = fs_getuid();
static gid_t orig_gid = fs_getgid();

template <typename T>
static Napi::Value api(const Napi::CallbackInfo& info)
{
    auto w = new T(info);
    Napi::Promise promise = w->_deferred.Promise();
    w->Queue();
    return promise;
}

/**
 * FSWorker is a general async worker for our fs operations
 */
struct FSWorker : public Napi::AsyncWorker
{
    Napi::Promise::Deferred _deferred;
    gid_t _req_uid;
    uid_t _req_gid;
    std::string _backend;
    int _errno;
    std::string _desc;

    FSWorker(const Napi::CallbackInfo& info)
        : AsyncWorker(info.Env())
        , _deferred(Napi::Promise::Deferred::New(info.Env()))
        , _errno(0)
    {
        Napi::Object config = info[0].As<Napi::Object>();        
        _req_uid = config.Has("uid") ? config.Get("uid").ToNumber() : orig_uid;
        _req_gid = config.Has("gid") ? config.Get("gid").ToNumber() : orig_gid;
        // TODO: Fill the relevant type
        _backend = config.Has("backend") ? config.Get("backend").ToString() : Napi::String::New(info.Env(), "");
    }
    void Begin(std::string desc)
    {
        _desc = desc;
        DBG1("FS::FSWorker::Begin: " << _desc);
    }
    virtual void Work() = 0;
    void Execute() {
        DBG1("FS::FSWorker::Start Execute: " << _desc << 
            " req_uid:" << _req_uid << 
            " req_gid:" << _req_gid << 
            " backend:" << _backend
        );
        bool change_uid = orig_uid != _req_uid;
        bool change_gid = orig_gid != _req_gid;
        if (change_uid) {
            int r = fs_setuid(_req_uid);
            if (r == -1) {
                SetSyscallError();
                return;
            }
        }
        if (change_gid) {
            int r = fs_setgid(_req_gid);
            if (r == -1) {
                SetSyscallError();
                return;
            }
        }
        Work();
        if (change_uid) {
            int r = fs_setuid(orig_uid);
            if (r == -1) {
                SetSyscallError();
                return;
            }
        }
        if (change_gid) {
            int r = fs_setgid(orig_gid);
            if (r == -1) {
                SetSyscallError();
                return;
            }
        }
    }
    void SetSyscallError()
    {
        if (_errno) {
            int current_errno = errno;
            DBG1("FS::FSWorker::SetSyscallError: errno already exists " << _desc << DVAL(_errno) << DVAL(current_errno));
        } else {
            _errno = errno;
            std::string errmsg = strerror(errno);
            SetError(errmsg);
        }
    }
    virtual void OnOK()
    {
        DBG1("FS::FSWorker::OnOK: undefined " << _desc);
        _deferred.Resolve(Env().Undefined());
    }
    virtual void OnError(Napi::Error const &error)
    {
        Napi::Env env = Env();
        DBG1("FS::FSWorker::OnError: " << _desc << " " << DVAL(error.Message()));
        auto obj = error.Value();
        if (_errno) {
            obj.Set("code", Napi::String::New(env, uv_err_name(uv_translate_sys_error(_errno))));
        }
        _deferred.Reject(obj);
    }
};

/**
 * Stat is an fs op
 */
struct Stat : public FSWorker
{
    std::string _path;
    struct stat _stat_res;

    Stat(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << DVAL(_path));
    }
    virtual void Work()
    {
        int r = stat(_path.c_str(), &_stat_res);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::Stat::OnOK: " << DVAL(_path) << DVAL(_stat_res.st_ino) << DVAL(_stat_res.st_size));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        res["dev"] = Napi::Number::New(env, _stat_res.st_dev);
        res["ino"] = Napi::Number::New(env, _stat_res.st_ino);
        res["mode"] = Napi::Number::New(env, _stat_res.st_mode);
        res["nlink"] = Napi::Number::New(env, _stat_res.st_nlink);
        res["uid"] = Napi::Number::New(env, _stat_res.st_uid);
        res["gid"] = Napi::Number::New(env, _stat_res.st_gid);
        res["rdev"] = Napi::Number::New(env, _stat_res.st_rdev);
        res["size"] = Napi::Number::New(env, _stat_res.st_size);
        res["blksize"] = Napi::Number::New(env, _stat_res.st_blksize);
        res["blocks"] = Napi::Number::New(env, _stat_res.st_blocks);

        // https://nodejs.org/dist/latest-v14.x/docs/api/fs.html#fs_stat_time_values
        #if !defined(_POSIX_C_SOURCE) || defined(_DARWIN_C_SOURCE)
            double atimeMs = (double(1e3) * _stat_res.st_atimespec.tv_sec) + (double(1e-6) * _stat_res.st_atimespec.tv_nsec);
            double ctimeMs = (double(1e3) * _stat_res.st_ctimespec.tv_sec) + (double(1e-6) * _stat_res.st_ctimespec.tv_nsec);
            double mtimeMs = (double(1e3) * _stat_res.st_mtimespec.tv_sec) + (double(1e-6) * _stat_res.st_mtimespec.tv_nsec);
            double birthtimeMs = (double(1e3) * _stat_res.st_birthtimespec.tv_sec) + (double(1e-6) * _stat_res.st_birthtimespec.tv_nsec);
        #else
            double atimeMs = (double(1e3) * _stat_res.st_atim.tv_sec) + (double(1e-6) * _stat_res.st_atim.tv_nsec);
            double ctimeMs = (double(1e3) * _stat_res.st_ctim.tv_sec) + (double(1e-6) * _stat_res.st_ctim.tv_nsec);
            double mtimeMs = (double(1e3) * _stat_res.st_mtim.tv_sec) + (double(1e-6) * _stat_res.st_mtim.tv_nsec);
            double birthtimeMs = ctimeMs; // Posix doesn't have birthtime
        #endif

        res["atimeMs"] = Napi::Number::New(env, atimeMs);
        res["ctimeMs"] = Napi::Number::New(env, ctimeMs);
        res["mtimeMs"] = Napi::Number::New(env, mtimeMs);
        res["birthtimeMs"] = Napi::Number::New(env, birthtimeMs);
        res["atime"] = Napi::Date::New(env, uint64_t(round(atimeMs)));
        res["mtime"] = Napi::Date::New(env, uint64_t(round(mtimeMs)));
        res["ctime"] = Napi::Date::New(env, uint64_t(round(ctimeMs)));
        res["birthtime"] = Napi::Date::New(env, uint64_t(round(birthtimeMs)));

        _deferred.Resolve(res);
    }
};

/**
 * Unlink is an fs op
 */
struct Unlink : public FSWorker
{
    std::string _path;
    Unlink(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << DVAL(_path));
    }
    virtual void Work()
    {
        int r = unlink(_path.c_str());
        if (r == -1) SetSyscallError();
    }
};


/**
 * Mkdir is an fs op
 */
struct Mkdir : public FSWorker
{
    std::string _path;
    Mkdir(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << DVAL(_path));
    }
    virtual void Work()
    {
        int r = mkdir(_path.c_str(), S_IRWXU);
        if (r == -1) SetSyscallError();
    }
};


/**
 * Rmdir is an fs op
 */
struct Rmdir : public FSWorker
{
    std::string _path;
    Rmdir(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << DVAL(_path));
    }
    virtual void Work()
    {
        int r = rmdir(_path.c_str());
        if (r == -1) SetSyscallError();
    }
};


/**
 * Rename is an fs op
 */
struct Rename : public FSWorker
{
    std::string _old_path;
    std::string _new_path;
    Rename(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _old_path = info[1].As<Napi::String>();
        _new_path = info[2].As<Napi::String>();
        Begin(XSTR() << DVAL(_old_path) << DVAL(_new_path));
    }
    virtual void Work()
    {
        int r = rename(_old_path.c_str(), _new_path.c_str());
        if (r == -1) SetSyscallError();
    }
};

/**
 * Writefile is an fs op
 */
struct Writefile : public FSWorker
{
    std::string _path;
    const uint8_t* _data;
    size_t _len;
    Writefile(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        auto buf = info[2].As<Napi::Buffer<uint8_t>>();
        _data = buf.Data();
        _len = buf.Length();
        Begin(XSTR() << DVAL(_path) << DVAL(_len));
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_WRONLY | O_CREAT);
        if (fd < 0) {
            SetSyscallError();
            return;
        }

        ssize_t len = write(fd, _data, _len);
        if (len < 0) {
            SetSyscallError();
        } else if ((size_t)len != _len) {
            SetError(XSTR() << "Writefile: partial write error " << DVAL(len) << DVAL(_len));
        }

        int r = close(fd);
        if (r) SetSyscallError();
    }
};

/**
 * Readfile is an fs op
 */
struct Readfile : public FSWorker
{
    std::string _path;
    uint8_t* _data;
    int _len;
    Readfile(const Napi::CallbackInfo& info) 
        : FSWorker(info)
        , _data(0)
        , _len(0)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << DVAL(_path));
    }
    virtual ~Readfile()
    {
        if (_data) {
            delete [] _data;
            _data = 0;
        }
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_RDONLY);
        if (fd < 0) {
            SetSyscallError();
            return;
        }
    
        struct stat stat_res;
        int r = fstat(fd, &stat_res);
        if (r) {
            SetSyscallError();
            r = close(fd);
            if (r) SetSyscallError(); // Report only
            return;
        }

        _len = stat_res.st_size;
        _data = new uint8_t[_len];

        uint8_t *p = _data;
        int remain = _len;
        while (remain > 0) {
            ssize_t len = read(fd, p, remain);
            if (len < 0) {
                SetSyscallError();
                break;
            }
            remain -= len;
            p += len;
        }

        r = close(fd);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        auto buf = Napi::Buffer<uint8_t>::Copy(Env(), _data, _len);
        _deferred.Resolve(buf);
    }
};


/**
 * Readdir is an fs op
 */
struct Readdir : public FSWorker
{
    std::string _path;
    // bool _withFileTypes;
    std::vector<Entry> _entries;
    Readdir(const Napi::CallbackInfo& info) 
        : FSWorker(info)
        , _entries(0)
    {
        _path = info[1].As<Napi::String>();
        // _withFileTypes = info[1].As<Napi::Boolean>();
        Begin(XSTR() << DVAL(_path));
    }
    virtual void Work()
    {
        DIR *dir;
        dir = opendir(_path.c_str());
        if (dir == NULL) {
            SetSyscallError();
            return;
        }

        while (true) {
            // need to set errno before the call to readdir() to detect between EOF and error
            errno = 0;
            struct dirent *e = readdir(dir);
            if (e) {
                // Ignore parent and current directories 
                if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0) {
                    continue;
                }
                _entries.push_back(Entry{ 
                    std::string(e->d_name),
                    e->d_ino, 
                    e->d_type 
                });
            } else {
                if (errno) SetSyscallError();
                break;
            }
        }

        int r = closedir(dir);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        Napi::Env env = Env();
        Napi::Array res = Napi::Array::New(env, _entries.size());
        int index = 0;
        // if (_withFileTypes) {
        for (auto it = _entries.begin(); it != _entries.end(); ++it) {
            auto dir_rec = Napi::Object::New(env);
            dir_rec["name"] = Napi::String::New(env, it->name);
            dir_rec["ino"] = Napi::Number::New(env, it->ino);
            dir_rec["type"] = Napi::Number::New(env, it->type);
            res[index] = dir_rec;
            index += 1;
        }
        // } else {
        //     for (auto it = _entries.begin(); it != _entries.end(); ++it) {
        //         res[index] = Napi::String::New(env, it->name);;
        //         index += 1;
        //     }
        // }
        _deferred.Resolve(res);
    }
};


struct FileWrap : public Napi::ObjectWrap<FileWrap>
{
    std::string _path;
    int _fd;
    static Napi::FunctionReference constructor;
    static void init(Napi::Env env)
    {
        Napi::HandleScope scope(env);
        Napi::Function func = DefineClass(env, "File", { 
          InstanceMethod("close", &FileWrap::close),
          InstanceMethod("read", &FileWrap::read),
        //   InstanceMethod("write", &FileWrap::write),
        });
        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();
    }
    FileWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<FileWrap>(info)
        , _fd(0)
    {
    }
    ~FileWrap() {
        if (_fd) {
            PANIC("FS::FileWrap::dtor: file not closed " << DVAL(_path) << DVAL(_fd));
        }
    }
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value read(const Napi::CallbackInfo& info);
    // Napi::Value write(const Napi::CallbackInfo& info);
};

Napi::FunctionReference FileWrap::constructor;

struct FileOpen : public FSWorker
{
    std::string _path;
    int _fd;
    FileOpen(const Napi::CallbackInfo& info) : FSWorker(info), _fd(0)
    {
        _path = info[1].As<Napi::String>();
        // TODO - info[1] { mode, readonly }
        Begin(XSTR() << DVAL(_path));
    }
    virtual void Work()
    {
        _fd = open(_path.c_str(), O_RDONLY); // TODO mode
        if (!_fd) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::DirOpen::OnOK: " << DVAL(_path));
        Napi::Object res = FileWrap::constructor.New({});
        FileWrap *w = FileWrap::Unwrap(res);
        w->_path = _path;
        w->_fd = _fd;
        _deferred.Resolve(res);
    }
};

struct FileClose : public FSWorker
{
    FileWrap *_wrap;
    FileClose(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _wrap = FileWrap::Unwrap(info.This().As<Napi::Object>());
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        std::string path = _wrap->_path;
        int r = close(fd);
        if (r) SetSyscallError();
        _wrap->_fd = 0;
    }
};


struct FileRead : public FSWorker
{
    FileWrap *_wrap;
    uint8_t* _buf;
    off_t _offset;
    int _len;
    int _pos;
    ssize_t _br;
    FileRead(const Napi::CallbackInfo& info) 
        : FSWorker(info) 
        , _buf(0)
        , _offset(0)
        , _len(0)
        , _pos(0)
    {
        _wrap = FileWrap::Unwrap(info.This().As<Napi::Object>());
        auto buf = info[1].As<Napi::Buffer<uint8_t>>();
        _buf = buf.Data();
        _offset = info[2].As<Napi::Number>();
        _len = info[3].As<Napi::Number>();
        _pos = info[4].As<Napi::Number>();
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        std::string path = _wrap->_path;
        if (fd < 0) {
            SetError(XSTR() << "FS::FileRead::Execute: ERROR not opened " << path);
            return;
        }
        _br = pread(fd, _buf + _offset, _len, _pos);
        if (_br < 0) {
            SetSyscallError();
            return;
        }
    }
    virtual void OnOK()
    {
        Napi::Env env = Env();
        _deferred.Resolve(Napi::Number::New(env, _br));
    }
};

// struct FileWrite : public FSWorker
// {
//     FileWrap *_wrap;
//     const uint8_t* _buf;
//     size_t _len;
//     FileWrite(const Napi::CallbackInfo& info) : FSWorker(info)
//     {
//         _wrap = FileWrap::Unwrap(info.This().As<Napi::Object>());
//         _buf = info[0].As<Napi::Buffer<uint8_t>>();
//         _buf = info[1].As<Napi::Value<size_t>>();
//         // TODO get buffer from info[0]
//     }
//     virtual void Work()
//     {
//         int fd = _wrap->_fd;
//         std::string path = _wrap->_path;
//         if (fd < 0) {
//             SetError(XSTR() << "FS::FileWrite::Execute: ERROR not opened " << path);
//             return;
//         }

//         // TODO - read(fd, buf...)
//     }
// };


Napi::Value FileWrap::close(const Napi::CallbackInfo& info)
{
    return api<FileClose>(info);
}

Napi::Value FileWrap::read(const Napi::CallbackInfo& info)
{
    return api<FileRead>(info);
}

// Napi::Value FileWrap::write(const Napi::CallbackInfo& info)
// {
//     return api<FileWrite>(info);
// }



/**
 * 
 */
struct DirWrap : public Napi::ObjectWrap<DirWrap>
{
    std::string _path;
    DIR *_dir;
    static Napi::FunctionReference constructor;
    static void init(Napi::Env env)
    {
        Napi::HandleScope scope(env);
        Napi::Function func = DefineClass(env, "Dir", { 
          InstanceMethod("close", &DirWrap::close),
          InstanceMethod("read", &DirWrap::read),
        });
        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();
    }
    DirWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<DirWrap>(info)
        , _dir(0)
    {
    }
    ~DirWrap() {
        if (_dir) {
            PANIC("FS::DirWrap::dtor: dir not closed " << DVAL(_path) << DVAL(_dir));
        }
    }
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value read(const Napi::CallbackInfo& info);
};

Napi::FunctionReference DirWrap::constructor;

struct DirOpen : public FSWorker
{
    std::string _path;
    DIR *_dir;
    DirOpen(const Napi::CallbackInfo& info) : FSWorker(info), _dir(0)
    {
        _path = info[1].As<Napi::String>();
        // TODO - info[1] = { bufferSize: 128 }
        Begin(XSTR() << DVAL(_path));
    }
    virtual void Work()
    {
        _dir = opendir(_path.c_str());
        if (_dir == NULL) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::DirOpen::OnOK: " << DVAL(_path));
        Napi::Object res = DirWrap::constructor.New({});
        DirWrap *w = DirWrap::Unwrap(res);
        w->_path = _path;
        w->_dir = _dir;
        _deferred.Resolve(res);
    }
};

struct DirClose : public FSWorker
{
    DirWrap *_wrap;
    DirClose(const Napi::CallbackInfo& info) : FSWorker(info)
    {
        _wrap = DirWrap::Unwrap(info.This().As<Napi::Object>());
    }
    virtual void Work()
    {
        DIR *dir = _wrap->_dir;
        std::string path = _wrap->_path;
        int r = closedir(dir);
        if (r) SetSyscallError();
        _wrap->_dir = 0;
    }
};


struct DirReadEntry : public FSWorker
{
    DirWrap *_wrap;
    Entry _entry;
    bool _eof;
    DirReadEntry(const Napi::CallbackInfo& info) : FSWorker(info), _eof(false)
    {
        _wrap = DirWrap::Unwrap(info.This().As<Napi::Object>());
    }
    virtual void Work()
    {
        DIR *dir = _wrap->_dir;
        std::string path = _wrap->_path;
        if (!dir) {
            SetError(XSTR() << "FS::DirReadEntry::Execute: ERROR not opened " << path);
            return;
        }

        while (true) {
            // need to set errno before the call to readdir() to detect between EOF and error
            errno = 0;
            struct dirent *e = readdir(dir);
            if (e) {
                // Ignore parent and current directories 
                if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0) {
                    continue;
                }
                _entry.name = std::string(e->d_name);
                _entry.ino = e->d_ino;
                _entry.type = e->d_type;
            } else {
               if (errno) {
                    SetSyscallError();
               } else {
                    _eof = true;
               }
               break;
            }
        }
    }
    virtual void OnOK()
    {
        Napi::Env env = Env();
        if (_eof) {
            _deferred.Resolve(env.Null());
        } else {
            auto res = Napi::Object::New(env);
            res["name"] = Napi::String::New(env, _entry.name);
            res["ino"] = Napi::Number::New(env, _entry.ino);
            res["type"] = Napi::Number::New(env, _entry.type);
            _deferred.Resolve(res);
        }
    }
};

Napi::Value DirWrap::close(const Napi::CallbackInfo& info)
{
    return api<DirClose>(info);
}

Napi::Value DirWrap::read(const Napi::CallbackInfo& info)
{
    return api<DirReadEntry>(info);
}

Napi::Value
set_debug_level(const Napi::CallbackInfo& info)
{
    auto level = info[0].As<Napi::Number>();
    DBG_SET_LEVEL(level);
    return info.Env().Undefined();
}

void
fs_napi(Napi::Env env, Napi::Object exports)
{
    DBG1("FS::fs_napi:" << " orig_uid:" << orig_uid << " orig_gid:" << orig_gid);
    auto exports_fs = Napi::Object::New(env);
    
    exports_fs["stat"] = Napi::Function::New(env, api<Stat>);
    exports_fs["unlink"] = Napi::Function::New(env, api<Unlink>);
    exports_fs["rename"] = Napi::Function::New(env, api<Rename>); 
    exports_fs["mkdir"] = Napi::Function::New(env, api<Mkdir>); 
    exports_fs["rmdir"] = Napi::Function::New(env, api<Rmdir>); 
    exports_fs["writeFile"] = Napi::Function::New(env, api<Writefile>);
    exports_fs["readFile"] = Napi::Function::New(env, api<Readfile>);
    exports_fs["readdir"] = Napi::Function::New(env, api<Readdir>);

    FileWrap::init(env);
    exports_fs["open"] = Napi::Function::New(env, api<FileOpen>);

    DirWrap::init(env);
    exports_fs["opendir"] = Napi::Function::New(env, api<DirOpen>);

    exports_fs["S_IFMT"] = Napi::Number::New(env, S_IFMT);
    exports_fs["S_IFDIR"] = Napi::Number::New(env, S_IFDIR);
    exports_fs["DT_DIR"] = Napi::Number::New(env, DT_DIR);

    exports_fs["set_debug_level"] = Napi::Function::New(env, set_debug_level);

    exports["fs"] = exports_fs;
}

}