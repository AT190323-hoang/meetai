# Nhật ký 29/10/2026 (tối) — Thực nghiệm Chương 3 và triển khai EC2

- **KB1 (văn bản):** bộ 254 câu (tự soạn + câu cũ + JailbreakBench dịch máy), 2 lần mỗi câu qua đúng hàm guard. Kết quả `thuc-nghiem/ket-qua-chuong3.md`.
- **Deploy EC2** (A3): `trien-khai-ec2.md`. Webhook Stream đã trỏ về `https://18-142-71-86.sslip.io` → bản local qua ngrok không nhận webhook nữa.
- **KB2, KB3 (cuộc gọi thật trên EC2, strict, `gpt-realtime-2.1`):** `thuc-nghiem/ket-qua-chuong3-cuoc-goi.md`; kịch bản `kiem-thu/2026-10-29-kich-ban-chuong3.md`; 20 ảnh trong `thuc-nghiem/anh/` (gitignore).
- **Lỗi tìm thấy và đã sửa:** (1) kết luận về câu mở đầu agent đến sau khi agent nói xong vẫn bị thi hành; (2) số đọc bằng chữ không được che, "a cộng", số tài khoản tách bằng ". "; (3) câu trả lời sau tiếng đệm "Ừ." bị ghép với "Ừ."; (4) gộp (1): lần chặn đầu tiên trên câu mở đầu của agent (BLOCK hoặc CARE) ở mọi lượt chưa bị chặn phải giữ khi kiểm thêm. Kiểm bằng script (`guard-grouping-check.ts` 7/7, `pii-check.ts` 26/26), **chưa gọi thật** cho (3) và (4).
- **Chưa sửa (ghi vào hạn chế):** agent không nói đúng câu cảnh báo khi model realtime nghe nhầm câu vừa bị chặn; Nemotron chặn nhầm câu hỏi liều thuốc.
- Tiếp theo: viết tài liệu đồ án.
