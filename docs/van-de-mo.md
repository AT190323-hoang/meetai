# Vấn đề mở & việc chờ làm

> Cập nhật: 21/10/2026. Mục nào có quyết định thì chuyển kết luận vào tài liệu liên quan và gạch khỏi đây.

## A. Quyết định cần bàn

### A1. Chính sách phân mức vi phạm (**đã chốt 21/10**)
Chi tiết trong [de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md](de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md). Tóm tắt:
- **Chặn** (cắt lời, `flagged`, tính ngưỡng): S1–S5, S7, S8, S11, S16, S17, S22, jailbreak, `vn_policy`.
- **Ghi nhận** (chỉ lưu): S9, S10, S12–S15, S18–S21, S23.
- **S6** tự hại: cắt lời + phản hồi hỗ trợ, `flagged`, không tính ngưỡng kill-switch.
- Detector mới **`vn_policy`** (gpt-4o-mini, chính sách nội dung Việt Nam) cho cả người dùng và agent; thêm chỉ dẫn mặc định cho agent.
- Một chính sách chung trong `src/lib/safety-policy.ts`; thêm cột `severity`.
- Thứ tự làm: phân mức → kill-switch/cách ly → `vn_policy` → thực nghiệm.

### A2. Có làm chế độ "Strict mode" (chặn trước khi agent trả lời) không
Đánh đổi: +0.6–1.8 s mỗi lượt. Cần thử nghiệm xem có khả thi với client GA (`turn_detection.create_response: false`).

### A4. Ngữ cảnh nhiều lượt + giá trị của guardrail (chưa quyết)
Chi tiết trong [de-xuat/2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md](de-xuat/2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md), cũng bao gồm A2 (strict mode).
- Guard hiện chỉ đánh giá **từng lượt**, cả ở hậu kiểm.
- ⚠️ `safety-guard.md` (D2) và bản đồ án (2.4(d), bảng quyết định) đang ghi hậu kiểm "phát hiện tấn công nhiều lượt", **sai so với code**. Phải sửa code hoặc sửa tài liệu trước khi nộp.

### A5. Kill-switch, cách ly hậu kỳ và quy trình phản ứng sự cố (**đã chốt 21/10**)
Chi tiết ở mục 6 của [de-xuat/2026-10-20-kill-switch-va-quy-trinh-su-co.md](de-xuat/2026-10-20-kill-switch-va-quy-trinh-su-co.md). Tóm tắt:
- Cách ly: owner bị ẩn summary/transcript/recording, **chặn ở server**; xác nhận vi phạm thì xem lại được, cờ giữ nguyên, có ghi log. Không cho tự gỡ cờ.
- Leo thang: cảnh báo ở vi phạm thứ 5, cảnh báo lần cuối ở thứ 9, kill-switch (kết thúc call) ở thứ 10. Đếm theo lượt nói của người dùng, chỉ nhóm mức chặn. Ngưỡng qua env `SAFETY_WARN_AT` / `SAFETY_KILL_AT`.
- Chat sau họp khóa vĩnh viễn với meeting flagged (chống stored injection qua summary).
- Giữ nội dung gốc trong `safety_events`; ẩn danh PII để hướng phát triển.
- "Mức chặn" theo A1.

### A3. Triển khai production
Agent cần process chạy liên tục — Vercel không đáp ứng. Lựa chọn: worker riêng (Railway / Fly / VPS) giữ kết nối agent + guard; hoặc demo đồ án chạy local.

## B. Việc tiếp theo (tạm dừng — chờ bạn bảo làm)

- [ ] Kill-switch trên UI: ẩn summary / recording / transcript khi meeting `flagged`, hiển thị cảnh báo.
- [ ] Trang liệt kê sự kiện vi phạm của từng meeting.
- [ ] Áp dụng chính sách phân mức (sau khi chốt A1).
- [ ] Bộ dữ liệu thử nghiệm + script đo cho Chương 3 (tỷ lệ phát hiện theo detector, độ trễ, caught_in_time, EN vs VI).
- [ ] Gửi kèm vài lượt hội thoại trước khi kiểm (ngữ cảnh) cho guard realtime.
- [ ] Ẩn danh PII trước khi lưu (mục 4.5 đề cương).

## C. Việc cần làm ngay về vận hành

- [ ] **Đổi webhook Stream về Vercel** sau khi test (`https://meetai-pi-nine.vercel.app/api/webhook`).
- [ ] Bản Vercel đang chạy code cũ có lỗi: `ws` bufferutil, giao thức beta (`session.type`), VAD tắt → agent không nhận instructions. Cần deploy code mới (và vẫn còn vấn đề A3).
- [x] ~~Commit các thay đổi hiện tại~~ — đã commit 20/10 trên `29-finish` và đã push lên `origin/29-finish` (chưa merge `main` vì merge sẽ tự deploy production trên Vercel). File `.docx`/`.pdf` đồ án được đưa vào `.gitignore` (repo công khai); quản lý phiên bản bằng Google Drive/OneDrive.
- [ ] `npm audit` còn báo một số lỗ hổng trong dependency — chưa xử lý.

## D. Tài liệu đồ án

**18/10/2026:** đã tạo `docs/ĐỒ ÁN - bản sửa.docx` (+ PDF, 122 trang). Bản này tổ chức lại theo đúng cấu trúc trong đề cương (3 chương), sửa các điểm sai liệt kê bên dưới, bổ sung phần các mô hình AI, chuyển guardrail lên Chương 2 (mục 2.3.4 và 2.4), viết kịch bản thực nghiệm và thêm kết quả sơ bộ. File gốc `ĐỒ ÁN.docx` được giữ nguyên.

Việc còn lại:
- [ ] Bạn đọc duyệt bản sửa; xác nhận **cách 1** (giữ mục 3.2.4 "Kết quả thử nghiệm sơ bộ") hay **cách 2** (bỏ mục đó).
- [ ] Điền kết quả thực nghiệm chính thức vào 3.2.1 và 3.2.2 (hiện đang ghi "sẽ bổ sung").
- [ ] Mục 2.4(e) ghi kill-switch, trang quản trị và ẩn danh PII là "đang hoàn thiện". Cần làm xong hoặc sửa lại câu chữ trước khi nộp.
- [ ] Các sơ đồ mới (kiến trúc, Safety Guard, shadow guard) đang là bản vẽ tự động; có thể vẽ lại bằng draw.io nếu muốn đồng bộ với các sơ đồ UML cũ.

Các điểm sai đã sửa trong bản sửa:

- Bộ phân loại S1–S5 và "S4 = Jailbreak" sai → thực tế S1–S23, không có nhóm jailbreak.
- Tên model không thống nhất ("Nemotron-3-8B-Safety" vs "Llama-3.1-Nemotron-Safety-Guard-8B").
- "Xác thực stateless JWT" → thực tế session lưu DB.
- "Stream token ràng buộc call_id" → chưa đúng với code; `validity_in_seconds` đang truyền sai; user được upsert với role `admin` trên Stream.
- "Polar Webhooks" → không có handler webhook Polar; code gọi API Polar trực tiếp.
- "Server Actions" → dự án dùng tRPC.
- Mục 4.5 ẩn danh PII → chưa có trong code.
- Bổ sung: kiến trúc 3 detector, kết quả khảo sát jailbreak, shadow guard và các đánh đổi.
- Thiết kế CSDL cũ có 3 bảng không tồn tại trong code (Video Calling, Background Jobs, Payments). Đã thay bằng các bảng đúng theo schema: user, session, account, agents, meetings, safety_events.
- "Token OAuth/phiên được lưu dạng mã hóa" → thực tế chỉ mật khẩu được băm (scrypt); "token hết hiệu lực khi đăng xuất" → token Stream vẫn hiệu lực tới khi hết hạn 1 giờ.
- Bổ sung lưu ý: SRTP/DTLS chỉ mã hóa từng chặng, vì âm thanh được giải mã tại Stream để chuyển tới OpenAI.
