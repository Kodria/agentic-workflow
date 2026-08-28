#include <node_api.h>

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstddef>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#else
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
#else
struct WindowsParent {
  HANDLE handle = INVALID_HANDLE_VALUE;
  std::vector<HANDLE> ancestors;
  std::wstring directory;
  std::wstring basename;
};

struct WindowsFileIdentity {
  DWORD volume_serial = 0;
  DWORD file_index_high = 0;
  DWORD file_index_low = 0;
  LARGE_INTEGER size {};
};

void CloseWindowsParent(WindowsParent* parent) {
  for (HANDLE handle : parent->ancestors) CloseHandle(handle);
  parent->ancestors.clear();
  parent->handle = INVALID_HANDLE_VALUE;
}

bool Utf8PathToWide(const std::string& input, std::wstring* output) {
  if (input.empty() || input.find('\0') != std::string::npos || input.size() > static_cast<size_t>(INT_MAX)) return false;
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()), nullptr, 0);
  if (length <= 0) return false;
  output->resize(static_cast<size_t>(length));
  return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()), output->data(), length) == length;
}

bool IsSeparator(wchar_t value) { return value == L'\\' || value == L'/'; }
bool IsWindowsAbsolute(const std::wstring& path, size_t* root_end) {
  if (path.size() >= 3 && ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) && path[1] == L':' && IsSeparator(path[2])) {
    *root_end = 3;
    return true;
  }
  if (path.size() < 5 || !IsSeparator(path[0]) || !IsSeparator(path[1]) || IsSeparator(path[2])) return false;
  const size_t server_end = path.find_first_of(L"\\/", 2);
  if (server_end == std::wstring::npos || server_end == 2) return false;
  const size_t share_end = path.find_first_of(L"\\/", server_end + 1);
  if (share_end == std::wstring::npos || share_end == server_end + 1) return false;
  *root_end = share_end + 1;
  return true;
}

bool IsSafeComponent(const std::wstring& component) {
  return !component.empty() && component != L"." && component != L".." && component.find(L':') == std::wstring::npos;
}

bool HandleIsDirectoryNotReparse(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO info {};
  return GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info)) != 0
      && (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
      && (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

HANDLE OpenDirectoryNoReparse(const std::wstring& path, DWORD access) {
  HANDLE handle = CreateFileW(path.c_str(), access | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return handle;
  if (!HandleIsDirectoryNotReparse(handle)) { CloseHandle(handle); return INVALID_HANDLE_VALUE; }
  return handle;
}

bool OpenWindowsParent(const std::string& file, WindowsParent* parent, DWORD access) {
  std::wstring path;
  size_t root_end = 0;
  if (!Utf8PathToWide(file, &path) || !IsWindowsAbsolute(path, &root_end)) return false;
  const size_t slash = path.find_last_of(L"\\/");
  if (slash == std::wstring::npos || slash + 1 == path.size() || slash + 1 < root_end) return false;
  parent->basename = path.substr(slash + 1);
  if (!IsSafeComponent(parent->basename)) return false;
  std::wstring current = path.substr(0, root_end);
  HANDLE directory = OpenDirectoryNoReparse(current, access);
  if (directory == INVALID_HANDLE_VALUE) return false;
  parent->ancestors.push_back(directory);
  size_t cursor = root_end;
  while (cursor < slash) {
    const size_t next = path.find_first_of(L"\\/", cursor);
    const size_t end = next == std::wstring::npos || next > slash ? slash : next;
    const std::wstring component = path.substr(cursor, end - cursor);
    if (!IsSafeComponent(component)) { CloseWindowsParent(parent); return false; }
    if (!current.empty() && !IsSeparator(current.back())) current += L'\\';
    current += component;
    HANDLE child = OpenDirectoryNoReparse(current, access);
    if (child == INVALID_HANDLE_VALUE) { CloseWindowsParent(parent); return false; }
    directory = child;
    parent->ancestors.push_back(directory);
    cursor = end + 1;
  }
  parent->handle = directory;
  parent->directory = current;
  return true;
}

bool GetWindowsFileIdentity(HANDLE handle, WindowsFileIdentity* identity) {
  BY_HANDLE_FILE_INFORMATION info {};
  if (!GetFileInformationByHandle(handle, &info)) return false;
  identity->volume_serial = info.dwVolumeSerialNumber;
  identity->file_index_high = info.nFileIndexHigh;
  identity->file_index_low = info.nFileIndexLow;
  identity->size.HighPart = static_cast<LONG>(info.nFileSizeHigh);
  identity->size.LowPart = info.nFileSizeLow;
  return true;
}

bool SameWindowsFileIdentity(const WindowsFileIdentity& left, const WindowsFileIdentity& right) {
  return left.volume_serial == right.volume_serial && left.file_index_high == right.file_index_high
      && left.file_index_low == right.file_index_low && left.size.QuadPart == right.size.QuadPart;
}

HANDLE OpenRegularFileNoReparse(const WindowsParent& parent) {
  std::wstring path = parent.directory;
  if (!path.empty() && !IsSeparator(path.back())) path += L'\\';
  path += parent.basename;
  HANDLE handle = CreateFileW(path.c_str(), FILE_READ_DATA | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return handle;
  FILE_ATTRIBUTE_TAG_INFO attributes {};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes, sizeof(attributes))
      || (attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0
      || GetFileType(handle) != FILE_TYPE_DISK) {
    CloseHandle(handle);
    return INVALID_HANDLE_VALUE;
  }
  return handle;
}

bool WriteAll(HANDLE handle, const void* bytes, size_t length) {
  const char* input = static_cast<const char*>(bytes);
  size_t written = 0;
  while (written < length) {
    const DWORD chunk = static_cast<DWORD>(std::min<size_t>(length - written, 1024 * 1024));
    DWORD count = 0;
    if (!WriteFile(handle, input + written, chunk, &count, nullptr) || count == 0) return false;
    written += count;
  }
  return true;
}

bool CreatePrivateStagingFile(const WindowsParent& parent, std::wstring* temporary, HANDLE* staged) {
  for (unsigned int attempt = 0; attempt < 128; ++attempt) {
    std::wstring candidate = parent.directory;
    if (!candidate.empty() && !IsSeparator(candidate.back())) candidate += L'\\';
    candidate += L"." + parent.basename + L".secure-fs." + std::to_wstring(GetCurrentProcessId()) + L"." + std::to_wstring(GetTickCount64()) + L"." + std::to_wstring(attempt);
    HANDLE handle = CreateFileW(candidate.c_str(), GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES, 0, nullptr, CREATE_NEW,
        FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (handle != INVALID_HANDLE_VALUE) { *temporary = candidate; *staged = handle; return true; }
    if (GetLastError() != ERROR_FILE_EXISTS && GetLastError() != ERROR_ALREADY_EXISTS) return false;
  }
  return false;
}

enum class PublishResult { kPublished, kConflict, kApiUnavailable, kFailed };

PublishResult PublishNoReplace(HANDLE staged, HANDLE parent, const std::wstring& basename) {
  struct RenameInfoEx {
    DWORD Flags;
    HANDLE RootDirectory;
    DWORD FileNameLength;
    WCHAR FileName[1];
  };
  const size_t bytes = offsetof(RenameInfoEx, FileName) + basename.size() * sizeof(WCHAR);
  if (bytes > MAXDWORD) return PublishResult::kFailed;
  std::vector<unsigned char> storage(bytes);
  auto* rename = reinterpret_cast<RenameInfoEx*>(storage.data());
  rename->Flags = 0;  // FileRenameInfoEx without FILE_RENAME_FLAG_REPLACE_IF_EXISTS.
  rename->RootDirectory = parent;
  rename->FileNameLength = static_cast<DWORD>(basename.size() * sizeof(WCHAR));
  std::memcpy(rename->FileName, basename.data(), rename->FileNameLength);
  if (SetFileInformationByHandle(staged, static_cast<FILE_INFO_BY_HANDLE_CLASS>(22), rename, static_cast<DWORD>(bytes)) != 0) return PublishResult::kPublished;
  const DWORD error = GetLastError();
  if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) return PublishResult::kConflict;
  if (error == ERROR_INVALID_PARAMETER || error == ERROR_NOT_SUPPORTED || error == ERROR_CALL_NOT_IMPLEMENTED) return PublishResult::kApiUnavailable;
  return PublishResult::kFailed;
}
#endif

napi_value ReadRegularFile(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 2) { Throw(env, "readRegularFile requires path and limit"); return nullptr; }
  std::string file; int64_t limit = 0;
  if (!StringArg(env, args[0], &file) || napi_get_value_int64(env, args[1], &limit) != napi_ok || limit <= 0) { Throw(env, "invalid readRegularFile arguments"); return nullptr; }
#ifdef _WIN32
  WindowsParent parent;
  if (!OpenWindowsParent(file, &parent, FILE_LIST_DIRECTORY)) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  HANDLE handle = OpenRegularFileNoReparse(parent);
  CloseWindowsParent(&parent);
  WindowsFileIdentity before {};
  if (handle == INVALID_HANDLE_VALUE || !GetWindowsFileIdentity(handle, &before) || before.size.QuadPart < 0 || before.size.QuadPart > limit || static_cast<unsigned long long>(before.size.QuadPart) > static_cast<unsigned long long>(SIZE_MAX)) {
    if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    Throw(env, "secure-fs rejected non-regular or oversized file"); return nullptr;
  }
  std::vector<char> bytes(static_cast<size_t>(before.size.QuadPart));
  size_t read_total = 0;
  while (read_total < bytes.size()) {
    const DWORD chunk = static_cast<DWORD>(std::min<size_t>(bytes.size() - read_total, 1024 * 1024));
    DWORD count = 0;
    if (!ReadFile(handle, bytes.data() + read_total, chunk, &count, nullptr) || count == 0) { CloseHandle(handle); Throw(env, "secure-fs could not read file"); return nullptr; }
    read_total += count;
  }
  WindowsFileIdentity after {};
  if (!GetWindowsFileIdentity(handle, &after) || !SameWindowsFileIdentity(before, after)) { CloseHandle(handle); Throw(env, "secure-fs file changed during read"); return nullptr; }
  CloseHandle(handle); napi_value output; napi_create_buffer_copy(env, bytes.size(), bytes.data(), nullptr, &output); return output;
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
  WindowsParent parent;
  if (!OpenWindowsParent(file, &parent, FILE_LIST_DIRECTORY | FILE_ADD_FILE)) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  std::wstring temporary;
  HANDLE staged = INVALID_HANDLE_VALUE;
  if (!CreatePrivateStagingFile(parent, &temporary, &staged)) { CloseWindowsParent(&parent); Throw(env, "secure-fs could not stage transaction"); return nullptr; }
  const bool staged_ok = WriteAll(staged, bytes, length) && FlushFileBuffers(staged) != 0;
  const PublishResult publish_result = staged_ok ? PublishNoReplace(staged, parent.handle, parent.basename) : PublishResult::kFailed;
  CloseHandle(staged);
  if (publish_result != PublishResult::kPublished) DeleteFileW(temporary.c_str());
  CloseWindowsParent(&parent);
  if (publish_result == PublishResult::kApiUnavailable) { Throw(env, "secure-fs Windows FileRenameInfoEx is unavailable"); return nullptr; }
  if (publish_result != PublishResult::kPublished) { Throw(env, "secure-fs target exists or transaction failed"); return nullptr; }
  napi_value undefined; napi_get_undefined(env, &undefined); return undefined;
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
