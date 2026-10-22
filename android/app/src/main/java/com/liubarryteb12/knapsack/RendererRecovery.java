package com.liubarryteb12.knapsack;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * 渲染进程死亡自愈（P-c）。
 *
 * 背景：真机压测（p7-crash-sweep，PSS 201MB 时打开系统分享面板）抓到唯一真实崩溃信号
 *   E/chromium: [ERROR:aw_browser_terminator.cc(156)] Renderer process (30332) crash detected (code -1)
 * 应用进程不死，但 Capacitor 的 BridgeWebViewClient.onRenderProcessGone 在无 listener 处理时返回 false，
 * WebView 实例报废 → 用户看到白屏，体感等同「闪退」。
 *
 * 策略：
 *   1) onRenderProcessGone 里记录现场（didCrash / 当前 URL）并 **return true**（返回 false 会被系统杀进程）；
 *   2) 不 reload（渲染进程死后的 WebView 实例已废），改为重建 Activity，让 Capacitor 重新创建 WebView；
 *   3) 用静态字段 pendingRestoreUrl 记住死前的 hash 路由（如 https://localhost/#/team/p7teamorg0001），
 *      新 Activity 在 onPageLoaded 里载回去一次后置 null，避免重复加载；
 *   4) 防抖：同进程重建次数上限 3 次；重建进行中的重复回调忽略；落在冷却期内的崩溃 **不丢弃**，
 *      改为延迟（剩余冷却时间 + 200ms）后重建——内存压力下新渲染进程 2s 内再死一次是最可能踩到的场景，
 *      丢弃就等于白屏不恢复；
 *   5) 自愈后若稳定 60s 无新崩溃，rebuildCount 归零，避免长期使用中累计 3 次死亡后永久失去自愈能力。
 */
public final class RendererRecovery {

    private static final String TAG = "RendererRecovery";

    /** 同一进程内允许的最大重建次数，避免渲染进程反复死亡导致无限重建。 */
    private static final int MAX_REBUILDS = 3;

    /** 两次重建之间的最小间隔，挡掉系统连续投递的重复回调。 */
    private static final long REBUILD_COOLDOWN_MS = 2000L;

    /** 冷却期命中时额外留的余量，确保落在冷却窗口之外。 */
    private static final long COOLDOWN_MARGIN_MS = 200L;

    /** 恢复路由时的延迟，等 Capacitor 把默认页面（https://localhost）载完。 */
    private static final long RESTORE_DELAY_MS = 300L;

    /** 自愈成功后保持多久无新崩溃才把 rebuildCount 归零。 */
    private static final long STABLE_RESET_MS = 60_000L;

    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static volatile String pendingRestoreUrl = null;
    private static volatile boolean recreating = false;
    private static volatile int rebuildCount = 0;
    private static volatile long lastRebuildAt = 0L;

    /** 当前存活的 Activity；重建后 attach() 会更新，供延迟重建使用，避免持有已销毁的旧 Activity。 */
    private static volatile BridgeActivity currentActivity = null;

    /** 已排队但还没执行的重建任务（冷却期路径），用于 attach() 时判断重建是否仍在进行中。 */
    private static Runnable pendingRebuildTask = null;

    /** 稳定期归零计时任务。 */
    private static Runnable stableResetTask = null;

    private RendererRecovery() {}

    /**
     * 在 MainActivity.onCreate（super.onCreate 之后）调用：注册监听并把重建状态复位。
     */
    public static void attach(BridgeActivity activity) {
        if (activity == null) return;
        currentActivity = activity;
        // 还有排队中的延迟重建时不能复位 recreating，否则会重复调度
        if (pendingRebuildTask == null) {
            recreating = false;
        }
        try {
            activity.getBridge().addWebViewListener(new Listener(activity));
            Log.i(TAG, "attach: WebViewListener 已注册，rebuildCount=" + rebuildCount
                    + " pendingRestoreUrl=" + pendingRestoreUrl
                    + " pendingRebuild=" + (pendingRebuildTask != null));
        } catch (Throwable t) {
            Log.e(TAG, "attach: 注册 WebViewListener 失败", t);
        }
    }

    /**
     * 排一次重建。delayMs &lt;= 0 表示立即（下一轮主线程消息）；否则延迟执行。
     * 调用前必须已确认未超 MAX_REBUILDS。调度时把 recreating 占位为 true，防止重复调度。
     */
    private static void scheduleRebuild(long delayMs) {
        recreating = true;
        lastRebuildAt = SystemClock.elapsedRealtime();

        final Runnable task = () -> {
            pendingRebuildTask = null;
            if (rebuildCount >= MAX_REBUILDS) {
                Log.e(TAG, "延迟重建放弃：已达重建上限 " + MAX_REBUILDS + " 次");
                recreating = false;
                return;
            }
            BridgeActivity activity = currentActivity;
            if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                Log.e(TAG, "延迟重建放弃：Activity 不可用（null=" + (activity == null) + "）");
                recreating = false;
                return;
            }
            rebuildCount++;
            Log.w(TAG, "onRenderProcessGone: 第 " + rebuildCount + " 次重建 Activity，恢复目标=" + pendingRestoreUrl);
            try {
                Log.i(TAG, "recreate(): 开始重建 Activity");
                activity.recreate();
            } catch (Throwable t) {
                Log.e(TAG, "recreate() 失败", t);
                recreating = false;
            }
        };

        pendingRebuildTask = task;
        if (delayMs <= 0L) {
            mainHandler.post(task);
        } else {
            mainHandler.postDelayed(task, delayMs);
        }
    }

    /** 自愈成功后开始稳定期计时；期间若再崩溃会被 cancelStableReset 取消。 */
    private static void scheduleStableReset() {
        cancelStableReset();
        stableResetTask = () -> {
            stableResetTask = null;
            if (recreating) {
                // 正在重建，重新排一次，等真正稳定下来再归零
                scheduleStableReset();
                return;
            }
            if (rebuildCount != 0 || lastRebuildAt != 0L) {
                Log.i(TAG, "稳定期 " + STABLE_RESET_MS + "ms 内无新崩溃，rebuildCount 归零（原=" + rebuildCount + "）");
                rebuildCount = 0;
                lastRebuildAt = 0L;
            }
        };
        mainHandler.postDelayed(stableResetTask, STABLE_RESET_MS);
    }

    private static void cancelStableReset() {
        if (stableResetTask != null) {
            mainHandler.removeCallbacks(stableResetTask);
            stableResetTask = null;
        }
    }

    private static final class Listener extends WebViewListener {

        private final Activity activity;

        Listener(Activity activity) {
            this.activity = activity;
        }

        @Override
        public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
            boolean didCrash = detail != null && detail.didCrash();
            String url = null;
            try {
                url = webView != null ? webView.getUrl() : null;
            } catch (Throwable ignored) {
                // WebView 已处于不可用状态时 getUrl 可能抛异常，忽略即可
            }

            Log.e(TAG, "onRenderProcessGone: didCrash=" + didCrash + " url=" + url
                    + " rebuildCount=" + rebuildCount + "/" + MAX_REBUILDS
                    + " recreating=" + recreating);

            // 新崩溃：取消稳定期归零计时（自愈后稳定期被打破，计数要继续累计）
            cancelStableReset();

            if (url != null && !url.isEmpty()) {
                pendingRestoreUrl = url;
            }

            if (recreating) {
                Log.w(TAG, "onRenderProcessGone: 已有重建在进行（含排队中的延迟重建），忽略重复回调");
                return true;
            }
            if (rebuildCount >= MAX_REBUILDS) {
                Log.e(TAG, "onRenderProcessGone: 已达重建上限 " + MAX_REBUILDS + " 次，不再自动重建（需手动重启应用）");
                return true;
            }

            long now = SystemClock.elapsedRealtime();
            long sinceLast = now - lastRebuildAt;
            if (sinceLast < REBUILD_COOLDOWN_MS) {
                long delay = REBUILD_COOLDOWN_MS - sinceLast + COOLDOWN_MARGIN_MS;
                Log.w(TAG, "onRenderProcessGone: 距上次重建 " + sinceLast + "ms，冷却中 → 不丢弃，延迟 "
                        + delay + "ms 后重建");
                scheduleRebuild(delay);
                return true;
            }

            scheduleRebuild(0L);

            // 关键：必须返回 true，返回 false 会被系统杀掉应用进程
            return true;
        }

        @Override
        public void onPageLoaded(WebView webView) {
            String target = pendingRestoreUrl;
            if (target == null || webView == null) return;

            String current = null;
            try {
                current = webView.getUrl();
            } catch (Throwable ignored) {
                // ignore
            }
            if (sameRoute(current, target)) {
                Log.i(TAG, "onPageLoaded: 当前已在目标路由，无需恢复 url=" + current);
                pendingRestoreUrl = null;
                scheduleStableReset();
                return;
            }

            // 先置 null 再加载，防止 loadUrl 再次触发 onPageLoaded 形成循环
            pendingRestoreUrl = null;
            final String restoreTo = target;
            Log.i(TAG, "onPageLoaded: 恢复路由 " + restoreTo + "（当前=" + current + "）");
            try {
                webView.postDelayed(() -> {
                    try {
                        webView.loadUrl(restoreTo);
                    } catch (Throwable t) {
                        Log.e(TAG, "恢复路由失败: " + restoreTo, t);
                    }
                }, RESTORE_DELAY_MS);
            } catch (Throwable t) {
                Log.e(TAG, "onPageLoaded: 调度恢复失败", t);
            }
            scheduleStableReset();
        }

        private static boolean sameRoute(String a, String b) {
            if (a == null || b == null) return false;
            return normalize(a).equals(normalize(b));
        }

        private static String normalize(String url) {
            String s = url.trim();
            while (s.endsWith("/")) {
                s = s.substring(0, s.length() - 1);
            }
            return s;
        }
    }
}
