package com.liubarryteb12.knapsack;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Capacitor 要求在 super.onCreate() 之前注册自定义插件，
    // 这样 bridge 初始化时会一并加载 TeamHost。
    registerPlugin(TeamHostPlugin.class);
    super.onCreate(savedInstanceState);
    // P-c：渲染进程死亡自愈。必须在 super.onCreate 之后（此时 bridge 已创建）。
    RendererRecovery.attach(this);
  }
}
