package com.liubarryteb12.knapsack;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PromptShare")
public class PromptSharePlugin extends Plugin {
  private static volatile PromptSharePlugin instance;
  private static volatile String pendingLink;
  private static volatile boolean webReady;

  @Override
  public void load() {
    instance = this;
    webReady = false;
  }

  @Override
  protected void handleOnNewIntent(Intent intent) {
    Uri data = intent == null ? null : intent.getData();
    if (data == null || !"knapsack-prompt".equals(data.getScheme())) return;
    pendingLink = data.toString();
    if (webReady) deliverRetained();
  }

  @Override
  protected void handleOnDestroy() {
    if (instance == this) instance = null;
  }

  @PluginMethod
  public void consumePending(PluginCall call) {
    webReady = true;
    JSObject result = pendingResult();
    call.resolve(result);
  }

  private static JSObject pendingResult() {
    JSObject result = new JSObject();
    result.put("link", pendingLink);
    pendingLink = null;
    return result;
  }

  private void deliverRetained() {
    PromptSharePlugin plugin = instance;
    String link = pendingLink;
    if (plugin == null || link == null) return;
    Bridge bridge = plugin.getBridge();
    if (bridge == null || bridge.getWebView() == null) return;
    pendingLink = null;
    plugin.notifyListeners("promptShare", pendingResult(), true);
  }
}
