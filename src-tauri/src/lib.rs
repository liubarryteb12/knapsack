mod session;

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

static PENDING_PROMPT_SHARE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static WINDOW_READY: OnceLock<Mutex<bool>> = OnceLock::new();
static APP_HANDLE: OnceLock<Mutex<Option<tauri::AppHandle>>> = OnceLock::new();

fn prompt_share_arg() -> Option<String> {
  std::env::args_os()
    .skip(1)
    .filter_map(|arg| arg.into_string().ok())
    .find(|arg| arg.starts_with("knapsack-prompt://"))
}

fn emit_pending_prompt_share(app: &tauri::AppHandle) {
  let ready = WINDOW_READY
    .get()
    .and_then(|value| value.lock().ok().map(|value| *value))
    .unwrap_or(false);
  if !ready {
    return;
  }
  let Some(pending) = PENDING_PROMPT_SHARE.get() else { return };
  let Ok(mut value) = pending.lock() else { return };
  let Some(link) = value.take() else { return };
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
  let _ = app.emit("knapsack://prompt-share", link);
}

fn queue_prompt_share(link: String) {
  if let Some(pending) = PENDING_PROMPT_SHARE.get() {
    if let Ok(mut value) = pending.lock() {
      *value = Some(link);
    }
  }
}

fn deliver_forwarded_prompt_share(link: String) {
  if !link.starts_with("knapsack-prompt://") {
    return;
  }
  queue_prompt_share(link);
  let app = APP_HANDLE
    .get()
    .and_then(|value| value.lock().ok().and_then(|value| value.clone()));
  if let Some(app) = app {
    emit_pending_prompt_share(&app);
  }
}

#[tauri::command]
fn prompt_share_ready(app: tauri::AppHandle) {
  if let Some(ready) = WINDOW_READY.get() {
    if let Ok(mut value) = ready.lock() {
      *value = true;
    }
  }
  emit_pending_prompt_share(&app);
}

fn current_executable() -> Option<PathBuf> {
  std::env::current_exe().ok()
}

#[cfg(windows)]
fn focus_existing_window() -> bool {
  use std::ffi::OsStr;
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::UI::WindowsAndMessaging::{
    FindWindowW, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
  };

  let title: Vec<u16> = OsStr::new("行囊 Knapsack")
    .encode_wide()
    .chain(std::iter::once(0))
    .collect();
  let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
  if hwnd.is_null() {
    return false;
  }
  unsafe {
    if IsWindowVisible(hwnd) == 0 {
      ShowWindow(hwnd, SW_RESTORE);
    }
    SetForegroundWindow(hwnd);
  }
  true
}

#[cfg(not(windows))]
fn focus_existing_window() -> bool {
  false
}

#[cfg(windows)]
const PROMPT_SHARE_PIPE: &str = r"\\.\pipe\knapsack-prompt-share-v1";

#[cfg(windows)]
fn send_prompt_share_to_pipe(link: &str) -> bool {
  use std::time::Duration;

  for _ in 0..12 {
    match std::fs::OpenOptions::new()
      .write(true)
      .open(PROMPT_SHARE_PIPE)
    {
      Ok(mut pipe) => return pipe.write_all(link.as_bytes()).is_ok(),
      Err(error) if error.raw_os_error() == Some(231) => {
        std::thread::sleep(Duration::from_millis(25));
      }
      Err(_) => return false,
    }
  }
  false
}

#[cfg(windows)]
fn start_prompt_share_pipe() -> bool {
  use std::ffi::OsStr;
  use std::os::windows::ffi::OsStrExt;
  use std::ptr::null;
  use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX,
  };
  use windows_sys::Win32::System::Pipes::{
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
  };

  std::thread::spawn(move || {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{
      CloseHandle, GetLastError, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::ReadFile;
    use windows_sys::Win32::System::Pipes::{
      ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe,
    };

    let name: Vec<u16> = OsStr::new(PROMPT_SHARE_PIPE)
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();
    let handle = unsafe {
      CreateNamedPipeW(
        name.as_ptr(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        PIPE_UNLIMITED_INSTANCES,
        64 * 1024,
        64 * 1024,
        0,
        null(),
      )
    };
    if handle == INVALID_HANDLE_VALUE {
      return;
    }

    loop {
      let connected = unsafe { ConnectNamedPipe(handle, null_mut()) };
      if connected == 0 {
        let error = unsafe { GetLastError() };
        if error != ERROR_PIPE_CONNECTED {
          break;
        }
      }

      let mut received = Vec::new();
      let mut buffer = vec![0u8; 64 * 1024];
      loop {
        let mut bytes_read = 0u32;
        let ok = unsafe {
          ReadFile(
            handle,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            &mut bytes_read,
            null_mut(),
          )
        };
        if ok == 0 || bytes_read == 0 {
          break;
        }
        received.extend_from_slice(&buffer[..bytes_read as usize]);
      }

      if let Ok(link) = String::from_utf8(received) {
        deliver_forwarded_prompt_share(link);
      }
      unsafe {
        DisconnectNamedPipe(handle);
      }
    }
    unsafe {
      CloseHandle(handle);
    }
  });
  true
}

#[cfg(not(windows))]
fn start_prompt_share_pipe() -> bool {
  false
}

#[cfg(windows)]
fn install_protocol_registration() {
  use std::ffi::OsStr;
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Foundation::ERROR_SUCCESS;
  use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
    REG_OPTION_NON_VOLATILE, REG_SZ,
  };

  fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value)
      .encode_wide()
      .chain(std::iter::once(0))
      .collect()
  }

  fn set_value(root: HKEY, subkey: &str, name: &str, value: &str) -> bool {
    let subkey = wide(subkey);
    let name = wide(name);
    let value = wide(value);
    let mut key: HKEY = std::ptr::null_mut();
    let created = unsafe {
      RegCreateKeyExW(
        root,
        subkey.as_ptr(),
        0,
        std::ptr::null(),
        REG_OPTION_NON_VOLATILE,
        KEY_SET_VALUE,
        std::ptr::null(),
        &mut key,
        std::ptr::null_mut(),
      )
    };
    if created != ERROR_SUCCESS {
      return false;
    }
    let written = unsafe {
      RegSetValueExW(
        key,
        name.as_ptr(),
        0,
        REG_SZ,
        value.as_ptr().cast::<u8>(),
        (value.len() * std::mem::size_of::<u16>()) as u32,
      )
    };
    unsafe {
      RegCloseKey(key);
    }
    written == ERROR_SUCCESS
  }

  let Some(exe) = current_executable() else { return };
  let exe = exe.display().to_string();
  let command = format!("\"{exe}\" \"%1\"");
  if !set_value(HKEY_CURRENT_USER, r"Software\Classes\knapsack-prompt", "", "URL:Knapsack Prompt Share")
    || !set_value(HKEY_CURRENT_USER, r"Software\Classes\knapsack-prompt", "URL Protocol", "")
    || !set_value(HKEY_CURRENT_USER, r"Software\Classes\knapsack-prompt\DefaultIcon", "", &exe)
    || !set_value(
      HKEY_CURRENT_USER,
      r"Software\Classes\knapsack-prompt\shell\open\command",
      "",
      &command,
    )
  {
    return;
  }
}

#[cfg(not(windows))]
fn install_protocol_registration() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let _ = PENDING_PROMPT_SHARE.set(Mutex::new(prompt_share_arg()));
  let _ = WINDOW_READY.set(Mutex::new(false));
  let _ = APP_HANDLE.set(Mutex::new(None));
  install_protocol_registration();

  #[cfg(windows)]
  {
    if let Some(link) = prompt_share_arg() {
      if send_prompt_share_to_pipe(&link) {
        return;
      }
    } else if focus_existing_window() {
      return;
    }
    let _ = start_prompt_share_pipe();
  }

  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // 局域网会话状态（阶段12）：持有密钥、共享的行程副本与服务句柄
      app.manage(session::SessionState::new(app.handle().clone()));
      if let Some(link) = prompt_share_arg() {
        queue_prompt_share(link);
      }
      if let Some(value) = APP_HANDLE.get() {
        if let Ok(mut handle) = value.lock() {
          *handle = Some(app.handle().clone());
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      session::session_start,
      session::session_stop,
      session::session_status,
      session::session_update_trip,
      prompt_share_ready,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
