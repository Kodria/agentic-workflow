#include <node_api.h>

#include <cerrno>
#include <cstring>
#include <string>
#include <vector>

#ifndef _WIN32
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace {
void Throw(napi_env env, const char* message) { napi_throw_error(env, nullptr, message); }
bool StringArg(napi_env env, napi_value value, std::string* result) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  result->resize(length);
  return napi_get_value_string_utf8(env, value, result->data(), length + 1, &length) == napi_ok;
}

#ifndef _WIN32
int OpenParent(const std::string& file, std::string* basename) {
  if (file.empty() || file[0] != '/') return -1;
  const auto slash = file.rfind('/');
  if (slash == std::string::npos || slash + 1 == file.size()) return -1;
  *basename = file.substr(slash + 1);
  int directory = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (directory < 0) return -1;
  std::string parent = file.substr(1, slash - 1);
  size_t cursor = 0;
  while (cursor < parent.size()) {
    size_t next = parent.find('/', cursor);
    std::string component = parent.substr(cursor, next == std::string::npos ? std::string::npos : next - cursor);
    if (component.empty() || component == "." || component == "..") { close(directory); return -1; }
    int child = openat(directory, component.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    close(directory);
    if (child < 0) return -1;
    directory = child;
    if (next == std::string::npos) break;
    cursor = next + 1;
  }
  return directory;
}
#endif

napi_value ReadRegularFile(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 2) { Throw(env, "readRegularFile requires path and limit"); return nullptr; }
  std::string file; int64_t limit = 0;
  if (!StringArg(env, args[0], &file) || napi_get_value_int64(env, args[1], &limit) != napi_ok || limit <= 0) { Throw(env, "invalid readRegularFile arguments"); return nullptr; }
#ifdef _WIN32
  Throw(env, "Windows secure-fs artifact was built without its handle implementation"); return nullptr;
#else
  std::string basename; int parent = OpenParent(file, &basename);
  if (parent < 0) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  int fd = openat(parent, basename.c_str(), O_RDONLY | O_NOFOLLOW); close(parent);
  struct stat statbuf {};
  if (fd < 0 || fstat(fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode) || statbuf.st_size < 0 || statbuf.st_size > limit) { if (fd >= 0) close(fd); Throw(env, "secure-fs rejected non-regular or oversized file"); return nullptr; }
  std::vector<char> bytes(static_cast<size_t>(statbuf.st_size)); size_t read_total = 0;
  while (read_total < bytes.size()) { ssize_t count = read(fd, bytes.data() + read_total, bytes.size() - read_total); if (count <= 0) { close(fd); Throw(env, "secure-fs could not read file"); return nullptr; } read_total += static_cast<size_t>(count); }
  struct stat after {}; if (fstat(fd, &after) != 0 || after.st_dev != statbuf.st_dev || after.st_ino != statbuf.st_ino || after.st_size != statbuf.st_size) { close(fd); Throw(env, "secure-fs file changed during read"); return nullptr; }
  close(fd); napi_value output; napi_create_buffer_copy(env, bytes.size(), bytes.data(), nullptr, &output); return output;
#endif
}

napi_value WriteProjectTransaction(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 2) { Throw(env, "writeProjectTransaction requires path and bytes"); return nullptr; }
  std::string file; void* bytes = nullptr; size_t length = 0;
  if (!StringArg(env, args[0], &file) || napi_get_buffer_info(env, args[1], &bytes, &length) != napi_ok) { Throw(env, "invalid writeProjectTransaction arguments"); return nullptr; }
#ifdef _WIN32
  Throw(env, "Windows secure-fs artifact was built without its handle implementation"); return nullptr;
#else
  std::string basename; int parent = OpenParent(file, &basename);
  if (parent < 0) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  const std::string temporary = "." + basename + ".secure-fs.tmp";
  int fd = openat(parent, temporary.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (fd < 0) { close(parent); Throw(env, "secure-fs could not stage transaction"); return nullptr; }
  size_t written = 0; while (written < length) { ssize_t count = write(fd, static_cast<char*>(bytes) + written, length - written); if (count <= 0) { close(fd); unlinkat(parent, temporary.c_str(), 0); close(parent); Throw(env, "secure-fs could not stage transaction"); return nullptr; } written += static_cast<size_t>(count); }
  if (fsync(fd) != 0 || close(fd) != 0 || linkat(parent, temporary.c_str(), parent, basename.c_str(), 0) != 0) { unlinkat(parent, temporary.c_str(), 0); close(parent); Throw(env, "secure-fs target exists or transaction failed"); return nullptr; }
  unlinkat(parent, temporary.c_str(), 0); fsync(parent); close(parent); napi_value undefined; napi_get_undefined(env, &undefined); return undefined;
#endif
}
}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"readRegularFile", nullptr, ReadRegularFile, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"writeProjectTransaction", nullptr, WriteProjectTransaction, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, properties);
  return exports;
}
