mod session;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      session::session_start,
      session::session_stop,
      session::session_status,
      session::session_update_trip,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
