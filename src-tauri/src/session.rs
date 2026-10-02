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
//!
//! 结构上把「协议处理」(`do_info` / `do_pull` / `do_push`) 与 Tauri 解耦，
//! 只依赖 `Arc<Mutex<Inner>>`，因此可以直接被单元测试驱动。

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
    /// 本机所有可用的局域网 IPv4（多网卡时前端可让用户切换）
    pub ip_candidates: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub running: bool,
    pub info: Option<SessionInfo>,
    /// 最近一次收到接入方推送的时间（epoch 毫秒）
    pub last_push_at: Option<u64>,
    /// 最近一次被接入方拉取的时间（epoch 毫秒）
    pub last_pull_at: Option<u64>,
}

/// 收到接入方推送时的回调（Tauri 下是向前端发事件）
type PushSink = Box<dyn Fn(Value) + Send + Sync>;

struct Inner {
    info: Option<SessionInfo>,
    key: Vec<u8>,
    /// 主机对外共享的那一份行程
    trip: Value,
    last_push_at: Option<u64>,
    last_pull_at: Option<u64>,
    on_push: Option<PushSink>,
}

impl Inner {
    fn empty() -> Self {
        Self {
            info: None,
            key: Vec::new(),
            trip: Value::Null,
            last_push_at: None,
            last_pull_at: None,
            on_push: None,
        }
    }
}

type Shared = Arc<Mutex<Inner>>;

/// 会话状态：既被 Tauri 命令访问，也被 axum handler 访问
pub struct SessionState {
    inner: Shared,
    server: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
}

impl SessionState {
    pub fn new(app: AppHandle) -> Self {
        let shared = Arc::new(Mutex::new(Inner::empty()));
        {
            let mut g = shared.lock().unwrap();
            let handle = app.clone();
            g.on_push = Some(Box::new(move |trip| {
                let _ = handle.emit("session://pushed", trip);
            }));
        }
        Self {
            inner: shared,
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

/// 枚举本机在局域网里可用的 IPv4，按「更像家庭/办公局域网」排序。
///
/// 不能只用「UDP connect 看出口地址」那一招：装了代理软件（Clash 等）开了 TUN 模式时，
/// 默认路由会指向隧道网卡（形如 198.18.0.1），手机根本连不上。
/// 所以这里枚举所有网卡，排除回环、链路本地(169.254/16)、隧道基准网段(198.18/15)，
/// 再按私有网段优先级排序。返回全部候选，前端可在多个网卡时让用户切换。
fn lan_ips() -> Vec<String> {
    use if_addrs::{IfAddr, get_if_addrs};
    use std::net::Ipv4Addr;

    fn rank(ip: &Ipv4Addr) -> u8 {
        let o = ip.octets();
        if o[0] == 192 && o[1] == 168 {
            0
        } else if o[0] == 10 {
            1
        } else if o[0] == 172 && (16..=31).contains(&o[1]) {
            2
        } else {
            3
        }
    }

    let mut private: Vec<Ipv4Addr> = Vec::new();
    let mut others: Vec<Ipv4Addr> = Vec::new();
    if let Ok(ifaces) = get_if_addrs() {
        for iface in ifaces {
            let ip = match iface.addr {
                IfAddr::V4(v4) => v4.ip,
                IfAddr::V6(_) => continue,
            };
            if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() {
                continue;
            }
            let o = ip.octets();
            // 代理软件 TUN 网卡常用的基准测试网段，手机到不了
            if o[0] == 198 && (o[1] == 18 || o[1] == 19) {
                continue;
            }
            if ip.is_private() {
                private.push(ip);
            } else {
                others.push(ip);
            }
        }
    }
    private.sort_by_key(rank);
    others.sort_by_key(rank);
    private
        .into_iter()
        .chain(others)
        .map(|ip| ip.to_string())
        .collect()
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

fn current_key(inner: &Shared) -> Result<Vec<u8>, (StatusCode, String)> {
    let key = inner.lock().unwrap().key.clone();
    if key.is_empty() {
        return Err((StatusCode::CONFLICT, "会话未开启".to_string()));
    }
    Ok(key)
}

fn open_json(inner: &Shared, body: &[u8]) -> Result<Value, (StatusCode, String)> {
    let key = current_key(inner)?;
    let plain = decrypt(&key, body).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    serde_json::from_slice(&plain)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("密文解出来不是合法 JSON：{e}")))
}

fn seal_json(inner: &Shared, value: &Value) -> Result<Vec<u8>, (StatusCode, String)> {
    let key = current_key(inner)?;
    let plain =
        serde_json::to_vec(value).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    encrypt(&key, &plain).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

// ---------- 协议处理（与 HTTP / Tauri 解耦，可直接单测） ----------

fn do_info(inner: &Shared) -> Result<Value, (StatusCode, String)> {
    let g = inner.lock().unwrap();
    let Some(info) = &g.info else {
        return Err((StatusCode::CONFLICT, "会话未开启".to_string()));
    };
    Ok(json!({
        "app": "knapsack",
        "protocol": PROTOCOL,
        "sessionId": info.session_id,
        "tripName": info.trip_name,
    }))
}

/// 接入方取走主机这份行程
fn do_pull(inner: &Shared, body: &[u8]) -> Result<Vec<u8>, (StatusCode, String)> {
    open_json(inner, body)?; // 密钥不对直接拒
    let trip = {
        let mut g = inner.lock().unwrap();
        g.last_pull_at = Some(now_ms());
        g.trip.clone()
    };
    seal_json(inner, &trip)
}

/// 接入方把它的行程推给主机；主机通知本机前端去落库
fn do_push(inner: &Shared, body: &[u8]) -> Result<Vec<u8>, (StatusCode, String)> {
    let payload = open_json(inner, body)?;
    let trip = payload
        .get("trip")
        .cloned()
        .ok_or((StatusCode::BAD_REQUEST, "报文缺少 trip 字段".to_string()))?;
    if !trip.is_object() {
        return Err((StatusCode::BAD_REQUEST, "trip 不是对象".to_string()));
    }
    let sink = {
        let mut g = inner.lock().unwrap();
        g.last_push_at = Some(now_ms());
        g.on_push.take()
    };
    // 回调取出后立刻放回，避免锁着执行外部逻辑
    if let Some(f) = &sink {
        f(trip.clone());
    }
    {
        let mut g = inner.lock().unwrap();
        if g.on_push.is_none() {
            g.on_push = sink;
        }
    }
    seal_json(inner, &json!({ "ok": true }))
}

// ---------- HTTP ----------

fn respond(result: Result<Vec<u8>, (StatusCode, String)>) -> axum::response::Response {
    match result {
        Ok(ct) => ct.into_response(),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

async fn handle_info(State(inner): State<Shared>) -> impl IntoResponse {
    match do_info(&inner) {
        Ok(v) => Json(v).into_response(),
        Err((code, msg)) => (code, msg).into_response(),
    }
}

async fn handle_pull(State(inner): State<Shared>, body: Bytes) -> impl IntoResponse {
    respond(do_pull(&inner, &body))
}

async fn handle_push(State(inner): State<Shared>, body: Bytes) -> impl IntoResponse {
    respond(do_push(&inner, &body))
}

fn build_router(inner: Shared) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    Router::new()
        .route("/info", get(handle_info))
        .route("/pull", post(handle_pull))
        .route("/push", post(handle_push))
        .layer(cors)
        .with_state(inner)
}

// ---------- Tauri commands ----------

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

/// 开启会话：生成密钥、绑定随机端口、起服务。
#[tauri::command]
pub async fn session_start(app: AppHandle, trip: Value) -> Result<SessionInfo, String> {
    let state = app.state::<SessionState>();
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

    let listener =
        std::net::TcpListener::bind("0.0.0.0:0").map_err(|e| format!("端口绑定失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读端口失败：{e}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("设置非阻塞失败：{e}"))?;

    let ip_candidates = lan_ips();
    let ip = ip_candidates
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let info = SessionInfo {
        ip,
        port,
        key_b64: URL_SAFE_NO_PAD.encode(&key),
        session_id,
        trip_id,
        trip_name,
        ip_candidates,
    };

    {
        let mut g = state.inner.lock().unwrap();
        g.info = Some(info.clone());
        g.key = key;
        g.trip = trip;
        g.last_push_at = None;
        g.last_pull_at = None;
    }

    let router = build_router(state.inner.clone());
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

/// 关闭会话：停止监听并清空密钥与行程副本。
#[tauri::command]
pub async fn session_stop(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SessionState>();
    stop_server(&state);
    log::info!("局域网会话已关闭");
    Ok(())
}

#[tauri::command]
pub async fn session_status(app: AppHandle) -> Result<SessionStatus, String> {
    let state = app.state::<SessionState>();
    let g = state.inner.lock().unwrap();
    Ok(SessionStatus {
        running: g.info.is_some(),
        info: g.info.clone(),
        last_push_at: g.last_push_at,
        last_pull_at: g.last_pull_at,
    })
}

/// 主机本地改动后同步给服务端的内存副本，保证接入方拉取到的是最新版。
#[tauri::command]
pub async fn session_update_trip(app: AppHandle, trip: Value) -> Result<(), String> {
    let state = app.state::<SessionState>();
    let mut g = state.inner.lock().unwrap();
    let Some(info) = g.info.as_ref() else {
        return Err("会话未开启".to_string());
    };
    let id = trip.get("id").and_then(Value::as_str).unwrap_or_default();
    if id != info.trip_id {
        return Err("会话绑定的是另一份行程，已忽略".to_string());
    }
    let name = trip.get("name").and_then(Value::as_str).map(str::to_string);
    if let Some(n) = name {
        if let Some(info) = g.info.as_mut() {
            info.trip_name = n;
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

    fn test_state() -> (Shared, Arc<Mutex<Vec<Value>>>) {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink_target = received.clone();
        let shared = Arc::new(Mutex::new(Inner::empty()));
        {
            let mut g = shared.lock().unwrap();
            g.on_push = Some(Box::new(move |trip| sink_target.lock().unwrap().push(trip)));
        }
        (shared, received)
    }

    fn start(shared: &Shared, trip: Value) -> Vec<u8> {
        let key: Vec<u8> = (0u8..32).collect();
        let mut g = shared.lock().unwrap();
        g.key = key.clone();
        g.trip = trip.clone();
        g.info = Some(SessionInfo {
            ip: "127.0.0.1".into(),
            port: 1234,
            key_b64: URL_SAFE_NO_PAD.encode(&key),
            session_id: "abc123".into(),
            trip_id: trip.get("id").and_then(Value::as_str).unwrap_or("").into(),
            trip_name: trip.get("name").and_then(Value::as_str).unwrap_or("").into(),
            ip_candidates: vec!["127.0.0.1".into()],
        });
        key
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

    /// 候选地址里不能出现手机连不上的地址：
    /// 回环、链路本地(169.254/16)、代理软件 TUN 用的 198.18.0.0/15。
    #[test]
    fn lan_ips_excludes_unreachable_ranges() {
        for s in lan_ips() {
            let ip: std::net::Ipv4Addr = s.parse().expect("必须是合法 IPv4");
            assert!(!ip.is_loopback(), "不该出现回环地址 {ip}");
            assert!(!ip.is_link_local(), "不该出现链路本地地址 {ip}");
            let o = ip.octets();
            assert!(
                !(o[0] == 198 && (o[1] == 18 || o[1] == 19)),
                "不该出现 TUN 基准网段 {ip}"
            );
        }
    }

    fn seal_with(key: &[u8], v: &Value) -> Vec<u8> {
        encrypt(key, &serde_json::to_vec(v).unwrap()).unwrap()
    }

    #[test]
    fn pull_returns_host_trip_and_updates_timestamp() {
        let (shared, _rx) = test_state();
        let trip = json!({ "id": "t1", "name": "杭州行" });
        let key = start(&shared, trip.clone());

        let body = seal_with(&key, &json!({}));
        let ct = do_pull(&shared, &body).unwrap();
        let got: Value = serde_json::from_slice(&decrypt(&key, &ct).unwrap()).unwrap();
        assert_eq!(got, trip);
        assert!(shared.lock().unwrap().last_pull_at.is_some());
    }

    #[test]
    fn pull_rejects_wrong_key() {
        let (shared, _rx) = test_state();
        start(&shared, json!({ "id": "t1", "name": "杭州行" }));

        let bad = seal_with(&[9u8; 32], &json!({}));
        let err = do_pull(&shared, &bad).unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn push_surfaces_trip_to_host_sink() {
        let (shared, rx) = test_state();
        let key = start(&shared, json!({ "id": "t1", "name": "杭州行" }));

        let incoming = json!({ "id": "t1", "name": "杭州行（手机改过）" });
        let body = seal_with(&key, &json!({ "trip": incoming }));
        let ct = do_push(&shared, &body).unwrap();

        let ack: Value = serde_json::from_slice(&decrypt(&key, &ct).unwrap()).unwrap();
        assert_eq!(ack, json!({ "ok": true }));
        assert_eq!(*rx.lock().unwrap(), vec![incoming]);
        assert!(shared.lock().unwrap().last_push_at.is_some());
    }

    #[test]
    fn push_rejects_payload_without_trip() {
        let (shared, rx) = test_state();
        let key = start(&shared, json!({ "id": "t1", "name": "杭州行" }));

        let body = seal_with(&key, &json!({ "nope": 1 }));
        let err = do_push(&shared, &body).unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(rx.lock().unwrap().is_empty());
    }

    #[test]
    fn endpoints_conflict_when_session_not_started() {
        let (shared, _rx) = test_state();
        assert_eq!(do_info(&shared).unwrap_err().0, StatusCode::CONFLICT);
        assert_eq!(
            do_pull(&shared, &[0u8; 40]).unwrap_err().0,
            StatusCode::CONFLICT
        );
    }

    #[test]
    fn info_exposes_no_secret() {
        let (shared, _rx) = test_state();
        let key = start(&shared, json!({ "id": "t1", "name": "杭州行" }));
        let v = do_info(&shared).unwrap();
        assert_eq!(v["app"], "knapsack");
        assert_eq!(v["protocol"], PROTOCOL);
        let text = v.to_string();
        // 明文握手信息里绝不能出现密钥
        assert!(!text.contains(&URL_SAFE_NO_PAD.encode(&key)));
    }

    // ---------- 真 socket 集成测试：覆盖 axum 路由 / body 提取 / CORS ----------

    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    /// 极简 HTTP/1.1 客户端：只处理 Content-Length 响应，够用即可
    fn raw_request(addr: SocketAddr, method: &str, path: &str, body: &[u8]) -> (u16, Vec<u8>, String) {
        let mut s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        s.write_all(head.as_bytes()).unwrap();
        s.write_all(body).unwrap();
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).unwrap();

        let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head_text = String::from_utf8_lossy(&buf[..split]).to_string();
        let status: u16 = head_text
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        (status, buf[split + 4..].to_vec(), head_text)
    }

    fn serve(router: Router) -> SocketAddr {
        let (tx, rx) = std::sync::mpsc::channel();
        tauri::async_runtime::spawn(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(listener.local_addr().unwrap()).unwrap();
            let _ = axum::serve(listener, router).await;
        });
        rx.recv_timeout(Duration::from_secs(5)).unwrap()
    }

    /// 手机端那一整套动作，在真实 HTTP 上跑一遍：
    /// GET /info 握手 → POST /pull 取行程 → POST /push 回推 → 错误密钥被拒
    #[test]
    fn http_end_to_end_over_tcp() {
        let (shared, rx) = test_state();
        let trip = json!({ "id": "t1", "name": "杭州行" });
        let key = start(&shared, trip.clone());
        let addr = serve(build_router(shared.clone()));

        // 1) 明文握手，且带 CORS 头（手机页面是 https://localhost，属跨域）
        let (status, body, head) = raw_request(addr, "GET", "/info", &[]);
        assert_eq!(status, 200);
        assert!(head.to_lowercase().contains("access-control-allow-origin"));
        let info: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(info["app"], "knapsack");
        assert_eq!(info["tripName"], "杭州行");

        // 2) 拉取
        let (status, body, _) = raw_request(addr, "POST", "/pull", &seal_with(&key, &json!({})));
        assert_eq!(status, 200);
        let pulled: Value = serde_json::from_slice(&decrypt(&key, &body).unwrap()).unwrap();
        assert_eq!(pulled, trip);

        // 3) 回推，主机侧应收到
        let incoming = json!({ "id": "t1", "name": "杭州行（手机改过）" });
        let (status, body, _) = raw_request(
            addr,
            "POST",
            "/push",
            &seal_with(&key, &json!({ "trip": incoming })),
        );
        assert_eq!(status, 200);
        let ack: Value = serde_json::from_slice(&decrypt(&key, &body).unwrap()).unwrap();
        assert_eq!(ack, json!({ "ok": true }));
        // 事件回调是同步的，这里应立刻能看到
        assert_eq!(rx.lock().unwrap().len(), 1);

        // 4) 错误密钥 → 400，且不泄露原因之外的信息
        let (status, _, _) = raw_request(addr, "POST", "/pull", &seal_with(&[7u8; 32], &json!({})));
        assert_eq!(status, 400);

        // 5) 未知路径 → 404
        let (status, _, _) = raw_request(addr, "GET", "/nope", &[]);
        assert_eq!(status, 404);
    }

    /// 开发联调用：在局域网里起一个真实主机并挂住 10 分钟，
    /// 方便手机端走真实网络路径验证「扫码 → 拉取 → 回推」。
    ///
    /// 运行：cargo test --lib dev_host -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dev_host() {
        let (shared, rx) = test_state();
        let trip = json!({
            "format": "trip.v1",
            "id": "devtrip01",
            "name": "局域网联调",
            "startDate": "2026-10-02",
            "endDate": "2026-10-03",
            "destType": "city",
            "destCity": "杭州",
            "totalBudgetFen": 0,
            "categoryBudgetsFen": {},
            "members": [],
            "days": [],
            "packing": [],
            "notes": "",
            "enabledModules": { "expenses": true, "notes": true }
        });
        let key = start(&shared, trip);

        let (tx, addr_rx) = std::sync::mpsc::channel();
        tauri::async_runtime::spawn(async move {
            let l = tokio::net::TcpListener::bind("0.0.0.0:0").await.unwrap();
            tx.send(l.local_addr().unwrap()).unwrap();
            let _ = axum::serve(l, build_router(shared)).await;
        });
        let port = addr_rx.recv_timeout(Duration::from_secs(5)).unwrap().port();
        let candidates = lan_ips();
        println!("\n===== 行囊局域网会话 · 开发主机已启动 10 分钟 =====");
        println!("候选地址: {:?}（第一个是首选；手机连不上就换下一个）", candidates);
        for ip in &candidates {
            println!("会话码({ip}) : {PROTOCOL}?ip={ip}&port={port}&k={}&s=dev001", URL_SAFE_NO_PAD.encode(&key));
        }
        println!("（手机端「局域网会话」→ 粘贴会话码 → 连接）");
        println!("================================================\n");

        std::thread::sleep(Duration::from_secs(600));
        println!("dev_host 结束，收到推送 {} 次", rx.lock().unwrap().len());
    }
}
