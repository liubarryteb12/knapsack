# 生成行囊 Knapsack release keystore（仅在本机执行一次）
# 密码随机生成并写入 keystore.properties（该文件已 gitignore）
$ErrorActionPreference = 'Stop'
$jdk = "D:\00.AIagent\codespace\Knapsack\.jdk21\jdk-21.0.2\bin\keytool.exe"
$store = "android\knapsack-release.keystore"
if (Test-Path $store) { Write-Host "keystore 已存在，不覆盖"; exit 1 }
# 随机密码
function New-Pass([int]$len) { -join ((48..57)+(65..90)+(97..122) | Get-Random -Count $len | ForEach-Object { [char]$_ }) }
$sp = New-Pass 24; $kp = New-Pass 24
& $jdk -genkeypair -v -keystore $store -alias knapsack -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12 -storepass $sp -keypass $kp -dname "CN=Knapsack, OU=App, O=Knapsack, L=, S=, C=CN" 2>&1 | Select-Object -Last 3
"KNAPSACK_KEYSTORE=knapsack-release.keystore`nKNAPSACK_STORE_PASSWORD=$sp`nKNAPSACK_KEY_ALIAS=knapsack`nKNAPSACK_KEY_PASSWORD=$kp" | Out-File -FilePath android\keystore.properties -Encoding utf8 -NoNewline
Write-Host "keystore + keystore.properties 已生成（密码随机，仅本机，已 gitignore）"