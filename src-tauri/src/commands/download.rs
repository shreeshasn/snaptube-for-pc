use tauri::Window;
use reqwest::Client;
use std::fs::File;
use std::io::Write;
use futures_util::StreamExt;
use serde::Serialize;

#[derive(Clone, Serialize)]
struct ProgressPayload {
    percentage: f64,
    speed_kbps: f64,
    downloaded_bytes: u64,
    total_bytes: u64,
    status: String,
}

#[tauri::command]
pub async fn resolve_video(url: String) -> Result<serde_json::Value, String> {
    let client = Client::new();
    
    // Thin relay API endpoint (dev fallback to localhost:3000)
    let relay_url = "http://localhost:3000/resolve";
    
    let response = client.post(relay_url)
        .header("x-snaptube-signature", "SnapTube-Desktop-Client-Token-2026")
        .json(&serde_json::json!({ "url": url }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach relay server: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("Relay error ({}): {}", status, err_text));
    }

    let data = response.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(data)
}

#[tauri::command]
pub async fn download_file(
    window: Window,
    url: String,
    path: String,
) -> Result<String, String> {
    let client = Client::new();
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Server returned status: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();

    let mut downloaded: u64 = 0;
    let start_time = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() >= 100 || downloaded == total_size {
            let duration = now.duration_since(start_time).as_secs_f64();
            let speed = if duration > 0.0 {
                (downloaded as f64) / 1024.0 / duration
            } else {
                0.0
            };
            let percentage = if total_size > 0 {
                (downloaded as f64) / (total_size as f64) * 100.0
            } else {
                0.0
            };

            let payload = ProgressPayload {
                percentage,
                speed_kbps: speed,
                downloaded_bytes: downloaded,
                total_bytes: total_size,
                status: "downloading".to_string(),
            };

            use tauri::Emitter;
            window.emit("download-progress", payload).map_err(|e| e.to_string())?;
            last_emit = now;
        }
    }

    // Finished download event
    let duration = std::time::Instant::now().duration_since(start_time).as_secs_f64();
    let speed = if duration > 0.0 {
        (downloaded as f64) / 1024.0 / duration
    } else {
        0.0
    };
    use tauri::Emitter;
    window.emit("download-progress", ProgressPayload {
        percentage: 100.0,
        speed_kbps: speed,
        downloaded_bytes: downloaded,
        total_bytes: total_size,
        status: "completed".to_string(),
    }).map_err(|e| e.to_string())?;

    Ok("success".to_string())
}
