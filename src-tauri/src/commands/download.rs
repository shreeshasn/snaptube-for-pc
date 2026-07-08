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

// Utility to format bytes to human-readable size
fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "Unknown Size".to_string();
    }
    let k: f64 = 1024.0;
    let sizes = ["Bytes", "KB", "MB", "GB"];
    let bytes_f = bytes as f64;
    let mut i = (bytes_f.ln() / k.ln()).floor() as usize;
    if i >= sizes.len() {
        i = sizes.len() - 1;
    }
    let val = bytes_f / k.powi(i as i32);
    format!("{:.1} {}", val, sizes[i])
}

// Utility function to extract videoId from YouTube URLs
fn extract_video_id(url: &str) -> Option<String> {
    if let Some(pos) = url.find("v=") {
        let start = pos + 2;
        let id_part = &url[start..];
        let end = id_part.find('&').unwrap_or(id_part.len());
        let id = &id_part[..end];
        if id.len() == 11 {
            return Some(id.to_string());
        }
    }
    
    if url.contains("youtu.be/") {
        if let Some(pos) = url.find("youtu.be/") {
            let start = pos + 9;
            let id_part = &url[start..];
            let end = id_part.find('?').unwrap_or(id_part.len());
            let id = &id_part[..end];
            if id.len() == 11 {
                return Some(id.to_string());
            }
        }
    }

    for pattern in &["/embed/", "/v/", "/shorts/"] {
        if let Some(pos) = url.find(pattern) {
            let start = pos + pattern.len();
            let id_part = &url[start..];
            let end = id_part.find('?').unwrap_or(id_part.len());
            let id = &id_part[..end];
            if id.len() == 11 {
                return Some(id.to_string());
            }
        }
    }
    
    None
}

#[tauri::command]
pub async fn resolve_video(
    url: String,
    provider: String,
    api_key: String,
    relay_url: String,
    rapid_host: String,
) -> Result<serde_json::Value, String> {
    let client = Client::new();
    
    if provider == "direct" {
        if api_key.is_empty() {
            return Err("API Key is required for Direct API Mode.".to_string());
        }

        let video_id = extract_video_id(&url)
            .ok_or_else(|| "Invalid YouTube URL format.".to_string())?;

        let info_endpoint = format!("https://{}/get-video-info/{}", rapid_host, video_id);
        let quality_endpoint = format!("https://{}/get_available_quality/{}", rapid_host, video_id);

        // Fetch info
        let info_response = client.get(&info_endpoint)
            .header("x-rapidapi-key", &api_key)
            .header("x-rapidapi-host", &rapid_host)
            .send()
            .await
            .map_err(|e| format!("Failed to call RapidAPI Video Info: {}", e))?;

        if !info_response.status().is_success() {
            let status = info_response.status();
            let err_text = info_response.text().await.unwrap_or_default();
            return Err(format!("RapidAPI Video Info error ({}): {}", status, err_text));
        }

        let info_data: serde_json::Value = info_response.json()
            .await
            .map_err(|e| format!("Failed to parse RapidAPI Video Info response: {}", e))?;

        // Fetch quality
        let quality_response = client.get(&quality_endpoint)
            .header("x-rapidapi-key", &api_key)
            .header("x-rapidapi-host", &rapid_host)
            .send()
            .await
            .map_err(|e| format!("Failed to call RapidAPI Quality Options: {}", e))?;

        if !quality_response.status().is_success() {
            let status = quality_response.status();
            let err_text = quality_response.text().await.unwrap_or_default();
            return Err(format!("RapidAPI Quality Options error ({}): {}", status, err_text));
        }

        let quality_data: serde_json::Value = quality_response.json()
            .await
            .map_err(|e| format!("Failed to parse RapidAPI Quality Options response: {}", e))?;

        // Map thumbnail
        let mut thumbnail = "https://placehold.co/640x360".to_string();
        if let Some(thumb_arr) = info_data["thumbnail"].as_array() {
            if !thumb_arr.is_empty() {
                if let Some(url_str) = thumb_arr[thumb_arr.len() - 1]["url"].as_str() {
                    thumbnail = url_str.to_string();
                }
            }
        }

        // Format duration
        let mut duration = "0:00".to_string();
        if let Some(len_str) = info_data["lengthSeconds"].as_str() {
            if let Ok(seconds) = len_str.parse::<u64>() {
                let m = seconds / 60;
                let s = seconds % 60;
                duration = format!("{}:{:02}", m, s);
            }
        }

        let mut mapped_data = serde_json::json!({
            "title": info_data["title"].as_str().unwrap_or("YouTube Video"),
            "thumbnail": thumbnail,
            "duration": duration,
            "author": info_data["ownerChannelName"].as_str()
                .or_else(|| info_data["author"].as_str())
                .unwrap_or("YouTube Creator"),
            "formats": []
        });

        let mut mapped_formats = Vec::new();

        if let Some(quality_arr) = quality_data.as_array() {
            // Group/deduplicate and filter formats (highest bitrate for unique quality levels)
            use std::collections::HashSet;
            let mut seen_qualities = HashSet::new();
            
            // Sort by bitrate descending
            let mut sorted_formats = quality_arr.clone();
            sorted_formats.sort_by(|a, b| {
                let br_a = a["bitrate"].as_u64().or_else(|| a["bitrate"].as_str().and_then(|s| s.parse::<u64>().ok())).unwrap_or(0);
                let br_b = b["bitrate"].as_u64().or_else(|| b["bitrate"].as_str().and_then(|s| s.parse::<u64>().ok())).unwrap_or(0);
                br_b.cmp(&br_a)
            });

            for f in sorted_formats {
                let f_type = f["type"].as_str().unwrap_or("");
                let quality_label = f["quality"].as_str().unwrap_or("");
                
                let f_id = if let Some(s) = f["id"].as_str() {
                    s.to_string()
                } else if let Some(n) = f["id"].as_u64() {
                    n.to_string()
                } else if let Some(n) = f["id"].as_i64() {
                    n.to_string()
                } else {
                    String::new()
                };

                if f_id.is_empty() {
                    continue;
                }

                if f_type == "audio" {
                    if !seen_qualities.contains("audio") {
                        seen_qualities.insert("audio".to_string());
                        
                        let mime = f["mime"].as_str().unwrap_or("");
                        let extension = if mime.contains("opus") { "opus" } else { "m4a" };
                        let label = format!("Audio ({})", extension.to_uppercase());
                        let size_bytes = f["size"].as_u64().unwrap_or(0);
                        
                        let download_url = format!(
                            "https://{}/download_audio/{}?quality={}&apiKey={}",
                            rapid_host, video_id, f_id, api_key
                        );

                        mapped_formats.push(serde_json::json!({
                            "quality": label,
                            "extension": extension,
                            "size": format_bytes(size_bytes),
                            "url": download_url
                        }));
                    }
                } else if f_type == "video" {
                    let key = quality_label.to_string();
                    if !key.is_empty() && !seen_qualities.contains(&key) {
                        seen_qualities.insert(key.clone());

                        let mime = f["mime"].as_str().unwrap_or("");
                        let extension = if mime.contains("webm") { "webm" } else { "mp4" };
                        let label = format!("{} ({})", key, extension.to_uppercase());
                        let size_bytes = f["size"].as_u64().unwrap_or(0);

                        let download_url = format!(
                            "https://{}/download_video/{}?quality={}&apiKey={}",
                            rapid_host, video_id, f_id, api_key
                        );

                        mapped_formats.push(serde_json::json!({
                            "quality": label,
                            "extension": extension,
                            "size": format_bytes(size_bytes),
                            "url": download_url
                        }));
                    }
                }
            }
        }

        mapped_data["formats"] = serde_json::Value::Array(mapped_formats);
        Ok(mapped_data)
    } else {
        // Relay mode
        let endpoint = if relay_url.is_empty() {
            "http://localhost:3000/resolve"
        } else {
            &relay_url
        };
        
        let response = client.post(endpoint)
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
}

#[tauri::command]
pub async fn download_file(
    window: Window,
    url: String,
    path: String,
) -> Result<String, String> {
    let client = Client::new();
    let mut download_url = url.clone();
    
    if url.contains("apiKey=") {
        // Extract apiKey from query param
        let mut api_key = String::new();
        if let Some(key_pos) = url.find("apiKey=") {
            let start = key_pos + 7;
            let rest = &url[start..];
            let end = rest.find('&').unwrap_or(rest.len());
            api_key = rest[..end].to_string();
        }

        if api_key.is_empty() {
            return Err("Missing apiKey query parameter for RapidAPI download.".to_string());
        }

        // Extract host name from the URL dynamically
        let mut rapid_host = String::new();
        if let Some(host_start) = url.find("://") {
            let rest = &url[(host_start + 3)..];
            let end = rest.find('/').unwrap_or(rest.len());
            rapid_host = rest[..end].to_string();
        }

        if rapid_host.is_empty() {
            return Err("Could not parse host name from download URL.".to_string());
        }

        // Clean up the URL by removing apiKey from the query string
        let clean_url = if let Some(pos) = url.find("&apiKey=") {
            url[..pos].to_string()
        } else if let Some(pos) = url.find("?apiKey=") {
            url[..pos].to_string()
        } else {
            url.clone()
        };

        let api_res = client.get(&clean_url)
            .header("x-rapidapi-key", &api_key)
            .header("x-rapidapi-host", &rapid_host)
            .send()
            .await
            .map_err(|e| format!("Failed to call RapidAPI download endpoint: {}", e))?;

        if !api_res.status().is_success() {
            let status = api_res.status();
            let err_text = api_res.text().await.unwrap_or_default();
            return Err(format!("RapidAPI download endpoint returned error ({}): {}", status, err_text));
        }

        let json_res: serde_json::Value = api_res.json()
            .await
            .map_err(|e| format!("Failed to parse RapidAPI download JSON response: {}", e))?;

        if let Some(file_url) = json_res["file"].as_str() {
            download_url = file_url.to_string();
        } else {
            return Err("RapidAPI download response did not contain 'file' URL.".to_string());
        }
    }

    let response = client.get(&download_url)
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
