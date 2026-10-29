# Triển khai trên AWS EC2 (A3) — 29/10/2026

Cả ứng dụng chạy `next start` trên một máy EC2, vì agent cần một tiến trình sống suốt cuộc gọi để giữ WebSocket tới OpenAI (Vercel serverless ngắt nó). Vercel vẫn giữ bản `main` cũ; bản EC2 chạy nhánh `29-finish`.

## Hạ tầng

| Thành phần | Cấu hình |
|---|---|
| Máy | `t3.small` (2 vCPU, 2 GB RAM, free tier), Ubuntu 24.04, ổ gp3 20 GB, swap 2 GB, vùng `ap-southeast-1` (Singapore, cùng vùng với Neon) |
| Instance / IP | `i-0da6a4339b540acd4`, Elastic IP `18.142.71.86` |
| Tên miền | `https://18-142-71-86.sslip.io` (sslip.io trỏ tên về IP, không cần mua tên miền) |
| HTTPS | Caddy, tự lấy và gia hạn chứng chỉ Let's Encrypt; reverse proxy tới `127.0.0.1:3000`. HTTPS là bắt buộc: trình duyệt chỉ cho dùng camera/mic trên trang an toàn |
| Tiến trình | pm2 (tự khởi động lại khi máy khởi động): `meetai` (`npm start`, cổng 3000, `--dns-result-order=ipv4first`), `inngest` (Inngest tự host, `127.0.0.1:8288`) |
| Inngest | Tự host bằng `inngest start` với event key / signing key sinh ngẫu nhiên; app dùng `INNGEST_BASE_URL=http://127.0.0.1:8288`, `INNGEST_DEV=0`. Không cần tài khoản Inngest Cloud |
| Tường lửa (Security Group `meetai-sg`) | Mở 80, 443 cho mọi nơi; 22 (SSH) chỉ cho IP của người dùng; 3000 và 8288 chỉ nghe trên localhost |
| SSH | Khoá `meetai-key` (ed25519), file `~/.ssh/meetai-key.pem` trên máy người dùng |

## Biến môi trường

`.env` trên server = `.env` máy dev, trừ:
- `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` = `https://18-142-71-86.sslip.io` (biến `NEXT_PUBLIC_*` gắn vào lúc build: đổi thì phải build lại).
- Thêm `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_BASE_URL`, `INNGEST_DEV=0`.
- Không có `REALTIME_MODEL`, `SAFETY_WARN_AT`, `SAFETY_KILL_AT` (dùng mặc định của sản phẩm: `gpt-realtime-2.1`, 5/10).
- `PII_ENCRYPTION_KEY` **giống hệt** máy dev (cùng một DB; mất khoá thì không giải mã được dữ liệu cá nhân đã che).
- File quyền `600`.

## Dịch vụ bên ngoài đã đổi

- **Webhook Stream** (video và chat chung một app, một event hook): URL đổi từ ngrok sang `https://18-142-71-86.sslip.io/api/webhook` bằng API (`updateApp`), giữ nguyên 179 loại sự kiện. Bản sao cấu hình cũ: `~/stream-event-hooks.backup.json` trên server. **Từ giờ bản chạy local qua ngrok không nhận webhook**; muốn test local thì đổi lại URL ngrok.
- **OAuth GitHub / Google**: chưa đổi, callback vẫn trỏ Vercel → trên bản EC2 đăng nhập bằng email. Muốn dùng thì thêm callback `https://18-142-71-86.sslip.io/api/auth/callback/{github,google}` trong cài đặt OAuth app.
- **AWS Budgets**: người dùng IAM `ai-lab-user` không có quyền `budgets:*` → người dùng tự đặt cảnh báo chi phí trên console.

## Cập nhật code

```bash
ssh -i ~/.ssh/meetai-key.pem ubuntu@18.142.71.86
cd meetai && git pull && npm ci && NODE_OPTIONS=--max-old-space-size=1536 npm run build && pm2 restart meetai
```

## Ghi chú cho đồ án

- Bề mặt tấn công tự quản trị: chỉ mở 80/443, SSH giới hạn IP và chỉ dùng khoá, dịch vụ nội bộ (app, Inngest) chỉ nghe localhost, HTTPS tự động, bí mật trong `.env` quyền 600 ngoài repo, webhook Stream kiểm chữ ký (`POST` không chữ ký → 400).
- Giới hạn: một máy, chưa có cân bằng tải hay giám sát; dữ liệu nằm ngoài Việt Nam (Neon, EC2 Singapore; Stream, OpenAI, NVIDIA ở Mỹ). Hướng phát triển: tách worker giữ kết nối agent khỏi phần giao diện.
