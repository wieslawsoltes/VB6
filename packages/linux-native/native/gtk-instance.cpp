// Secure per-user process registry. POSIX locks are released on exit/crash and
// are not inherited across fork. Stale files never establish instance liveness.
#include "gtk-instance.hpp"
#include <glib.h>
#include <cerrno>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace vb6 {
namespace {
std::mutex instanceMutex;
struct Descriptor {
  int value = -1;
  explicit Descriptor(int fd = -1):value(fd){}
  ~Descriptor(){if(value >= 0)close(value);}
  Descriptor(const Descriptor&) = delete;
  Descriptor& operator=(const Descriptor&) = delete;
  int release(){int result=value;value=-1;return result;}
};
[[noreturn]] void instanceError(const char* operation){
  throw std::runtime_error(std::string("Application instance registration: ")+operation+": "+std::strerror(errno));
}
void checkPrivate(int fd,bool directory){
  struct stat info{};
  if(fstat(fd,&info))instanceError("inspect private registry");
  if(info.st_uid!=geteuid() || (info.st_mode&0077) ||
     (directory?!S_ISDIR(info.st_mode):!S_ISREG(info.st_mode)||info.st_nlink!=1))
    throw std::runtime_error("Application instance registry must be private, owned by this user, and free of links");
}
int directoryAt(int parent,const std::string& name){
  if(mkdirat(parent,name.c_str(),0700)&&errno!=EEXIST)instanceError("create private directory");
  Descriptor fd(openat(parent,name.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW));
  if(fd.value<0)instanceError("open private directory");
  checkPrivate(fd.value,true);return fd.release();
}
void lock(int fd,bool wait){
  struct flock request{};request.l_type=F_WRLCK;request.l_whence=SEEK_SET;
  while(fcntl(fd,wait?F_SETLKW:F_SETLK,&request)){
    if(errno==EINTR)continue;
    instanceError("lock registry");
  }
}
bool lockedElsewhere(int fd){
  struct flock request{};request.l_type=F_WRLCK;request.l_whence=SEEK_SET;
  for(;;){
    if(!fcntl(fd,F_SETLK,&request))return false;
    if(errno==EINTR)continue;
    if(errno==EACCES||errno==EAGAIN)return true;
    instanceError("inspect process lock");
  }
}
std::string executableIdentity(){
  std::vector<char> path(256);
  for(;;){
    auto count=readlink("/proc/self/exe",path.data(),path.size());
    if(count<0)instanceError("resolve executable");
    if(size_t(count)<path.size()){
      std::string value(path.data(),size_t(count));
      // Linux appends this suffix when an executing file has been replaced.
      // The replacement at the same application path shares its identity.
      const std::string deleted=" (deleted)";
      if(value.size()>deleted.size()&&value.compare(value.size()-deleted.size(),deleted.size(),deleted)==0)
        value.resize(value.size()-deleted.size());
      gchar* checksum=g_compute_checksum_for_data(G_CHECKSUM_SHA256,
        reinterpret_cast<const guchar*>(value.data()),value.size());
      if(!checksum)throw std::runtime_error("Could not hash application identity");
      std::string result(checksum);g_free(checksum);return result;
    }
    if(path.size()>=65536)throw std::runtime_error("Executable path exceeds the application identity limit");
    path.resize(path.size()*2);
  }
}
bool instanceName(const std::string& name){
  if(name.size()!=45||name.compare(0,9,"instance-")!=0)return false;
  for(size_t i=9;i<name.size();++i)if(!g_ascii_isxdigit(name[i])&&name[i]!='-')return false;
  return true;
}
}

struct LinuxApplicationInstance::State {
  pid_t process=getpid();
  bool preceding=false;
  int directory=-1,guard=-1,marker=-1;
  std::string entry;
  ~State(){
    // A forked child may destroy inherited C++ objects. It must not unlink the
    // parent's marker. Its inherited descriptors do not retain POSIX locks.
    if(process==getpid()&&marker>=0){
      std::lock_guard<std::mutex> local(instanceMutex);
      try{lock(guard,true);close(marker);marker=-1;unlinkat(directory,entry.c_str(),0);}
      catch(...){/* Closing still releases liveness; the next launch cleans up. */}
    }
    if(marker>=0)close(marker);
    if(guard>=0)close(guard);
    if(directory>=0)close(directory);
  }
};

std::shared_ptr<LinuxApplicationInstance::State> LinuxApplicationInstance::acquire(){
  static std::map<std::string,std::weak_ptr<State>> registrations;
  std::lock_guard<std::mutex> local(instanceMutex);
  auto identity=executableIdentity();
  auto key=std::to_string(getpid())+":"+identity;
  if(auto current=registrations[key].lock())return current;

  // A fixed private location avoids splitting identity when launches use
  // different TMPDIR, HOME, or XDG_RUNTIME_DIR environments. No PID probing,
  // display server, D-Bus session, or externally managed daemon is required.
  Descriptor temporary(open("/tmp",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW));
  if(temporary.value<0)instanceError("open temporary filesystem");
  Descriptor base(directoryAt(temporary.value,"vb6-native-"+std::to_string(geteuid())));
  Descriptor registry(directoryAt(base.value,"instances-v1"));
  Descriptor directory(directoryAt(registry.value,identity));
  Descriptor guard(openat(directory.value,"registry.lock",O_RDWR|O_CREAT|O_CLOEXEC|O_NOFOLLOW,0600));
  if(guard.value<0)instanceError("open registry lock");
  checkPrivate(guard.value,false);lock(guard.value,true);

  Descriptor scan(dup(directory.value));
  if(scan.value<0)instanceError("duplicate registry directory");
  DIR* entries=fdopendir(scan.value);
  if(!entries)instanceError("scan registry directory");
  scan.release();
  std::unique_ptr<DIR,int(*)(DIR*)> listing(entries,closedir);
  bool previous=false;size_t count=0;
  for(;;){
    errno=0;auto* entry=readdir(entries);
    if(!entry){if(errno)instanceError("read registry directory");break;}
    std::string name(entry->d_name);if(!instanceName(name))continue;
    if(++count>100000)throw std::runtime_error("Application instance registry exceeds its entry limit");
    Descriptor marker(openat(directory.value,name.c_str(),O_RDWR|O_CLOEXEC|O_NOFOLLOW));
    if(marker.value<0){if(errno==ENOENT)continue;instanceError("open process marker");}
    checkPrivate(marker.value,false);
    if(lockedElsewhere(marker.value))previous=true;
    else if(unlinkat(directory.value,name.c_str(),0)&&errno!=ENOENT)instanceError("remove stale process marker");
  }
  gchar* uuid=g_uuid_string_random();
  if(!uuid)throw std::runtime_error("Could not name application instance");
  std::string entry="instance-"+std::string(uuid);g_free(uuid);
  Descriptor marker(openat(directory.value,entry.c_str(),O_RDWR|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600));
  if(marker.value<0)instanceError("create process marker");
  checkPrivate(marker.value,false);lock(marker.value,false);
  // Keep the guard inode, but release its lock after the startup transaction.
  struct flock unlock{};unlock.l_type=F_UNLCK;unlock.l_whence=SEEK_SET;
  if(fcntl(guard.value,F_SETLK,&unlock))instanceError("unlock registry");
  auto result=std::make_shared<State>();result->preceding=previous;result->entry=entry;
  result->directory=directory.release();result->guard=guard.release();result->marker=marker.release();
  registrations[key]=result;return result;
}
LinuxApplicationInstance::LinuxApplicationInstance():state(acquire()){}
bool LinuxApplicationInstance::previous(){
  if(state->process!=getpid())state=acquire();
  return state->preceding;
}
}
