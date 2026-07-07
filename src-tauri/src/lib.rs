mod commands;
mod tray;

use commands::download::{download_file, resolve_video};
use commands::history::{init_history_db, add_history_item, get_history_items, delete_history_item};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            download_file,
            resolve_video,
            init_history_db,
            add_history_item,
            get_history_items,
            delete_history_item
        ])
        .setup(|app| {
            // Setup system tray
            let _ = tray::setup_tray(app.handle());
            
            // Auto initialize database
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = init_history_db(app_handle);
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
