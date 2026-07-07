use tauri::AppHandle;
use std::fs;
use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::time::SystemTime;

#[derive(Serialize, Deserialize, Clone)]
pub struct HistoryItem {
    id: i64,
    title: String,
    resolution: String,
    size: String,
    file_path: String,
    timestamp: u64, // Unix timestamp in seconds
}

fn get_db_connection(app: &AppHandle) -> Result<Connection, String> {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }
    
    let db_path = app_data_dir.join("history.db");
    Connection::open(db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn init_history_db(app: AppHandle) -> Result<String, String> {
    let conn = get_db_connection(&app)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            resolution TEXT NOT NULL,
            size TEXT NOT NULL,
            file_path TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )",
        [],
    ).map_err(|e| e.to_string())?;
    Ok("Database initialized".to_string())
}

#[tauri::command]
pub fn add_history_item(
    app: AppHandle,
    title: String,
    resolution: String,
    size: String,
    file_path: String,
) -> Result<HistoryItem, String> {
    let conn = get_db_connection(&app)?;
    
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO downloads (title, resolution, size, file_path, timestamp) 
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![title, resolution, size, file_path, timestamp],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(HistoryItem {
        id,
        title,
        resolution,
        size,
        file_path,
        timestamp,
    })
}

#[tauri::command]
pub fn get_history_items(app: AppHandle) -> Result<Vec<HistoryItem>, String> {
    let conn = get_db_connection(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, title, resolution, size, file_path, timestamp FROM downloads ORDER BY timestamp DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(HistoryItem {
            id: row.get(0)?,
            title: row.get(1)?,
            resolution: row.get(2)?,
            size: row.get(3)?,
            file_path: row.get(4)?,
            timestamp: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| e.to_string())?);
    }

    Ok(items)
}

#[tauri::command]
pub fn delete_history_item(app: AppHandle, id: i64) -> Result<String, String> {
    let conn = get_db_connection(&app)?;
    conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok("deleted".to_string())
}
