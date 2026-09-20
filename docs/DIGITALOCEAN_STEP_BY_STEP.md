# DigitalOcean 上線逐步教學

更新：2026-09-20。適用本專案首次部署到全新的 Ubuntu Droplet，不適用已承載其他網站的主機（部署腳本會覆寫 Caddy 設定）。

## 1. 先更新 GitHub

目前本機 main 有尚未提交的修改與新增檔案。必須先確認這些修改並推送，否則伺服器會安裝舊版。本教學沒有替你提交或推送。

在 Windows PowerShell：

```powershell
Set-Location D:\AI_Project\Lucky_horse
git status --short
npm test
```

測試成功後，用 GitHub Desktop 的 File → Add local repository 選擇這個資料夾，在 Changes 檢查本次要發布的檔案。不要提交 `.env`、私鑰、密碼、賓客個資、報表或 node_modules。將需要的修改與新增檔案勾選，Commit to main，再 Push origin。不要只推送已追蹤檔案而漏掉 shared/stage-display.js 等新檔。

沒有 GitHub Desktop 時，可用既有 Git 工具逐檔加入、檢查 staged diff 後 commit/push；不要未檢查就全選上傳。

到 https://github.com/vbnmzxc9513/lucky_happy 確認 main 的最新提交與本機 `git rev-parse HEAD` 一致。下面 clone 指令假設倉庫可匿名讀取；若是 private，不要為方便而改公開，先配置唯讀 deploy key，再使用 SSH repo URL。私有倉庫的金鑰也必須讓安裝腳本使用的 luckyhorse 使用者可讀取，單純在 root 登入 GitHub 並不足夠；遇到此情況先停在這一步處理權限。

## 2. 準備網域

需要一個你控制的網域，例如已購買的 example.com，為遊戲建立 game.example.com。這裡所有 example.com 與 YOUR_SERVER_IP 都是佔位符，必須換成你的資料。

GitHub Pages 的 github.io 網址不能當成你可設定 DNS 的網域。網址不必包含 www；game.你的網域 即可。網域費通常與主機費分開。

## 3. 建立 SSH 金鑰

在 Windows PowerShell 執行：

```powershell
ssh-keygen -t ed25519 -f "$HOME\.ssh\lucky_horse_do"
Get-Content "$HOME\.ssh\lucky_horse_do.pub"
```

設定金鑰密語。若工具提示檔案已存在，不要覆蓋，改用既有公鑰。將 `.pub` 顯示的整行加入 DigitalOcean；沒有 `.pub` 的檔案是私鑰，不要上傳 GitHub、貼到聊天或分享給別人。

## 4. 建立 Droplet

登入 https://cloud.digitalocean.com ，綁定付款方式，啟用帳號雙重驗證。

Create → Droplets，選擇：

- Region：Singapore，作為台灣婚禮的初始選擇，之後仍要從實際場地測網路。
- Image：Ubuntu 24.04 LTS x64。
- Type：Basic／Shared CPU。
- 規格：Regular，1 vCPU、2 GiB RAM、50 GiB SSD，官方目前列 USD 12／月；以結帳畫面為準。
- Authentication：SSH Key，貼入上一步公鑰並勾選。
- 主機名稱：lucky-horse-wedding。
- 一台即可；本方案不需要另購 Database、Load Balancer 或 Kubernetes。備份等加購會另計費。

建立後記下 Public IPv4。主機建立即開始計費，不是婚禮當天才計費。

## 5. 網域 DNS 指向主機

到網域目前使用的 DNS 管理平台新增：

| 類型 | 名稱 | 值 |
|---|---|---|
| A | game | Droplet 的 Public IPv4 |

若使用 Cloudflare，此階段先選 DNS only（灰雲），減少代理層排錯。不必因為用 DigitalOcean 而搬走既有 DNS。避免同名留下指向舊主機的 A／AAAA 紀錄。

Windows 確認：

```powershell
Resolve-DnsName game.example.com -Type A
```

必須看到正確的伺服器 IP。DNS 尚未更新時不要急著安裝憑證。

## 6. 連線與防火牆

Windows PowerShell：

```powershell
ssh -i "$HOME\.ssh\lucky_horse_do" root@YOUR_SERVER_IP
```

首次連線確認主機指紋後接受，輸入金鑰密語。無法登入可使用 DigitalOcean 的 Droplet Console 排查。

若有啟用 DigitalOcean Cloud Firewall，入站允許 TCP 22（你的管理 IP）、80 和 443（所有訪客）；出站需可存取 DNS、套件與憑證服務。不要對外開放 3000。下方安裝腳本也會設定 Ubuntu UFW，允許 SSH／80／443。不要在確認 SSH 可用前關閉管理通道。

## 7. 在伺服器安裝

以下是 SSH 登入後的 Ubuntu 指令，不是在 Windows 執行。請逐行操作，任何一步失敗都先停下，不要繼續跳過錯誤。

```bash
apt-get update
apt-get install -y git
git clone --branch main https://github.com/vbnmzxc9513/lucky_happy.git /root/lucky-horse-deploy-source
cd /root/lucky-horse-deploy-source
DOMAIN=game.example.com STAFF_ACCESS_CODE=1009 bash deploy/bootstrap-ubuntu.sh
```

DOMAIN 改成你的完整網域，不含 https:// 或路徑。1009 是目前工作人員驗證碼；公開上線建議改成只有兩位工作人員知道的較長數字（4–12 位），並在後續檢查使用相同代碼。不要把代碼放進賓客 QR 或公开公告。

腳本會安裝 Node.js、Caddy、依賴套件，將正式程式放在 /opt/lucky-horse，執行安全檢查與測試，產生隨機 session secret，設定 systemd 自動重啟、HTTPS 與公開 preflight。

等待出現 `Lucky Horse deployment is healthy.`。若安全檢查或測試失敗，不要關閉檢查硬上線，把錯誤輸出提供協助者，記得遮蔽密碼及 token。

此腳本的重新執行不等同完整安全更新流程；首次裝好後不要在比賽中重跑，正式更新要另排停機時段並備份 data。

## 8. 確認網站與服務

Ubuntu 執行：

```bash
systemctl is-active lucky-horse caddy
curl -f https://game.example.com/healthz
```

兩項服務應為 active，健康檢查應成功。Caddy 會自動申請、續期憑證並將 HTTP 導向 HTTPS；DNS 和公網 TCP 80／443 必須正確。

瀏覽器開啟：

- 賓客：https://game.example.com/guest/
- 工作人員選單：https://game.example.com/manage
- 主持控制台：https://game.example.com/control/
- 投影：https://game.example.com/host/
- 出題／設定：https://game.example.com/admin/

工作人員輸入第 7 步設定的代碼。賓客不需要工作人員代碼。投影開 16:9／全螢幕並點選啟用音效。QR 必須指向同一個公開 HTTPS 網址，不能是 localhost 或內網 IP。

## 9. 從自己的電腦驗證公網

回 Windows 開新的 PowerShell：

```powershell
Set-Location D:\AI_Project\Lucky_horse
.\deploy\verify-public.ps1 -Domain game.example.com -StaffAccessCode 1009
```

若 PowerShell 阻擋腳本，僅這一次執行可用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\verify-public.ps1 -Domain game.example.com -StaffAccessCode 1009
```

完成前先把遊戲回到大廳。確認 preflight 13/13，再測三支手機，其中至少一支關閉 Wi-Fi、用行動網路掃 QR，確認真正可從外網加入。

空場且沒有真人遊玩時才執行以下壓測；它會加入模擬玩家並操作賽事，不能在婚禮中執行：

```powershell
.\deploy\verify-public.ps1 -Domain game.example.com -StaffAccessCode 1009 -RunStress
```

此命令測 150 人及 15 人重連。需確認完整 18 題、六次結算、四獎、無系統錯誤；測完回大廳清除測試玩家，再用真手機完整走一局。部署成功不等同已通過實際婚禮網路、音響與投影驗收。

## 10. 失敗時看這裡

Ubuntu 診斷：

```bash
journalctl -u lucky-horse -n 100 --no-pager
journalctl -u caddy -n 100 --no-pager
ufw status
```

- SSH 超時：檢查 IP、防火牆 22 和你的網路。
- Permission denied (publickey)：確認 Droplet 選對公鑰，SSH 使用對應私鑰。
- git clone 要求登入或拒絕：倉庫為 private 或權限不足，先處理 deploy key，不要把 token 寫在公開命令或網址。
- HTTPS／憑證失敗：檢查 A／AAAA、80／443、DNS 生效、Cloudflare 是否先設灰雲。
- 502：先看 lucky-horse 服務日誌及 localhost:3000/healthz。
- 頁面是舊版：比較 GitHub main 與 /opt/lucky-horse 的提交，不要只重新整理。
- QR 錯誤：檢查 /etc/lucky-horse.env 中的 PUBLIC_BASE_URL。該檔案另有密鑰，不要將全文公開。
- 測試環境需要重啟服務：`systemctl restart lucky-horse`；會中斷現有賽事，進行中的比賽不會因重啟自動還原。

## 婚禮前最後確認

預先備份伺服器 data、確認本機 LAN 備援可用；婚禮前至少做一次場地彩排，活動前 30 分鐘再跑 preflight 與三支手機檢查。確認 QR、倒數、暫停恢復、鎖屏重連、音效與揭獎。不要臨場更新依賴或部署新功能。

婚禮後先保存需要的題庫資料與備份，再依需求刪除主機及不再需要的付費資源；只關機仍會計費。

## 官方參考

- 建立主機：https://docs.digitalocean.com/products/droplets/how-to/create/
- SSH：https://docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/openssh/
- 規格與價格：https://www.digitalocean.com/pricing/droplets
- 關機計費：https://docs.digitalocean.com/products/droplets/details/pricing/
- Caddy HTTPS：https://caddyserver.com/docs/automatic-https
