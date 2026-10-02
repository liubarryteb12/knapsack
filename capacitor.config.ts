import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.liubarryteb12.knapsack',
  appName: 'Knapsack',
  webDir: 'dist',
  server: {
    // 局域网会话要把请求发到 http://<主机IP>:<端口>（明文 HTTP）。
    // 安全性由应用层 AES-256-GCM 信封加密保证，不依赖传输层 TLS；
    // 手机端无法低成本使用自签名证书，因此这里放开明文流量。
    cleartext: true,
  },
  android: {
    // https://localhost 页面请求 http:// 局域网地址属于混合内容，默认会被 WebView 拦掉
    allowMixedContent: true,
  },
};

export default config;
