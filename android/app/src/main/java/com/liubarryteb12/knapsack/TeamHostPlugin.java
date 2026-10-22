package com.liubarryteb12.knapsack;

import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import org.json.JSONObject;

/**
 * 团队汇总 · Android 前台本地 HTTP 主机插件（P0/P2）
 *
 * 设计（对应 TEAM_COLLAB_SPEC 7.2 / PLAN P0）：
 * - 原生只做监听、体积/并发限制、请求转发与响应完成；不解析业务。
 * - 链路：HTTP 请求 → nativeRequestId 排队 → notifyListeners("teamRequest")
 *   → JS handler 校验/落库（Dexie 事务成功）→ completeRequest(nativeRequestId, result)
 *   → 原生才写 HTTP 响应。事件发出 ≠ 成功（R03 修复点）。
 * - JS 缺席 / 超时 / completeRequest(fail) 一律返回非 2xx，绝不伪造成功 ACK（A17）。
 * - 会话停止即关 socket、拒绝新请求、清空 pending（A19）；不回收已完成的响应。
 * - 请求体上限 1 MiB；超出直接 413，不排队。
 * - 密钥/凭证不进日志；日志只含请求号、路径、长度、状态。
 */
@CapacitorPlugin(name = "TeamHost")
public class TeamHostPlugin extends Plugin {

    private static final String TAG = "TeamHost";
    /** 与 JS 端约定的超时；PLAN P0：handler 缺席/超时必须失败 */
    static final long HANDLER_TIMEOUT_MS = 20_000L;
    /** 请求体上限，与 TS 侧 TEAM_MAX_BODY_BYTES 一致 */
    static final int MAX_BODY_BYTES = 1024 * 1024;
    private static final int MAX_CONCURRENT = 8;

    private final AtomicBoolean running = new AtomicBoolean(false);
    // 跨线程读写：accept 线程读，主线程（stop / handleOnDestroy）写。加 volatile 保证可见性；
    // 空指针竞态本身由 acceptLoop 的局部变量快照 + catch(Throwable) 兜住（P-a 闪退修复）。
    private volatile ServerSocket serverSocket;
    private volatile Thread acceptThread;
    private volatile ExecutorService ioPool;
    private final AtomicLong seqGen = new AtomicLong(0);
    private volatile String sessionId;

    /** 等待 JS 完成的挂起请求：requestId → 状态 */
    private final Map<String, PendingRequest> pending = new ConcurrentHashMap<>();

    static final class PendingRequest {
        final String requestId;
        final String path;
        final CountDownLatch latch = new CountDownLatch(1);
        volatile int status = 500;
        volatile byte[] response = "internal error".getBytes(StandardCharsets.UTF_8);
        volatile boolean answered = false;

        PendingRequest(String requestId, String path) {
            this.requestId = requestId;
            this.path = path;
        }
    }

    // ---------- 插件方法 ----------

    @PluginMethod
    public void start(PluginCall call) {
        if (running.get()) {
            // 幂等：已在跑则返回现状。但若 JS 带来了新的 sessionId 必须回写：
            // 否则 JS 用新 sid 生成会话码、native 事件里仍带旧 sid，成员侧 AAD 校验全失败
            // （表现为"连上了但每个请求都 500"，用户反复重试会反复 stop/start，放大线程竞态）。
            String newSid = call.getString("sessionId");
            if (newSid != null && !newSid.isEmpty() && !newSid.equals(sessionId)) {
                Log.w(TAG, "start() while running: sessionId 由 JS 更新");
                sessionId = newSid;
            }
            call.resolve(currentStatus());
            return;
        }
        int port = call.getInt("port", 0);
        String sid = call.getString("sessionId");
        if (sid == null || sid.isEmpty()) {
            call.reject("缺少 sessionId");
            return;
        }
        try {
            serverSocket = new ServerSocket(port, 16, InetAddress_ANY());
            sessionId = sid;
            ioPool = Executors.newFixedThreadPool(4);
            running.set(true);
            acceptThread = new Thread(this::acceptLoop, "teamhost-accept");
            acceptThread.setDaemon(true);
            acceptThread.start();
            JSObject res = currentStatus();
            res.put("port", serverSocket.getLocalPort());
            call.resolve(res);
        } catch (IOException e) {
            Log.e(TAG, "start failed", e);
            call.reject("监听失败：" + e.getMessage());
        }
    }

    private static InetAddress InetAddress_ANY() {
        try {
            return InetAddress.getByName("0.0.0.0");
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        shutdown();
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(currentStatus());
    }

    private JSObject currentStatus() {
        JSObject o = new JSObject();
        o.put("running", running.get());
        o.put("sessionId", sessionId);
        o.put("port", serverSocket != null && !serverSocket.isClosed() ? serverSocket.getLocalPort() : 0);
        o.put("pending", pending.size());
        return o;
    }

    /**
     * JS 落库完成后回填结果。ok=true 才写 2xx；否则写 500。
     * 未知 requestId 视为已超时/已取消，忽略。
     */
    @PluginMethod
    public void completeRequest(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null) {
            call.reject("缺少 requestId");
            return;
        }
        PendingRequest p = pending.get(requestId);
        if (p == null) {
            call.reject("请求不存在或已超时：" + requestId);
            return;
        }
        Boolean ok = call.getBoolean("ok", false);
        String body = call.getString("body", "");
        int status = Boolean.TRUE.equals(ok) ? 200 : 500;
        if (Boolean.TRUE.equals(ok)) {
            p.status = 200;
        } else {
            p.status = 500;
        }
        p.response = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
        p.answered = true;
        p.latch.countDown();
        call.resolve();
    }

    /** 主机可用局域网 IPv4 列表（排除回环/链路本地/CGNAT TUN） */
    @PluginMethod
    public void lanIps(PluginCall call) {
        JSObject res = new JSObject();
        com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
        for (String ip : lanIpsList()) {
            arr.put(ip);
        }
        res.put("ips", arr);
        call.resolve(res);
    }

    static List<String> lanIpsList() {
        List<String> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a.isLoopbackAddress() || a.isLinkLocalAddress()) continue;
                    byte[] b = a.getAddress();
                    if (b.length != 4) continue; // 只要 IPv4
                    int first = b[0] & 0xFF;
                    int second = b[1] & 0xFF;
                    if (first == 198 && second == 18) continue;      // benchmark/TUN
                    if (first == 100) continue;                       // CGNAT 100.64/10
                    if (first == 169 && second == 254) continue;      // APIPA（isLinkLocal 已排除，双保险）
                    out.add(a.getHostAddress());
                }
            }
        } catch (SocketException e) {
            Log.w(TAG, "lanIps enumerate failed", e);
        }
        return out;
    }

    // ---------- HTTP 服务 ----------

    private void acceptLoop() {
        while (running.get()) {
            Socket s = null;
            try {
                // 局部变量快照：shutdown() 会在主线程并发把字段置 null，
                // 直接读字段 accept() 会抛 NPE（P-a 闪退根因之一）。
                ServerSocket ss = serverSocket;
                if (ss == null) break;
                s = ss.accept();
                if (!running.get()) {
                    closeQuietly(s);
                    break;
                }
                ExecutorService pool = ioPool;
                if (pool == null) {
                    closeQuietly(s);
                    continue;
                }
                final Socket conn = s;
                s = null; // 已移交 worker 线程，避免下面的 catch 重复关闭
                try {
                    pool.execute(() -> handleConnection(conn));
                } catch (RuntimeException e) {
                    // 线程池已被 shutdown()（stop 与 accept 竞态）→ 该连接必须在这里关，
                    // 否则 s 已置 null，外层 catch 的 closeQuietly(null) 什么也不做，fd 泄漏（H2）。
                    closeQuietly(conn);
                    throw e;
                }
            } catch (IOException e) {
                closeQuietly(s);
                if (running.get()) {
                    Log.e(TAG, "accept failed", e);
                }
                break;
            } catch (Throwable t) {
                // 任何 RuntimeException（NPE / RejectedExecutionException）都不得逃出本线程：
                // daemon 线程抛出未捕获异常会被 Android 默认处理器直接杀进程（用户看到的闪退）。
                closeQuietly(s);
                if (!running.get()) break;
                Log.e(TAG, "accept loop recovered from unexpected error", t);
                try {
                    // 退避 50ms。已知理论边界（不修，Lead 决定）：若 accept() 持续抛非 IOException
                    // （如 SocketImpl 分配 OOM / SecurityException），running 仍为 true 时这里会以
                    // ~20 次/秒重试并刷日志。现实路径中唯一的非 IOException 是线程池被 shutdown 抛出的
                    // RejectedExecutionException，而它只会在 running 已置 false 后出现，上一行就 break 了。
                    Thread.sleep(50L);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    private void handleConnection(Socket s) {
        try (s) {
            s.setSoTimeout((int) HANDLER_TIMEOUT_MS + 5_000);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { writeResponse(out, 400, "bad request"); return; }
            String method = parts[0];
            String path = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            int contentLength = 0;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int ci = line.indexOf(':');
                if (ci > 0) {
                    String k = line.substring(0, ci).trim().toLowerCase();
                    String v = line.substring(ci + 1).trim();
                    headers.put(k, v);
                    if ("content-length".equals(k)) {
                        try { contentLength = Integer.parseInt(v); } catch (NumberFormatException nfe) { contentLength = 0; }
                    }
                }
            }

            // CORS 预检与基础头（CORS 不是授权，业务校验在 JS/加密层）
            boolean options = "OPTIONS".equalsIgnoreCase(method);

            byte[] body = null;
            if (!options && contentLength > 0) {
                if (contentLength > MAX_BODY_BYTES) {
                    writeResponse(out, 413, "payload too large");
                    return;
                }
                body = new byte[contentLength];
                int off = 0;
                while (off < contentLength) {
                    int n = in.read(body, off, contentLength - off);
                    if (n < 0) return;
                    off += n;
                }
            }

            if (options) {
                writeCorsOnly(out);
                return;
            }

            // 仅接受 /info（明文握手）与 /action（加密动作）
            String route = path.indexOf('?') >= 0 ? path.substring(0, path.indexOf('?')) : path;
            if (!"/info".equals(route) && !"/action".equals(route)) {
                writeResponse(out, 404, "not found");
                return;
            }

            if (pending.size() >= MAX_CONCURRENT) {
                writeResponse(out, 503, "too many pending requests");
                return;
            }

            String requestId = String.valueOf(seqGen.incrementAndGet());
            PendingRequest p = new PendingRequest(requestId, route);
            pending.put(requestId, p);

            JSObject evt = new JSObject();
            evt.put("requestId", requestId);
            // 传完整 path（含 query）：成员公钥等公开参数经 query 传递，路由匹配用 route
            evt.put("path", path);
            evt.put("route", route);
            evt.put("method", method);
            evt.put("sessionId", sessionId);
            evt.put("bodyB64", body == null ? "" : b64encode(body));
            // 事件发出不算成功；等 JS completeRequest 或超时
            notifyListeners("teamRequest", evt);

            boolean got = p.latch.await(HANDLER_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            pending.remove(requestId);
            if (!got || !p.answered) {
                Log.w(TAG, "handler timeout for " + requestId + " " + route);
                writeResponse(out, 504, "handler timeout");
                return;
            }
            writeResponse(out, p.status, new String(p.response, StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "connection handling failed", e);
        }
    }

    private void shutdown() {
        running.set(false);
        // 顺序很关键：先把字段摘空（accept 线程的快照随后读到 null 就安全退出），
        // 再关闭 socket / 线程池，最后 join accept 线程；避免"字段已置 null 但线程还在跑"的窗口。
        ServerSocket ss = serverSocket;
        serverSocket = null;
        if (ss != null) {
            try { ss.close(); } catch (IOException ignored) {}
        }
        ExecutorService pool = ioPool;
        ioPool = null;
        if (pool != null) pool.shutdownNow();
        Thread t = acceptThread;
        acceptThread = null;
        if (t != null && t != Thread.currentThread()) {
            t.interrupt();
            // handleOnDestroy() 跑在主线程（BridgeActivity.onDestroy → Bridge.onDestroy →
            // 各插件 handleOnDestroy），join 最多会卡 Activity.onDestroy 500ms；
            // 而 Linux/ART 上 close() 监听 socket 并不保证唤醒阻塞在 accept() 的线程，
            // 这 500ms 有被吃满的现实可能。主线程路径直接跳过：字段已摘空、socket 已 close、
            // accept 线程是 daemon，不等它也不会拖住进程退出。
            if (Looper.myLooper() != Looper.getMainLooper()) {
                try {
                    t.join(500L);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        // 唤醒所有等待者使其走超时/失败路径
        for (PendingRequest p : pending.values()) {
            p.latch.countDown();
        }
        pending.clear();
    }

    @Override
    protected void handleOnDestroy() {
        // Capacitor 在 Bridge.onDestroy 时逐个回调插件（Plugin.handleOnDestroy 默认空实现）。
        // 不关的话监听 socket + 4 线程池会活过 WebView 销毁：旧端口继续 accept、
        // 每个请求卡满 20s 超时才 504，反复进出团队页会累积 fd / 线程（P-a/S2）。
        shutdown();
        super.handleOnDestroy();
    }

    private static void closeQuietly(Socket s) {
        if (s == null) return;
        try { s.close(); } catch (IOException ignored) {}
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int prev = -1;
        int c;
        while ((c = in.read()) != -1) {
            if (prev == '\r' && c == '\n') {
                sb.setLength(sb.length() - 1);
                return sb.toString();
            }
            sb.append((char) c);
            prev = c;
            if (sb.length() > 8192) throw new IOException("header line too long");
        }
        return sb.length() > 0 ? sb.toString() : null;
    }

    private static void writeResponse(OutputStream out, int status, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " " + reason(status) + "\r\n"
                + "Content-Type: text/plain; charset=utf-8\r\n"
                + "Content-Length: " + b.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: Content-Type\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    private static void writeCorsOnly(OutputStream out) throws IOException {
        String head = "HTTP/1.1 204 No Content\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: Content-Type\r\n"
                + "Access-Control-Max-Age: 600\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 404: return "Not Found";
            case 413: return "Payload Too Large";
            case 500: return "Internal Error";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default: return "Status";
        }
    }

    private static String b64encode(byte[] data) {
        return android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
    }
}
