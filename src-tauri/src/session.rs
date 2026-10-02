//! 局域网会话 · 主机端（阶段12）
//!
//! 主机（Windows 桌面版）在局域网内起一个**临时** HTTP 服务，手机扫码拿到
//! `{ip, port, 32 字节密钥}` 后接入，双向同步同一份行程。
//!
//! 安全模型：
//! - 传输层是明文 HTTP（安卓 WebView 里没法低成本用自签名证书做 HTTPS）。
//! - 因此所有请求/响应体都套一层 AES-256-GCM 信封：`nonce(12B) || 密文 || tag(16B)`。
//! - 密钥随机生成、只出现在二维码里，不走网络明文传输；局域网内的被动嗅探者
//!   只能看到密文，且没有密钥无法伪造或篡改（GCM 自带完整性校验）。
//! - 会话关闭即停止监听、清空内存中的行程副本与密钥。

use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tower_http::cors::{Any, CorsLayer};

/// 二维码载荷协议标识，格式：
/// `knapsack-session/1?ip=..&port=..&k=<base64url 密钥>&s=<会话号>`
pub const PROTOCOL: &str = "knapsack-session/1";

const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const KEY_LEN: usize = 32;

/// 主机推送给前端的会话信息（含密钥，仅在本机前端与二维码里出现）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub ip: String,
    pub port: u16,
    pub key_b64: String,
    pub session_id: String,
    pub trip_id: String,
    pub trip_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub running: bool,
    pub info: Option<SessionInfo>,
    /// 最近一次收到手机推送的时间（epoch 毫秒）
    pub last_push_at: Option<u64>,
    /// 最近一次被手机拉取的时间（epoch 毫秒）
    pub last_pull_at: Option<u64>,
}

struct Inner {
    info: Option<SessionInfo>,
    key: Vec<u8>,
    /// 主机对外共享的那一份行程
    trip: Value,
    last_push_at: Option<u64>,
    last_pull_at: Option<u64>,
}

/// 共享会话状态。以 Arc 包住，既能被 Tauri 命令访问，也能被 axum handler 访问。
#[derive(Clone)]
pub struct SessionState {
    inner: Arc<Mutex<Inner>>,
    app: AppHandle,
    server: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
}

impl SessionState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                info: None,
                key: Vec::new(),
                trip: Value::Null,
                last_push_at: None,
                last_pull_at: None,
            })),
            app,
            server: Arc::new(Mutex::new(None)),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 取本机在局域网里的 IPv4。
/// 用一个不会真正发包的 UDP connect 让路由表告诉我们出口地址，离线也能用。
fn lan_ip() -> String {
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

// ---------- 信封加密 ----------

fn encrypt(key: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("密钥长度不对：{e}"))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain)
        .map_err(|e| format!("加密失败：{e}"))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt(key: &[u8], msg: &[u8]) -> Result<Vec<u8>, String> {
    if msg.len() < NONCE_LEN + TAG_LEN {
        return Err("报文过短，不是合法的信封".to_string());
    }
    let (nonce_bytes, ct) = msg.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("密钥长度不对：{e}"))?;
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|_| "解密失败：密钥不匹配或报文被篡改".to_string())
}

fn decrypt_json(state: &SessionState, body: &Bytes) -> Result<Value, (StatusCode, String)> {
    let key = {
        let g = state.inner.lock().unwrap();
        g.key.clone()
    };
    if key.is_empty() {
        return Err((StatusCode::CONFLICT, "会话未开启".to_string()));
    }
    let plain = decrypt(&key, body).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    serde_json::from_slice(&plain)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("密文解出来不是合法 JSON：{e}")))
}

fn encrypt_json(state: &SessionState, value: &Value) -> Result<Vec<u8>, (StatusCode, String)> {
    let key = {
        let g = state.inner.lock().unwrap();
        g.key.clone()
    };
    let plain = serde_json::to_vec(value)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    encrypt(&key, &plain).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

// ---------- HTTP handlers ----------

/// `GET /info`：明文握手信息，不含任何秘密，用来让接入方确认「对面确实是行囊主机」。
async fn handle_info(State(state): State<SessionState>) -> impl IntoResponse {
    let g = state.inner.lock().unwrap();
    match &g.info {
        Some(info) => Json(json!({
            "app": "knapsack",
            "protocol": PROTOCOL,
            "sessionId": info.session_id,
            "tripName": info.trip_name,
        }))
        .into_response(),
        None => (StatusCode::CONFLICT, "会话未开启").into_response(),
    }
}

/// `POST /pull`：接入方取走主机这份行程。
async fn handle_pull(State(state): State<SessionState>, body: Bytes) -> impl IntoResponse {
    if let Err(e) = decrypt_json(&state, &body) {
        return e.into_response();
    }
    let payload = {
        let mut g = state.inner.lock().unwrap();
        g.last_pull_at = Some(now_ms());
        g.trip.clone()
    };
    match encrypt_json(&state, &payload) {
        Ok(ct) => ct.into_response(),
        Err(e) => e.into_response(),
    }
}

/// `POST /push`：接入方把它的行程推给主机；主机先记下来并通知本机前端应用。
async fn handle_push(State(state): State<SessionState>, body: Bytes) -> impl IntoResponse {
    let payload = match decrypt_json(&state, &body) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let Some(trip) = payload.get("trip").cloned() else {
        return (StatusCode::BAD_REQUEST, "报文缺少 trip 字段").into_response();
    };
    if !trip.is_object() {
        return (StatusCode::BAD_REQUEST, "trip 不是对象").into_response();
    }

    {
        let mut g = state.inner.lock().unwrap();
        g.last_push_at = Some(now_ms());
    }
    // 交给本机前端决定怎么落库（覆盖 + 进撤销栈），主机端不直接写 IndexedDB
    let _ = state.app.emit("session://pushed", trip);

    match encrypt_json(&state, &json!({ "ok": true })) {
        Ok(ct) => ct.into_response(),
        Err(e) => e.into_response(),
    }
}

fn build_router(state: SessionState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    Router::new()
        .route("/info", get(handle_info))
        .route("/pull", post(handle_pull))
        .route("/push", post(handle_push))
        .layer(cors)
        .with_state(state)
}

// ---------- Tauri commands ----------

/// 开启会话：生成密钥、绑定随机端口、起服务。
#[tauri::command]
pub async fn session_start(app: AppHandle, trip: Value) -> Result<SessionInfo, String> {
    let state = app.state::<SessionState>().inner().clone();

    // 重复开启时先关掉旧的
    stop_server(&state);

    let trip_id = trip
        .get("id")
        .and_then(Value::as_str)
        .ok_or("行程缺少 id")?
        .to_string();
    let trip_name = trip
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("未命名行程")
        .to_string();

    let mut key = vec![0u8; KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    let mut sid_bytes = [0u8; 3];
    rand::thread_rng().fill_bytes(&mut sid_bytes);
    let session_id = sid_bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();

    let listener = std::net::TcpListener::bind("0.0.0.0:0").map_err(|e| format!("端口绑定失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读端口失败：{e}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("设置非阻塞失败：{e}"))?;

    let info = SessionInfo {
        ip: lan_ip(),
        port,
        key_b64: URL_SAFE_NO_PAD.encode(&key),
        session_id,
        trip_id,
        trip_name,
    };

    {
        let mut g = state.inner.lock().unwrap();
        g.info = Some(info.clone());
        g.key = key;
        g.trip = trip;
        g.last_push_at = None;
        g.last_pull_at = None;
    }

    let router = build_router(state.clone());
    let handle = tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => {
                if let Err(e) = axum::serve(l, router).await {
                    log::error!("会话服务退出：{e}");
                }
            }
            Err(e) => log::error!("接管监听失败：{e}"),
        }
    });
    *state.server.lock().unwrap() = Some(handle);

    log::info!("局域网会话已开启 {}:{}", info.ip, info.port);
    Ok(info)
}

fn stop_server(state: &SessionState) {
    if let Some(h) = state.server.lock().unwrap().take() {
        h.abort();
    }
    let mut g = state.inner.lock().unwrap();
    g.info = None;
    g.key.clear();
    g.trip = Value::Null;
    g.last_push_at = None;
    g.last_pull_at = None;
}

/// 关闭会话：停止监听并清空密钥与行程副本。
#[tauri::command]
pub async fn session_stop(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SessionState>().inner().clone();
    stop_server(&state);
    log::info!("局域网会话已关闭");
    Ok(())
}

#[tauri::command]
pub async fn session_status(app: AppHandle) -> Result<SessionStatus, String> {
    let state = app.state::<SessionState>().inner().clone();
    let g = state.inner.lock().unwrap();
    Ok(SessionStatus {
        running: g.info.is_some(),
        info: g.info.clone(),
        last_push_at: g.last_push_at,
        last_pull_at: g.last_pull_at,
    })
}

/// 主机本地改动后同步给服务端的内存副本，保证手机拉取到的是最新版。
#[tauri::command]
pub async fn session_update_trip(app: AppHandle, trip: Value) -> Result<(), String> {
    let state = app.state::<SessionState>().inner().clone();
    let mut g = state.inner.lock().unwrap();
    if g.info.is_none() {
        return Err("会话未开启".to_string());
    }
    let id = trip.get("id").and_then(Value::as_str).unwrap_or_default();
    if id != g.info.as_ref().map(|i| i.trip_id.as_str()).unwrap_or_default() {
        return Err("会话绑定的是另一份行程，已忽略".to_string());
    }
    if let Some(name) = trip.get("name").and_then(Value::as_str) {
        if let Some(info) = g.info.as_mut() {
            info.trip_name = name.to_string();
        }
    }
    g.trip = trip;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_to_vec(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    /// 与前端 scripts/test-lansession.ts 打印的 KAT 对拍：
    /// 证明 Web Crypto 与 aes-gcm 两个实现的线格式（nonce||密文||tag）完全一致。
    #[test]
    fn kat_matches_frontend_webcrypto() {
        let key = hex_to_vec("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        let nonce = hex_to_vec("000102030405060708090a0b");
        let plain = b"knapsack-lan-session-kat";
        let ct = hex_to_vec(
            "2c6cb76bb684a170a02df6e59c9a1d1ef0bfe85add103e08f101ff3c9303ab78bb93743893f22af9",
        );
        // 前端产出的密文，Rust 必须能解出来
        let mut msg = nonce.clone();
        msg.extend_from_slice(&ct);
        assert_eq!(decrypt(&key, &msg).unwrap(), plain);
    }

    #[test]
    fn roundtrip_and_rejections() {
        let key: Vec<u8> = (0u8..32).collect();
        let plain = "行囊 局域网会话".as_bytes();
        let msg = encrypt(&key, plain).unwrap();
        assert_eq!(decrypt(&key, &msg).unwrap(), plain);

        // 密钥不对
        let other: Vec<u8> = (0u8..32).map(|i| 255 - i).collect();
        assert!(decrypt(&other, &msg).is_err());

        // 篡改一位
        let mut tampered = msg.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(decrypt(&key, &tampered).is_err());

        // 截断
        assert!(decrypt(&key, &msg[..20]).is_err());
    }
}
