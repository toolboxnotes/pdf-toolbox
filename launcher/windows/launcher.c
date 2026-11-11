// PDF Toolbox launcher (Windows)
// Opens PDF-Toolbox.html from the same folder in Chrome's (or Edge's, if Chrome is missing) "app mode":
// its own window with no address bar or tabs, shown in the taskbar like a normal program.
// When neither is found, opens it with the system default browser.
// Build: see build-windows.sh (zig cc cross-compile; -mwindows hides the console window)
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <shellapi.h>
#include <wchar.h>

#define HTML_NAME L"PDF-Toolbox.html"

static int file_exists(const wchar_t *p) {
  DWORD a = GetFileAttributesW(p);
  return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static int from_app_paths(const wchar_t *exe, wchar_t *out, DWORD cap) {
  wchar_t key[300];
  HKEY roots[2] = { HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER };
  swprintf(key, 300, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\%ls", exe);
  for (int i = 0; i < 2; i++) {
    DWORD size = cap * sizeof(wchar_t);
    if (RegGetValueW(roots[i], key, NULL, RRF_RT_REG_SZ, NULL, out, &size) == ERROR_SUCCESS && file_exists(out)) return 1;
  }
  return 0;
}

static int find_browser(wchar_t *out, DWORD cap) {
  // Look for Chrome first, then Edge
  if (from_app_paths(L"chrome.exe", out, cap)) return 1;
  const wchar_t *chrome[] = {
    L"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
    L"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
    L"%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
  };
  for (int i = 0; i < 3; i++) { ExpandEnvironmentStringsW(chrome[i], out, cap); if (file_exists(out)) return 1; }
  if (from_app_paths(L"msedge.exe", out, cap)) return 1;
  const wchar_t *edge[] = {
    L"%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
    L"%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
    L"%LOCALAPPDATA%\\Microsoft\\Edge\\Application\\msedge.exe",
  };
  for (int i = 0; i < 3; i++) { ExpandEnvironmentStringsW(edge[i], out, cap); if (file_exists(out)) return 1; }
  return 0;
}

// C:\a b\x.html → file:///C:/a%20b/x.html (UTF-8 percent-encoding)
static void path_to_url(const wchar_t *path, wchar_t *url, int cap) {
  char utf8[4096];
  int n = WideCharToMultiByte(CP_UTF8, 0, path, -1, utf8, sizeof(utf8), NULL, NULL);
  int j = swprintf(url, cap, L"file:///");
  static const char *hex = "0123456789ABCDEF";
  for (int i = 0; i < n - 1 && j < cap - 4; i++) {
    unsigned char c = (unsigned char)utf8[i];
    if (c == '\\') c = '/';
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' || c == '/' || c == ':') url[j++] = c;
    else { url[j++] = L'%'; url[j++] = hex[c >> 4]; url[j++] = hex[c & 15]; }
  }
  url[j] = 0;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR args, int show) {
  (void)inst; (void)prev; (void)args; (void)show;
  wchar_t dir[MAX_PATH], html[MAX_PATH + 32];
  GetModuleFileNameW(NULL, dir, MAX_PATH);
  wchar_t *slash = wcsrchr(dir, L'\\');
  if (slash) *slash = 0;
  swprintf(html, MAX_PATH + 32, L"%ls\\%ls", dir, HTML_NAME);
  if (!file_exists(html)) {
    MessageBoxW(NULL, L"PDF-Toolbox.html was not found next to this program.\nPlease keep \"PDF Toolbox.exe\" and \"PDF-Toolbox.html\" in the same folder.\n\n같은 폴더에 PDF-Toolbox.html 파일이 있어야 합니다.", L"PDF Toolbox", MB_ICONERROR);
    return 1;
  }
  wchar_t browser[MAX_PATH];
  if (find_browser(browser, MAX_PATH)) {
    wchar_t url[8192], profile[MAX_PATH], cmd[12000];
    path_to_url(html, url, 8192);
    ExpandEnvironmentStringsW(L"%LOCALAPPDATA%\\PDF Toolbox\\Browser", profile, MAX_PATH);
    // Separate browser profile: keeps the window apart from the user's own browser and remembers window size and language
    swprintf(cmd, 12000, L"\"%ls\" --app=\"%ls\" --user-data-dir=\"%ls\" --no-first-run --no-default-browser-check --window-size=1280,860 --disable-features=Translate", browser, url, profile);
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
      CloseHandle(pi.hThread);
      CloseHandle(pi.hProcess);
      return 0;
    }
  }
  // Fallback: default browser
  if ((INT_PTR)ShellExecuteW(NULL, L"open", html, NULL, dir, SW_SHOWNORMAL) <= 32) {
    MessageBoxW(NULL, L"Could not open a browser. Please open PDF-Toolbox.html with Microsoft Edge or Google Chrome.", L"PDF Toolbox", MB_ICONERROR);
    return 1;
  }
  return 0;
}
