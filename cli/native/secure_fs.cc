#include <node_api.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <climits>
#include <cstddef>
#include <cstring>
#include <cstdint>
#include <new>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <winternl.h>
#else
#include <fcntl.h>
#include <sys/file.h>
#ifdef __linux__
#include <sys/random.h>
#elif defined(__APPLE__)
#include <stdlib.h>
#endif
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace {
constexpr size_t kIdentityTokenBytes = 24;
constexpr std::uint8_t kIdentityVersion = 1;
constexpr std::uint8_t kPosixIdentityKind = 1;
constexpr std::uint8_t kWindowsIdentityKind = 2;
constexpr const char* kDestinationExistsErrorCode =
    "AWM_SECURE_FS_DESTINATION_EXISTS";
#ifndef _WIN32
constexpr unsigned int kMaxStagingAttempts = 128;
constexpr size_t kStagingNonceBytes = 16;
#endif
constexpr napi_type_tag kProjectLeaseTypeTag = {
    0x41574d2d50524f4aULL,
    0x4543542d4c454153ULL,
};

struct ProjectLease {
#ifdef _WIN32
  HANDLE handle = INVALID_HANDLE_VALUE;
  OVERLAPPED lock_range {};
#else
  int fd = -1;
#endif
  bool held = false;
};

enum class LeaseAcquireResult { kAcquired, kAlreadyHeld, kRejected, kFailed };

struct NativeIdentity {
  std::uint64_t first = 0;
  std::uint64_t second = 0;
};

struct WriteOptions {
  bool replace = false;
  bool create_parents = false;
  const char* expected = nullptr;
  size_t expected_length = 0;
  NativeIdentity expected_identity {};
};

void Throw(napi_env env, const char* message) { napi_throw_error(env, nullptr, message); }
void ThrowDestinationExists(napi_env env) {
  napi_throw_error(env, kDestinationExistsErrorCode,
      "secure-fs no-replace destination already exists");
}

bool ContainsNul(const std::string& value) {
  return value.find('\0') != std::string::npos;
}

void EncodeUint64LittleEndian(std::uint64_t value, std::uint8_t* output) {
  for (size_t index = 0; index < sizeof(value); ++index) {
    output[index] = static_cast<std::uint8_t>(value >> (index * CHAR_BIT));
  }
}

std::uint64_t DecodeUint64LittleEndian(const std::uint8_t* input) {
  std::uint64_t value = 0;
  for (size_t index = 0; index < sizeof(value); ++index) {
    value |= static_cast<std::uint64_t>(input[index]) << (index * CHAR_BIT);
  }
  return value;
}

std::array<std::uint8_t, kIdentityTokenBytes> EncodeIdentity(
    std::uint8_t kind, const NativeIdentity& identity) {
  std::array<std::uint8_t, kIdentityTokenBytes> token {};
  token[0] = 'S';
  token[1] = 'F';
  token[2] = 'S';
  token[3] = 'I';
  token[4] = kIdentityVersion;
  token[5] = kind;
  EncodeUint64LittleEndian(identity.first, token.data() + 8);
  EncodeUint64LittleEndian(identity.second, token.data() + 16);
  return token;
}

bool ParseIdentity(const void* bytes, size_t length, std::uint8_t expected_kind,
    NativeIdentity* identity) {
  if (bytes == nullptr || length != kIdentityTokenBytes) return false;
  const auto* token = static_cast<const std::uint8_t*>(bytes);
  if (token[0] != 'S' || token[1] != 'F' || token[2] != 'S' || token[3] != 'I'
      || token[4] != kIdentityVersion || token[5] != expected_kind
      || token[6] != 0 || token[7] != 0) return false;
  identity->first = DecodeUint64LittleEndian(token + 8);
  identity->second = DecodeUint64LittleEndian(token + 16);
  return true;
}

bool CreateReadResult(napi_env env, const std::vector<char>& bytes,
    const std::array<std::uint8_t, kIdentityTokenBytes>& identity, napi_value* result) {
  napi_value output;
  napi_value bytes_value;
  napi_value identity_value;
  if (napi_create_object(env, &output) != napi_ok
      || napi_create_buffer_copy(env, bytes.size(), bytes.empty() ? nullptr : bytes.data(),
          nullptr, &bytes_value) != napi_ok
      || napi_create_buffer_copy(env, identity.size(), identity.data(), nullptr,
          &identity_value) != napi_ok
      || napi_set_named_property(env, output, "bytes", bytes_value) != napi_ok
      || napi_set_named_property(env, output, "identity", identity_value) != napi_ok) return false;
  *result = output;
  return true;
}

bool StringArg(napi_env env, napi_value value, std::string* result) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  result->resize(length);
  return napi_get_value_string_utf8(env, value, result->data(), length + 1, &length) == napi_ok;
}

#ifndef _WIN32
bool FillRandomBytes(void* output, size_t length) {
#ifdef __linux__
  auto* cursor = static_cast<std::uint8_t*>(output);
  size_t remaining = length;
  while (remaining > 0) {
    const ssize_t count = getrandom(cursor, remaining, 0);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    cursor += count;
    remaining -= static_cast<size_t>(count);
  }
  return true;
#elif defined(__APPLE__)
  arc4random_buf(output, length);
  return true;
#else
  (void)output;
  (void)length;
  return false;
#endif
}

std::string HexNonce(
    const std::array<std::uint8_t, kStagingNonceBytes>& nonce) {
  static constexpr char kHex[] = "0123456789abcdef";
  std::string encoded(nonce.size() * 2, '0');
  for (size_t index = 0; index < nonce.size(); ++index) {
    encoded[index * 2] = kHex[nonce[index] >> 4];
    encoded[index * 2 + 1] = kHex[nonce[index] & 0x0f];
  }
  return encoded;
}

int CreatePrivateStagingFile(
    int parent, const std::string& basename, std::string* temporary) {
  for (unsigned int attempt = 0; attempt < kMaxStagingAttempts; ++attempt) {
    std::array<std::uint8_t, kStagingNonceBytes> nonce {};
    if (!FillRandomBytes(nonce.data(), nonce.size())) return -1;
    *temporary = "." + basename + ".secure-fs.tmp." + HexNonce(nonce);
    const int fd = openat(parent, temporary->c_str(),
        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd >= 0) return fd;
    if (errno != EEXIST) return -1;
  }
  return -1;
}

int OpenParent(const std::string& file, std::string* basename, bool create_parents) {
  if (file.empty() || file[0] != '/' || ContainsNul(file)) return -1;
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
    if (child < 0 && errno == ENOENT && create_parents) {
      if (mkdirat(directory, component.c_str(), 0700) != 0 && errno != EEXIST) { close(directory); return -1; }
      child = openat(directory, component.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    }
    close(directory);
    if (child < 0) return -1;
    directory = child;
    if (next == std::string::npos) break;
    cursor = next + 1;
  }
  return directory;
}

int OpenProjectRootNoFollow(const std::string& project_root) {
  if (project_root.empty() || project_root[0] != '/'
      || project_root.find('\0') != std::string::npos) return -1;
  int directory = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory < 0) return -1;
  size_t cursor = 1;
  while (cursor < project_root.size()) {
    const size_t next = project_root.find('/', cursor);
    const std::string component = project_root.substr(
        cursor, next == std::string::npos ? std::string::npos : next - cursor);
    if (component.empty() || component == "." || component == ".."
        || component.find('\0') != std::string::npos) {
      close(directory);
      return -1;
    }
    int child = openat(directory, component.c_str(),
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(directory);
    if (child < 0) return -1;
    directory = child;
    if (next == std::string::npos) break;
    cursor = next + 1;
  }
  return directory;
}

LeaseAcquireResult AcquirePlatformProjectLease(
    const std::string& project_root, ProjectLease* lease) {
  int root = OpenProjectRootNoFollow(project_root);
  if (root < 0) return LeaseAcquireResult::kRejected;
  int awm = openat(root, ".awm",
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (awm < 0 && errno == ENOENT) {
    if (mkdirat(root, ".awm", 0700) != 0 && errno != EEXIST) {
      close(root);
      return LeaseAcquireResult::kRejected;
    }
    awm = openat(root, ".awm",
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  }
  close(root);
  if (awm < 0) return LeaseAcquireResult::kRejected;

  int fd = openat(awm, ".secure-fs-lease",
      O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  close(awm);
  struct stat statbuf {};
  if (fd < 0 || fstat(fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode)) {
    if (fd >= 0) close(fd);
    return LeaseAcquireResult::kRejected;
  }
  if (flock(fd, LOCK_EX | LOCK_NB) != 0) {
    const int lock_error = errno;
    close(fd);
    if (lock_error == EWOULDBLOCK || lock_error == EAGAIN) {
      return LeaseAcquireResult::kAlreadyHeld;
    }
    return LeaseAcquireResult::kFailed;
  }
  lease->fd = fd;
  lease->held = true;
  return LeaseAcquireResult::kAcquired;
}

void ReleasePlatformProjectLease(ProjectLease* lease) {
  if (!lease->held) return;
  const int fd = lease->fd;
  lease->held = false;
  lease->fd = -1;
  if (fd >= 0) {
    flock(fd, LOCK_UN);
    close(fd);
  }
}
#else
struct WindowsParent {
  HANDLE handle = INVALID_HANDLE_VALUE;
  std::wstring basename;
};

struct WindowsPath {
  std::wstring anchor;
  std::vector<std::wstring> directories;
  std::wstring basename;
};

using NtCreateFileFunction = NTSTATUS (NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
    PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using NtSetInformationFileFunction = NTSTATUS (NTAPI*)(HANDLE, PIO_STATUS_BLOCK,
    PVOID, ULONG, ULONG);
using RtlNtStatusToDosErrorFunction = ULONG (NTAPI*)(NTSTATUS);

struct WindowsNativeApi {
  NtCreateFileFunction nt_create_file = nullptr;
  NtSetInformationFileFunction nt_set_information_file = nullptr;
  RtlNtStatusToDosErrorFunction rtl_nt_status_to_dos_error = nullptr;
};

constexpr ULONG kObjectCaseInsensitive = 0x00000040;
constexpr ULONG kFileDirectoryFile = 0x00000001;
constexpr ULONG kFileSynchronousIoNonalert = 0x00000020;
constexpr ULONG kFileNonDirectoryFile = 0x00000040;
constexpr ULONG kFileOpenForBackupIntent = 0x00004000;
constexpr ULONG kFileOpenReparsePoint = 0x00200000;
constexpr ULONG kFileOpen = 0x00000001;
constexpr ULONG kFileCreate = 0x00000002;
constexpr ULONG kFileOpenIf = 0x00000003;
constexpr ULONG kFileRenameReplaceIfExists = 0x00000001;
constexpr ULONG kFileRenamePosixSemantics = 0x00000002;
constexpr ULONG kFileRenameInformationEx = 65;

const WindowsNativeApi& GetWindowsNativeApi() {
  static const WindowsNativeApi api = [] {
    WindowsNativeApi result;
    HMODULE module = GetModuleHandleW(L"ntdll.dll");
    if (module == nullptr) return result;
    result.nt_create_file = reinterpret_cast<NtCreateFileFunction>(GetProcAddress(module, "NtCreateFile"));
    result.nt_set_information_file = reinterpret_cast<NtSetInformationFileFunction>(GetProcAddress(module, "NtSetInformationFile"));
    result.rtl_nt_status_to_dos_error = reinterpret_cast<RtlNtStatusToDosErrorFunction>(GetProcAddress(module, "RtlNtStatusToDosError"));
    return result;
  }();
  return api;
}

bool WindowsRelativeApiAvailable() {
  const WindowsNativeApi& api = GetWindowsNativeApi();
  return api.nt_create_file != nullptr && api.rtl_nt_status_to_dos_error != nullptr;
}

struct WindowsFileIdentity {
  DWORD volume_serial = 0;
  DWORD file_index_high = 0;
  DWORD file_index_low = 0;
  LARGE_INTEGER size {};
};

void CloseWindowsParent(WindowsParent* parent) {
  if (parent->handle != INVALID_HANDLE_VALUE) CloseHandle(parent->handle);
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
  if (share_end == server_end + 1) return false;
  if (share_end == std::wstring::npos) {
    *root_end = path.size();
    return true;
  }
  *root_end = share_end + 1;
  return true;
}

bool IsSafeComponent(const std::wstring& component) {
  return !component.empty() && component != L"." && component != L".." && component.find(L':') == std::wstring::npos
      && component.find_first_of(L"\\/") == std::wstring::npos;
}

bool HandleIsDirectoryNotReparse(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO info {};
  return GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info)) != 0
      && (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
      && (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

HANDLE OpenAbsoluteAnchorNoReparse(const std::wstring& path) {
  HANDLE handle = CreateFileW(path.c_str(), FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return handle;
  if (!HandleIsDirectoryNotReparse(handle)) { CloseHandle(handle); return INVALID_HANDLE_VALUE; }
  return handle;
}

bool ParseSafeComponents(const std::wstring& path, size_t start, std::vector<std::wstring>* components) {
  if (start > path.size()) return false;
  size_t cursor = start;
  while (cursor < path.size()) {
    const size_t next = path.find_first_of(L"\\/", cursor);
    const std::wstring component = path.substr(cursor, next == std::wstring::npos ? std::wstring::npos : next - cursor);
    if (!IsSafeComponent(component)) return false;
    components->push_back(component);
    if (next == std::wstring::npos) break;
    cursor = next + 1;
    if (cursor == path.size()) return false;
  }
  return true;
}

bool ParseWindowsPath(const std::string& root, const std::string& destination, WindowsPath* parsed) {
  std::wstring project_root;
  std::wstring relative;
  size_t root_end = 0;
  if (!Utf8PathToWide(root, &project_root) || !Utf8PathToWide(destination, &relative)
      || !IsWindowsAbsolute(project_root, &root_end) || relative.empty() || IsSeparator(relative.front())) return false;
  while (project_root.size() > root_end && IsSeparator(project_root.back())) project_root.pop_back();
  parsed->anchor = project_root.substr(0, root_end);
  for (wchar_t& character : parsed->anchor) if (character == L'/') character = L'\\';
  if (!IsSeparator(parsed->anchor.back())) parsed->anchor += L'\\';
  if (!ParseSafeComponents(project_root, root_end, &parsed->directories)) return false;
  std::vector<std::wstring> destination_components;
  if (!ParseSafeComponents(relative, 0, &destination_components) || destination_components.empty()) return false;
  parsed->basename = destination_components.back();
  destination_components.pop_back();
  parsed->directories.insert(parsed->directories.end(), destination_components.begin(), destination_components.end());
  return IsSafeComponent(parsed->basename);
}

bool CreateFileRelative(HANDLE root, const std::wstring& component, ACCESS_MASK access,
    ULONG share, ULONG disposition, ULONG options, ULONG attributes, HANDLE* opened) {
  const WindowsNativeApi& api = GetWindowsNativeApi();
  const size_t name_bytes = component.size() * sizeof(wchar_t);
  if (api.nt_create_file == nullptr || api.rtl_nt_status_to_dos_error == nullptr) {
    SetLastError(ERROR_PROC_NOT_FOUND);
    return false;
  }
  if (!IsSafeComponent(component) || name_bytes > USHRT_MAX) {
    SetLastError(ERROR_INVALID_NAME);
    return false;
  }
  UNICODE_STRING name {};
  name.Length = static_cast<USHORT>(name_bytes);
  name.MaximumLength = name.Length;
  name.Buffer = const_cast<PWSTR>(component.data());
  OBJECT_ATTRIBUTES object_attributes {};
  object_attributes.Length = sizeof(object_attributes);
  object_attributes.RootDirectory = root;
  object_attributes.ObjectName = &name;
  object_attributes.Attributes = kObjectCaseInsensitive;
  IO_STATUS_BLOCK io_status {};
  HANDLE handle = INVALID_HANDLE_VALUE;
  const NTSTATUS status = api.nt_create_file(&handle, access, &object_attributes, &io_status, nullptr,
      attributes, share, disposition, options, nullptr, 0);
  if (status < 0 || handle == nullptr || handle == INVALID_HANDLE_VALUE) {
    if (handle != nullptr && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    SetLastError(status < 0 ? api.rtl_nt_status_to_dos_error(status) : ERROR_INVALID_HANDLE);
    return false;
  }
  *opened = handle;
  return true;
}

bool VerifyDirectDirectoryIdentity(HANDLE root, const std::wstring& component,
    HANDLE directory) {
  HANDLE observed = INVALID_HANDLE_VALUE;
  if (!CreateFileRelative(root, component, FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, kFileOpen,
      kFileOpenReparsePoint, FILE_ATTRIBUTE_NORMAL, &observed)) return false;
  BY_HANDLE_FILE_INFORMATION direct_info {};
  BY_HANDLE_FILE_INFORMATION directory_info {};
  const bool verified = HandleIsDirectoryNotReparse(observed)
      && GetFileInformationByHandle(observed, &direct_info) != 0
      && GetFileInformationByHandle(directory, &directory_info) != 0
      && direct_info.dwVolumeSerialNumber == directory_info.dwVolumeSerialNumber
      && direct_info.nFileIndexHigh == directory_info.nFileIndexHigh
      && direct_info.nFileIndexLow == directory_info.nFileIndexLow;
  CloseHandle(observed);
  return verified;
}

bool OpenRelativeDirectoryNoReparse(HANDLE root, const std::wstring& component,
    bool create, HANDLE* opened) {
  HANDLE handle = INVALID_HANDLE_VALUE;
  if (!CreateFileRelative(root, component, FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, create ? kFileOpenIf : kFileOpen,
      kFileDirectoryFile | kFileSynchronousIoNonalert | kFileOpenForBackupIntent,
      FILE_ATTRIBUTE_NORMAL, &handle)) return false;
  if (!HandleIsDirectoryNotReparse(handle)
      || !VerifyDirectDirectoryIdentity(root, component, handle)) {
    CloseHandle(handle);
    SetLastError(ERROR_REPARSE_TAG_INVALID);
    return false;
  }
  *opened = handle;
  return true;
}

bool OpenWindowsParent(const std::string& root, const std::string& destination,
    WindowsParent* parent, bool create_parents) {
  if (!WindowsRelativeApiAvailable()) return false;
  WindowsPath path;
  if (!ParseWindowsPath(root, destination, &path)) return false;
  HANDLE directory = OpenAbsoluteAnchorNoReparse(path.anchor);
  if (directory == INVALID_HANDLE_VALUE) return false;
  for (const std::wstring& component : path.directories) {
    HANDLE child = INVALID_HANDLE_VALUE;
    if (!OpenRelativeDirectoryNoReparse(directory, component, create_parents, &child)) {
      CloseHandle(directory);
      return false;
    }
    CloseHandle(directory);
    directory = child;
  }
  parent->handle = directory;
  parent->basename = path.basename;
  return true;
}

bool OpenWindowsProjectRoot(const std::string& root, HANDLE* opened) {
  if (!WindowsRelativeApiAvailable()) return false;
  std::wstring project_root;
  size_t root_end = 0;
  if (!Utf8PathToWide(root, &project_root)
      || !IsWindowsAbsolute(project_root, &root_end)) return false;
  while (project_root.size() > root_end && IsSeparator(project_root.back())) {
    project_root.pop_back();
  }
  std::wstring anchor = project_root.substr(0, root_end);
  for (wchar_t& character : anchor) if (character == L'/') character = L'\\';
  if (anchor.empty()) return false;
  if (!IsSeparator(anchor.back())) anchor += L'\\';
  std::vector<std::wstring> directories;
  if (!ParseSafeComponents(project_root, root_end, &directories)) return false;

  HANDLE directory = OpenAbsoluteAnchorNoReparse(anchor);
  if (directory == INVALID_HANDLE_VALUE) return false;
  for (const std::wstring& component : directories) {
    HANDLE child = INVALID_HANDLE_VALUE;
    if (!OpenRelativeDirectoryNoReparse(directory, component, false, &child)) {
      CloseHandle(directory);
      return false;
    }
    CloseHandle(directory);
    directory = child;
  }
  *opened = directory;
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

NativeIdentity WindowsNativeIdentity(const WindowsFileIdentity& identity) {
  return {
      static_cast<std::uint64_t>(identity.volume_serial),
      (static_cast<std::uint64_t>(identity.file_index_high) << 32)
          | static_cast<std::uint64_t>(identity.file_index_low),
  };
}

bool MatchesExpectedWindowsIdentity(const WindowsFileIdentity& identity,
    const WriteOptions& options) {
  const NativeIdentity observed = WindowsNativeIdentity(identity);
  return observed.first == options.expected_identity.first
      && observed.second == options.expected_identity.second;
}

bool SameWindowsFileIdentity(const WindowsFileIdentity& left, const WindowsFileIdentity& right) {
  return left.volume_serial == right.volume_serial && left.file_index_high == right.file_index_high
      && left.file_index_low == right.file_index_low && left.size.QuadPart == right.size.QuadPart;
}

HANDLE OpenRegularFileNoReparse(const WindowsParent& parent, ACCESS_MASK access, ULONG share) {
  HANDLE handle = INVALID_HANDLE_VALUE;
  if (!CreateFileRelative(parent.handle, parent.basename,
      access | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      share, kFileOpen,
      kFileNonDirectoryFile | kFileOpenReparsePoint | kFileSynchronousIoNonalert,
      FILE_ATTRIBUTE_NORMAL, &handle)) return INVALID_HANDLE_VALUE;
  FILE_ATTRIBUTE_TAG_INFO attributes {};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes, sizeof(attributes))
      || (attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0
      || GetFileType(handle) != FILE_TYPE_DISK) {
    CloseHandle(handle);
    return INVALID_HANDLE_VALUE;
  }
  return handle;
}

HANDLE OpenRegularFileForReplacementFence(const WindowsParent& parent) {
  return OpenRegularFileNoReparse(parent, FILE_READ_DATA, 0);
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

bool CreatePrivateStagingFile(const WindowsParent& parent, HANDLE* staged, DWORD* last_error) {
  for (unsigned int attempt = 0; attempt < 128; ++attempt) {
    const std::wstring candidate = L"." + parent.basename + L".secure-fs."
        + std::to_wstring(GetCurrentProcessId()) + L"." + std::to_wstring(GetTickCount64())
        + L"." + std::to_wstring(attempt);
    HANDLE handle = INVALID_HANDLE_VALUE;
    if (CreateFileRelative(parent.handle, candidate,
        GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE, 0, kFileCreate,
        kFileNonDirectoryFile | kFileOpenReparsePoint | kFileSynchronousIoNonalert,
        FILE_ATTRIBUTE_NORMAL, &handle)) {
      *staged = handle;
      return true;
    }
    const DWORD error = GetLastError();
    if (error != ERROR_FILE_EXISTS && error != ERROR_ALREADY_EXISTS) {
      *last_error = error;
      return false;
    }
  }
  *last_error = ERROR_FILE_EXISTS;
  return false;
}

bool DiscardStagingFile(HANDLE staged) {
  FILE_DISPOSITION_INFO disposition {};
  disposition.DeleteFile = TRUE;
  return SetFileInformationByHandle(staged, FileDispositionInfo, &disposition, sizeof(disposition)) != 0;
}

enum class PublishResult { kPublished, kConflict, kApiUnavailable, kFailed };

PublishResult PublishNoReplace(HANDLE staged, HANDLE parent, const std::wstring& basename) {
  struct RenameInfoEx {
    DWORD Flags;
    HANDLE RootDirectory;
    DWORD FileNameLength;
    WCHAR FileName[1];
  };
  const size_t bytes = offsetof(RenameInfoEx, FileName) + basename.size() * sizeof(WCHAR) + sizeof(WCHAR);
  if (bytes > MAXDWORD) return PublishResult::kFailed;
  std::vector<unsigned char> storage(bytes);
  auto* rename = reinterpret_cast<RenameInfoEx*>(storage.data());
  rename->Flags = 0;  // FileRenameInfoEx without FILE_RENAME_FLAG_REPLACE_IF_EXISTS.
  rename->RootDirectory = parent;
  rename->FileNameLength = static_cast<DWORD>(basename.size() * sizeof(WCHAR));
  std::memcpy(rename->FileName, basename.data(), rename->FileNameLength);
  const WindowsNativeApi& api = GetWindowsNativeApi();
  if (api.nt_set_information_file == nullptr || api.rtl_nt_status_to_dos_error == nullptr) return PublishResult::kApiUnavailable;
  IO_STATUS_BLOCK io_status {};
  const NTSTATUS status = api.nt_set_information_file(staged, &io_status, rename,
      static_cast<ULONG>(bytes), kFileRenameInformationEx);
  if (status >= 0) return PublishResult::kPublished;
  const DWORD error = api.rtl_nt_status_to_dos_error(status);
  if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) return PublishResult::kConflict;
  if (error == ERROR_INVALID_PARAMETER || error == ERROR_NOT_SUPPORTED || error == ERROR_CALL_NOT_IMPLEMENTED) return PublishResult::kApiUnavailable;
  return PublishResult::kFailed;
}

bool EqualExpected(HANDLE handle, const WriteOptions& options) {
  WindowsFileIdentity identity {};
  LARGE_INTEGER beginning {};
  if (!GetWindowsFileIdentity(handle, &identity)
      || !MatchesExpectedWindowsIdentity(identity, options) || identity.size.QuadPart < 0
      || static_cast<unsigned long long>(identity.size.QuadPart) != static_cast<unsigned long long>(options.expected_length)) return false;
  if (SetFilePointerEx(handle, beginning, nullptr, FILE_BEGIN) == 0) return false;
  std::vector<char> observed(options.expected_length);
  size_t offset = 0;
  while (offset < observed.size()) {
    const DWORD chunk = static_cast<DWORD>(std::min<size_t>(observed.size() - offset, 1024 * 1024));
    DWORD count = 0;
    if (!ReadFile(handle, observed.data() + offset, chunk, &count, nullptr) || count == 0) return false;
    offset += count;
  }
  WindowsFileIdentity after {};
  return GetWindowsFileIdentity(handle, &after) && SameWindowsFileIdentity(identity, after)
      && (options.expected_length == 0 || std::memcmp(observed.data(), options.expected, options.expected_length) == 0);
}

PublishResult PublishReplace(HANDLE staged, HANDLE parent, const std::wstring& basename,
    DWORD* failure_error) {
  struct RenameInfoEx {
    DWORD Flags;
    HANDLE RootDirectory;
    DWORD FileNameLength;
    WCHAR FileName[1];
  };
  const size_t bytes = offsetof(RenameInfoEx, FileName) + basename.size() * sizeof(WCHAR) + sizeof(WCHAR);
  if (bytes > MAXDWORD) {
    *failure_error = ERROR_INVALID_PARAMETER;
    return PublishResult::kFailed;
  }
  std::vector<unsigned char> storage(bytes);
  auto* rename = reinterpret_cast<RenameInfoEx*>(storage.data());
  // The verified destination remains open with no sharing while this atomic
  // POSIX-semantics rename replaces its namespace entry. Windows therefore
  // excludes competing writers/deleters/renamers without a close-before-rename
  // gap, while existing handles to the replaced file remain valid.
  rename->Flags = kFileRenameReplaceIfExists | kFileRenamePosixSemantics;
  rename->RootDirectory = parent;
  rename->FileNameLength = static_cast<DWORD>(basename.size() * sizeof(WCHAR));
  std::memcpy(rename->FileName, basename.data(), rename->FileNameLength);
  const WindowsNativeApi& api = GetWindowsNativeApi();
  if (api.nt_set_information_file == nullptr || api.rtl_nt_status_to_dos_error == nullptr) {
    *failure_error = ERROR_CALL_NOT_IMPLEMENTED;
    return PublishResult::kApiUnavailable;
  }
  IO_STATUS_BLOCK io_status {};
  const NTSTATUS status = api.nt_set_information_file(staged, &io_status, rename,
      static_cast<ULONG>(bytes), kFileRenameInformationEx);
  if (status >= 0) return PublishResult::kPublished;
  const DWORD error = api.rtl_nt_status_to_dos_error(status);
  *failure_error = error;
  if (error == ERROR_FILE_NOT_FOUND || error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS || error == ERROR_SHARING_VIOLATION) return PublishResult::kConflict;
  if (error == ERROR_INVALID_PARAMETER || error == ERROR_NOT_SUPPORTED || error == ERROR_CALL_NOT_IMPLEMENTED) return PublishResult::kApiUnavailable;
  return PublishResult::kFailed;
}

LeaseAcquireResult AcquirePlatformProjectLease(
    const std::string& project_root, ProjectLease* lease, DWORD* last_error) {
  HANDLE root = INVALID_HANDLE_VALUE;
  if (!OpenWindowsProjectRoot(project_root, &root)) {
    *last_error = GetLastError();
    return LeaseAcquireResult::kRejected;
  }
  HANDLE awm = INVALID_HANDLE_VALUE;
  if (!OpenRelativeDirectoryNoReparse(root, L".awm", true, &awm)) {
    *last_error = GetLastError();
    CloseHandle(root);
    return LeaseAcquireResult::kRejected;
  }
  CloseHandle(root);

  HANDLE handle = INVALID_HANDLE_VALUE;
  if (!CreateFileRelative(awm, L".secure-fs-lease",
      GENERIC_READ | GENERIC_WRITE | SYNCHRONIZE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, kFileOpenIf,
      kFileNonDirectoryFile | kFileOpenReparsePoint | kFileSynchronousIoNonalert,
      FILE_ATTRIBUTE_NORMAL, &handle)) {
    *last_error = GetLastError();
    CloseHandle(awm);
    return LeaseAcquireResult::kRejected;
  }
  CloseHandle(awm);
  FILE_ATTRIBUTE_TAG_INFO attributes {};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo,
          &attributes, sizeof(attributes))
      || (attributes.FileAttributes
          & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0
      || GetFileType(handle) != FILE_TYPE_DISK) {
    *last_error = GetLastError();
    CloseHandle(handle);
    return LeaseAcquireResult::kRejected;
  }

  lease->lock_range = {};
  if (LockFileEx(handle,
      LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
      0, MAXDWORD, MAXDWORD, &lease->lock_range) == 0) {
    const DWORD lock_error = GetLastError();
    CloseHandle(handle);
    return lock_error == ERROR_LOCK_VIOLATION
        ? LeaseAcquireResult::kAlreadyHeld
        : LeaseAcquireResult::kFailed;
  }
  lease->handle = handle;
  lease->held = true;
  return LeaseAcquireResult::kAcquired;
}

void ReleasePlatformProjectLease(ProjectLease* lease) {
  if (!lease->held) return;
  const HANDLE handle = lease->handle;
  lease->held = false;
  lease->handle = INVALID_HANDLE_VALUE;
  if (handle != INVALID_HANDLE_VALUE) {
    UnlockFileEx(handle, 0, MAXDWORD, MAXDWORD, &lease->lock_range);
    CloseHandle(handle);
  }
  lease->lock_range = {};
}
#endif

bool WriteOptionsArg(napi_env env, napi_value value, WriteOptions* result) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_object) return false;
  napi_value mode_value, parents_value;
  size_t mode_length = 0;
  if (napi_get_named_property(env, value, "mode", &mode_value) != napi_ok
      || napi_get_value_string_utf8(env, mode_value, nullptr, 0, &mode_length) != napi_ok
      || mode_length > 8) return false;
  std::string mode(mode_length, '\0');
  if (napi_get_value_string_utf8(env, mode_value, mode.data(), mode_length + 1, &mode_length) != napi_ok) return false;
  if (napi_get_named_property(env, value, "createParents", &parents_value) != napi_ok
      || napi_get_value_bool(env, parents_value, &result->create_parents) != napi_ok) return false;
  if (mode == "create") { result->replace = false; return true; }
  if (mode != "replace") return false;
  napi_value expected, expected_identity;
  void* identity_bytes = nullptr;
  size_t identity_length = 0;
  if (napi_get_named_property(env, value, "expected", &expected) != napi_ok
      || napi_get_buffer_info(env, expected, reinterpret_cast<void**>(const_cast<char**>(&result->expected)), &result->expected_length) != napi_ok
      || napi_get_named_property(env, value, "expectedIdentity", &expected_identity) != napi_ok
      || napi_get_buffer_info(env, expected_identity, &identity_bytes, &identity_length) != napi_ok
#ifdef _WIN32
      || !ParseIdentity(identity_bytes, identity_length, kWindowsIdentityKind,
          &result->expected_identity)
#else
      || !ParseIdentity(identity_bytes, identity_length, kPosixIdentityKind,
          &result->expected_identity)
#endif
      ) return false;
  result->replace = true;
  return true;
}

void FinalizeProjectLease(napi_env, void* data, void*) {
  auto* lease = static_cast<ProjectLease*>(data);
  if (lease == nullptr) return;
  ReleasePlatformProjectLease(lease);
  delete lease;
}

napi_value AcquireProjectLease(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok
      || argc != 1) {
    Throw(env, "acquireProjectLease requires one project root");
    return nullptr;
  }
  std::string project_root;
  if (!StringArg(env, args[0], &project_root)) {
    Throw(env, "invalid acquireProjectLease arguments");
    return nullptr;
  }
  if (ContainsNul(project_root)) {
    Throw(env, "secure-fs path argument contains a NUL byte");
    return nullptr;
  }
  auto* lease = new (std::nothrow) ProjectLease;
  if (lease == nullptr) {
    Throw(env, "secure-fs could not allocate project lease");
    return nullptr;
  }
#ifdef _WIN32
  DWORD lease_error = ERROR_SUCCESS;
  const LeaseAcquireResult acquire_result =
      AcquirePlatformProjectLease(project_root, lease, &lease_error);
#else
  const LeaseAcquireResult acquire_result =
      AcquirePlatformProjectLease(project_root, lease);
#endif
  if (acquire_result != LeaseAcquireResult::kAcquired) {
    delete lease;
    if (acquire_result == LeaseAcquireResult::kAlreadyHeld) {
      Throw(env, "project lease is already held");
    } else if (acquire_result == LeaseAcquireResult::kRejected) {
#ifdef _WIN32
      const std::string message = "secure-fs rejected path ancestor for project lease (win32="
          + std::to_string(lease_error) + ")";
      Throw(env, message.c_str());
#else
      Throw(env, "secure-fs rejected path ancestor for project lease");
#endif
    } else {
      Throw(env, "secure-fs could not acquire project lease");
    }
    return nullptr;
  }

  napi_value external;
  if (napi_create_external(env, lease, FinalizeProjectLease, nullptr, &external)
      != napi_ok) {
    ReleasePlatformProjectLease(lease);
    delete lease;
    Throw(env, "secure-fs could not create project lease token");
    return nullptr;
  }
  if (napi_type_tag_object(env, external, &kProjectLeaseTypeTag) != napi_ok) {
    ReleasePlatformProjectLease(lease);
    Throw(env, "secure-fs could not tag project lease token");
    return nullptr;
  }
  return external;
}

napi_value ReleaseProjectLease(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_valuetype type = napi_undefined;
  bool tagged = false;
  void* data = nullptr;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok
      || argc != 1 || napi_typeof(env, args[0], &type) != napi_ok
      || type != napi_external
      || napi_check_object_type_tag(env, args[0], &kProjectLeaseTypeTag, &tagged)
          != napi_ok
      || !tagged || napi_get_value_external(env, args[0], &data) != napi_ok
      || data == nullptr) {
    Throw(env, "invalid project lease token");
    return nullptr;
  }
  ReleasePlatformProjectLease(static_cast<ProjectLease*>(data));
  napi_value undefined;
  if (napi_get_undefined(env, &undefined) != napi_ok) return nullptr;
  return undefined;
}

#ifndef _WIN32
NativeIdentity PosixNativeIdentity(const struct stat& statbuf) {
  static_assert(sizeof(dev_t) <= sizeof(std::uint64_t));
  static_assert(sizeof(ino_t) <= sizeof(std::uint64_t));
  return {
      static_cast<std::uint64_t>(statbuf.st_dev),
      static_cast<std::uint64_t>(statbuf.st_ino),
  };
}

bool MatchesExpectedPosixIdentity(const struct stat& statbuf,
    const WriteOptions& options) {
  const NativeIdentity observed = PosixNativeIdentity(statbuf);
  return observed.first == options.expected_identity.first
      && observed.second == options.expected_identity.second;
}

bool EqualExpected(int fd, const WriteOptions& options) {
  struct stat statbuf {};
  if (fstat(fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode)
      || !MatchesExpectedPosixIdentity(statbuf, options) || statbuf.st_size < 0
      || static_cast<unsigned long long>(statbuf.st_size) != static_cast<unsigned long long>(options.expected_length)) return false;
  if (lseek(fd, 0, SEEK_SET) < 0) return false;
  std::vector<char> observed(options.expected_length);
  size_t offset = 0;
  while (offset < observed.size()) {
    const ssize_t count = read(fd, observed.data() + offset, observed.size() - offset);
    if (count <= 0) return false;
    offset += static_cast<size_t>(count);
  }
  struct stat after {};
  return fstat(fd, &after) == 0 && S_ISREG(after.st_mode)
      && after.st_dev == statbuf.st_dev && after.st_ino == statbuf.st_ino
      && after.st_size == statbuf.st_size
      && (options.expected_length == 0
          || std::memcmp(observed.data(), options.expected, options.expected_length) == 0);
}

bool PathMatchesExpectedIdentity(int parent, const std::string& basename,
    const WriteOptions& options) {
  struct stat statbuf {};
  return fstatat(parent, basename.c_str(), &statbuf, AT_SYMLINK_NOFOLLOW) == 0
      && S_ISREG(statbuf.st_mode) && MatchesExpectedPosixIdentity(statbuf, options);
}

#endif

napi_value ReadRegularFile(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 2) { Throw(env, "readRegularFile requires path and limit"); return nullptr; }
  std::string file; int64_t limit = 0;
  if (!StringArg(env, args[0], &file) || napi_get_value_int64(env, args[1], &limit) != napi_ok || limit <= 0) { Throw(env, "invalid readRegularFile arguments"); return nullptr; }
  if (ContainsNul(file)) { Throw(env, "secure-fs path argument contains a NUL byte"); return nullptr; }
#ifdef _WIN32
  if (!WindowsRelativeApiAvailable()) { Throw(env, "secure-fs Windows handle-relative API is unavailable"); return nullptr; }
  WindowsParent parent;
  const size_t separator = file.find_last_of("\\/");
  const bool drive_root_file = separator == 2 && file.size() > 3 && file[1] == ':';
  const std::string project_root = drive_root_file ? file.substr(0, 3) : separator == std::string::npos ? "" : file.substr(0, separator);
  const std::string destination = drive_root_file ? file.substr(3) : separator == std::string::npos ? "" : file.substr(separator + 1);
  if (project_root.empty() || destination.empty()
      || !OpenWindowsParent(project_root, destination, &parent, false)) {
    Throw(env, "secure-fs rejected path ancestor"); return nullptr;
  }
  HANDLE handle = OpenRegularFileNoReparse(parent, FILE_READ_DATA,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
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
  const auto identity = EncodeIdentity(kWindowsIdentityKind, WindowsNativeIdentity(after));
  CloseHandle(handle);
  napi_value output;
  if (!CreateReadResult(env, bytes, identity, &output)) { Throw(env, "secure-fs could not create read result"); return nullptr; }
  return output;
#else
  std::string basename; int parent = OpenParent(file, &basename, false);
  if (parent < 0) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  int fd = openat(parent, basename.c_str(), O_RDONLY | O_NOFOLLOW); close(parent);
  struct stat statbuf {};
  if (fd < 0 || fstat(fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode) || statbuf.st_size < 0 || statbuf.st_size > limit) { if (fd >= 0) close(fd); Throw(env, "secure-fs rejected non-regular or oversized file"); return nullptr; }
  std::vector<char> bytes(static_cast<size_t>(statbuf.st_size)); size_t read_total = 0;
  while (read_total < bytes.size()) { ssize_t count = read(fd, bytes.data() + read_total, bytes.size() - read_total); if (count <= 0) { close(fd); Throw(env, "secure-fs could not read file"); return nullptr; } read_total += static_cast<size_t>(count); }
  struct stat after {}; if (fstat(fd, &after) != 0 || after.st_dev != statbuf.st_dev || after.st_ino != statbuf.st_ino || after.st_size != statbuf.st_size) { close(fd); Throw(env, "secure-fs file changed during read"); return nullptr; }
  const auto identity = EncodeIdentity(kPosixIdentityKind, PosixNativeIdentity(after));
  close(fd);
  napi_value output;
  if (!CreateReadResult(env, bytes, identity, &output)) { Throw(env, "secure-fs could not create read result"); return nullptr; }
  return output;
#endif
}

// Delete through the same parent descriptor/handle used for publication, and
// only after proving the leaf is the exact file identified by a prior native
// read. This is intentionally not a general pathname deletion primitive.
napi_value RemoveObservedProjectFile(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 3) {
    Throw(env, "removeObservedProjectFile requires project root, destination, and identity");
    return nullptr;
  }
  std::string project_root, destination;
  void* identity_bytes = nullptr;
  size_t identity_length = 0;
  NativeIdentity expected {};
  if (!StringArg(env, args[0], &project_root) || !StringArg(env, args[1], &destination)
      || napi_get_buffer_info(env, args[2], &identity_bytes, &identity_length) != napi_ok
#ifdef _WIN32
      || !ParseIdentity(identity_bytes, identity_length, kWindowsIdentityKind, &expected)
#else
      || !ParseIdentity(identity_bytes, identity_length, kPosixIdentityKind, &expected)
#endif
      ) {
    Throw(env, "invalid removeObservedProjectFile arguments");
    return nullptr;
  }
  if (ContainsNul(project_root) || ContainsNul(destination)) {
    Throw(env, "secure-fs path argument contains a NUL byte");
    return nullptr;
  }
#ifdef _WIN32
  if (!WindowsRelativeApiAvailable()) {
    Throw(env, "secure-fs Windows handle-relative API is unavailable");
    return nullptr;
  }
  WindowsParent parent;
  if (!OpenWindowsParent(project_root, destination, &parent, false)) {
    Throw(env, "secure-fs rejected path ancestor");
    return nullptr;
  }
  HANDLE target = OpenRegularFileNoReparse(parent, DELETE, 0);
  CloseWindowsParent(&parent);
  WindowsFileIdentity observed {};
  const bool matched = target != INVALID_HANDLE_VALUE
      && GetWindowsFileIdentity(target, &observed)
      && WindowsNativeIdentity(observed).first == expected.first
      && WindowsNativeIdentity(observed).second == expected.second;
  if (!matched) {
    if (target != INVALID_HANDLE_VALUE) CloseHandle(target);
    Throw(env, "secure-fs original changed before identity-fenced removal");
    return nullptr;
  }
  FILE_DISPOSITION_INFO disposition {};
  disposition.DeleteFile = TRUE;
  if (SetFileInformationByHandle(target, FileDispositionInfo, &disposition, sizeof(disposition)) == 0) {
    CloseHandle(target);
    Throw(env, "secure-fs identity-fenced removal failed");
    return nullptr;
  }
  CloseHandle(target);
#else
  if (project_root.empty() || project_root[0] != '/' || destination.empty() || destination[0] == '/') {
    Throw(env, "secure-fs rejected path ancestor");
    return nullptr;
  }
  for (size_t cursor = 0; cursor < destination.size();) {
    const size_t next = destination.find('/', cursor);
    const std::string component = destination.substr(cursor, next == std::string::npos ? std::string::npos : next - cursor);
    if (component.empty() || component == "." || component == ".." || component.find('\\') != std::string::npos) {
      Throw(env, "secure-fs rejected path ancestor");
      return nullptr;
    }
    if (next == std::string::npos) break;
    cursor = next + 1;
  }
  const std::string file = project_root + "/" + destination;
  std::string basename;
  const int parent = OpenParent(file, &basename, false);
  if (parent < 0) {
    Throw(env, "secure-fs rejected path ancestor");
    return nullptr;
  }
  const int target = openat(parent, basename.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  struct stat statbuf {};
  const bool matched = target >= 0 && fstat(target, &statbuf) == 0 && S_ISREG(statbuf.st_mode)
      && PosixNativeIdentity(statbuf).first == expected.first
      && PosixNativeIdentity(statbuf).second == expected.second;
  if (!matched) {
    if (target >= 0) close(target);
    close(parent);
    Throw(env, "secure-fs original changed before identity-fenced removal");
    return nullptr;
  }
  // unlinkat is relative to the verified parent descriptor. The project lease
  // serializes AWM writers for the small open-to-unlink interval.
  const int unlink_result = unlinkat(parent, basename.c_str(), 0);
  close(target);
  if (unlink_result != 0) {
    close(parent);
    Throw(env, "secure-fs identity-fenced removal failed");
    return nullptr;
  }
  fsync(parent);
  close(parent);
#endif
  napi_value undefined;
  if (napi_get_undefined(env, &undefined) != napi_ok) return nullptr;
  return undefined;
}

napi_value WriteProjectTransaction(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value args[4];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 4) { Throw(env, "writeProjectTransaction requires project root, destination, bytes, and options"); return nullptr; }
  std::string project_root, destination; void* bytes = nullptr; size_t length = 0;
  WriteOptions options;
  if (!StringArg(env, args[0], &project_root) || !StringArg(env, args[1], &destination)) { Throw(env, "invalid writeProjectTransaction arguments"); return nullptr; }
  if (ContainsNul(project_root) || ContainsNul(destination)) { Throw(env, "secure-fs path argument contains a NUL byte"); return nullptr; }
  if (napi_get_buffer_info(env, args[2], &bytes, &length) != napi_ok
      || !WriteOptionsArg(env, args[3], &options)) { Throw(env, "invalid writeProjectTransaction arguments"); return nullptr; }
#ifdef _WIN32
  if (!WindowsRelativeApiAvailable()) { Throw(env, "secure-fs Windows handle-relative API is unavailable"); return nullptr; }
  WindowsParent parent;
  if (!OpenWindowsParent(project_root, destination, &parent, options.create_parents)) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  HANDLE original = INVALID_HANDLE_VALUE;
  if (options.replace) {
    original = OpenRegularFileForReplacementFence(parent);
    if (original == INVALID_HANDLE_VALUE || !EqualExpected(original, options)) {
      if (original != INVALID_HANDLE_VALUE) CloseHandle(original);
      CloseWindowsParent(&parent);
      Throw(env, "secure-fs original changed before fenced replacement");
      return nullptr;
    }
  }
  HANDLE staged = INVALID_HANDLE_VALUE;
  DWORD staging_error = ERROR_SUCCESS;
  if (!CreatePrivateStagingFile(parent, &staged, &staging_error)) {
    if (original != INVALID_HANDLE_VALUE) CloseHandle(original);
    CloseWindowsParent(&parent);
    const std::string message = "secure-fs could not stage transaction (win32="
        + std::to_string(staging_error) + ")";
    Throw(env, message.c_str());
    return nullptr;
  }
  const bool staged_ok = WriteAll(staged, bytes, length) && FlushFileBuffers(staged) != 0;
  PublishResult publish_result = PublishResult::kFailed;
  DWORD replacement_error = ERROR_SUCCESS;
  if (staged_ok && options.replace) {
    const bool matched = EqualExpected(original, options);
    publish_result = matched
        ? PublishReplace(staged, parent.handle, parent.basename, &replacement_error)
        : PublishResult::kConflict;
  } else if (staged_ok) {
    publish_result = PublishNoReplace(staged, parent.handle, parent.basename);
  }
  if (publish_result != PublishResult::kPublished && !DiscardStagingFile(staged)) publish_result = PublishResult::kFailed;
  CloseHandle(staged);
  if (original != INVALID_HANDLE_VALUE) CloseHandle(original);
  CloseWindowsParent(&parent);
  if (publish_result == PublishResult::kApiUnavailable) { Throw(env, "secure-fs Windows FileRenameInfoEx is unavailable"); return nullptr; }
  if (options.replace && publish_result != PublishResult::kPublished) {
    if (replacement_error != ERROR_SUCCESS) {
      const std::string message = "secure-fs Windows replacement failed (win32="
          + std::to_string(replacement_error) + ")";
      Throw(env, message.c_str());
    } else {
      Throw(env, "secure-fs original changed before fenced replacement");
    }
    return nullptr;
  }
  if (publish_result == PublishResult::kConflict) { ThrowDestinationExists(env); return nullptr; }
  if (publish_result != PublishResult::kPublished) { Throw(env, "secure-fs transaction failed"); return nullptr; }
  napi_value undefined; napi_get_undefined(env, &undefined); return undefined;
#else
  if (project_root.empty() || project_root[0] != '/' || destination.empty() || destination[0] == '/') { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  for (size_t cursor = 0; cursor < destination.size();) {
    const size_t next = destination.find('/', cursor);
    const std::string component = destination.substr(cursor, next == std::string::npos ? std::string::npos : next - cursor);
    if (component.empty() || component == "." || component == ".." || component.find('\\') != std::string::npos) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
    if (next == std::string::npos) break;
    cursor = next + 1;
  }
  const std::string file = project_root + "/" + destination;
  std::string basename; int parent = OpenParent(file, &basename, options.create_parents);
  if (parent < 0) { Throw(env, "secure-fs rejected path ancestor"); return nullptr; }
  int original = -1;
  if (options.replace) {
    original = openat(parent, basename.c_str(), O_RDONLY | O_NOFOLLOW);
    if (original < 0 || !EqualExpected(original, options)) {
      if (original >= 0) close(original);
      close(parent);
      Throw(env, "secure-fs original changed before fenced replacement");
      return nullptr;
    }
  }
  std::string temporary;
  int fd = CreatePrivateStagingFile(parent, basename, &temporary);
  if (fd < 0) {
    if (original >= 0) close(original);
    close(parent);
    Throw(env, "secure-fs could not stage transaction");
    return nullptr;
  }
  size_t written = 0;
  while (written < length) {
    const ssize_t count = write(fd, static_cast<char*>(bytes) + written, length - written);
    if (count <= 0) {
      close(fd);
      unlinkat(parent, temporary.c_str(), 0);
      if (original >= 0) close(original);
      close(parent);
      Throw(env, "secure-fs could not stage transaction");
      return nullptr;
    }
    written += static_cast<size_t>(count);
  }
  bool staged_ok = fsync(fd) == 0;
  if (close(fd) != 0) staged_ok = false;
  if (!staged_ok) {
    unlinkat(parent, temporary.c_str(), 0);
    if (original >= 0) close(original);
    close(parent);
    Throw(env, "secure-fs transaction failed");
    return nullptr;
  }
  if (options.replace) {
    const bool matched = EqualExpected(original, options)
        && PathMatchesExpectedIdentity(parent, basename, options);
    if (!matched || renameat(parent, temporary.c_str(), parent, basename.c_str()) != 0) {
      unlinkat(parent, temporary.c_str(), 0);
      close(original);
      close(parent);
      Throw(env, "secure-fs original changed before fenced replacement");
      return nullptr;
    }
    close(original);
  } else if (linkat(parent, temporary.c_str(), parent, basename.c_str(), 0) != 0) {
    const int publish_error = errno;
    unlinkat(parent, temporary.c_str(), 0);
    close(parent);
    if (publish_error == EEXIST) ThrowDestinationExists(env);
    else Throw(env, "secure-fs transaction failed");
    return nullptr;
  }
  unlinkat(parent, temporary.c_str(), 0); fsync(parent); close(parent); napi_value undefined; napi_get_undefined(env, &undefined); return undefined;
#endif
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"acquireProjectLease", nullptr, AcquireProjectLease, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"releaseProjectLease", nullptr, ReleaseProjectLease, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"readRegularFile", nullptr, ReadRegularFile, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"writeProjectTransaction", nullptr, WriteProjectTransaction, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"removeObservedProjectFile", nullptr, RemoveObservedProjectFile, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
