# Vấn đề mở & việc chờ làm

> Cập nhật: 21/10/2026. Mục nào có quyết định thì chuyển kết luận vào tài liệu liên quan và gạch khỏi đây.

## A. Quyết định cần bàn

### A1. Chính sách phân mức vi phạm (**đã chốt 21/10**)
Chi tiết trong [de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md](de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md). Tóm tắt:
- **Chặn** (cắt lời, `flagged`, tính ngưỡng): S1–S5, S7, S8, S11, S16, S17, S22, jailbreak, `vn_policy`.
- **Ghi nhận** (chỉ lưu): S9, S10, S12–S15, S18–S21, S23.
- **S6** tự hại (sửa 21/10): mức `care`. Câu người dùng không cắt lời, không `flagged`, bật chế độ hỗ trợ một lần cho cả phiên. Chỉ cắt lời và `flagged` (do agent) khi agent nói nội dung có hại. Không thêm detector.
- Chỉ dẫn từ chối chuyển sang dạng bổ sung vào instructions gốc.
- Detector mới **`vn_policy`** (gpt-4o-mini, chính sách nội dung Việt Nam) cho cả người dùng và agent; thêm chỉ dẫn mặc định cho agent.
- Một chính sách chung trong `src/lib/safety-policy.ts`; thêm cột `severity`.
- Thứ tự làm: phân mức → kill-switch/cách ly → `vn_policy` → thực nghiệm.

### A2. Shadow hay strict mode (**hướng đã chốt 21/10, đang khảo sát**)
- Sản phẩm chạy **một chế độ guard cố định** do hệ thống quyết định: shadow (song song, hiện tại) **hoặc** strict (chặn trước khi agent trả lời). **Không** cho người dùng hay từng agent tự chọn, vì như vậy là giao quyết định về mức an toàn cho người có thể lạm dụng.
- Chọn chế độ nào: **khảo sát rồi thống nhất**. Kết quả phần không cần gọi điện: [khao-sat/a2-shadow-vs-strict.md](khao-sat/a2-shadow-vs-strict.md). Shadow chỉ cắt kịp khoảng 5/9 lượt; ứng viên mạnh là **strict có giới hạn thời gian** (quá T giây thì quay về shadow). Còn cần cuộc gọi thật (mục 5 của khảo sát).
- Biến môi trường `REALTIME_GUARD=off|shadow|strict` chỉ để **người vận hành chạy thực nghiệm** Chương 3 (so sánh 3 cấu hình), không phải tùy chọn sản phẩm.
- Làm sau chính sách phân mức và kill-switch (strict dựa vào bảng mức A1: chỉ chặn trước câu người dùng ở mức chặn; câu agent vẫn kiểm song song).

### A4. Ngữ cảnh nhiều lượt (**đã chốt 21/10**)
- **Giữ nguyên code:** cả ba điểm kiểm duyệt đánh giá **từng lượt** (câu người dùng kiểm riêng; câu agent kiểm theo cặp với câu hỏi). Đây đúng là cách dùng trong model card Nemotron (template một lượt, đầu ra một `User Safety` + một `Response Safety`; dữ liệu huấn luyện chủ yếu là cặp prompt/response).
- **Không** đưa cả chuỗi hội thoại vào Nemotron: đo ngày 21/10 (`safety-guard.md` mục 9d) cho thấy dính cờ và báo nhầm câu agent.
- **Sửa tài liệu cho đúng code:** `safety-guard.md` đã sửa (D2, mục 8). ⚠️ **Bản đồ án** (2.4(d), bảng quyết định) vẫn ghi hậu kiểm "phát hiện tấn công nhiều lượt", người dùng tự sửa hoặc gửi file để sửa.
- **Để sau (phương án B):** "giám khảo cả cuộc họp" bằng LLM trong `meetingsSafetyAudit`, một kết luận cho mỗi meeting, không tính ngưỡng. Chỉ làm sau chính sách phân mức, kill-switch và `vn_policy`, và chỉ khi bộ kịch bản crescendo (mọi lượt riêng lẻ đều qua guard) cho thấy lỗ hổng thật.
- Phần "giá trị của guardrail" (7 lý do, bảng 4 ô) vẫn ở [de-xuat/2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md](de-xuat/2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md) mục 4.

### A5. Kill-switch, cách ly hậu kỳ và quy trình phản ứng sự cố (**đã chốt 21/10**)
Chi tiết ở mục 6 của [de-xuat/2026-10-20-kill-switch-va-quy-trinh-su-co.md](de-xuat/2026-10-20-kill-switch-va-quy-trinh-su-co.md). Tóm tắt:
- Cách ly: owner bị ẩn summary/transcript/recording, **chặn ở server**; xác nhận vi phạm thì xem lại được, cờ giữ nguyên, có ghi log. Không cho tự gỡ cờ.
- Leo thang: cảnh báo ở vi phạm thứ 5, cảnh báo lần cuối ở thứ 9, kill-switch (kết thúc call) ở thứ 10. Đếm theo lượt nói của người dùng, chỉ nhóm mức chặn. Ngưỡng qua env `SAFETY_WARN_AT` / `SAFETY_KILL_AT`.
- Chat sau họp khóa vĩnh viễn với meeting flagged (chống stored injection qua summary).
- Giữ nội dung gốc trong `safety_events`; ẩn danh PII để hướng phát triển.
- "Mức chặn" theo A1.

### A3. Triển khai production (**đã chốt 21/10**)
- Agent cần process chạy liên tục (giữ WebSocket tới OpenAI suốt cuộc gọi), Vercel serverless không đáp ứng.
- **Chọn cách 2:** cả app chạy `next start` trên **AWS EC2** (t2/t3.micro, vùng Singapore `ap-southeast-1`, cùng vùng với Neon), dùng free tier của người dùng. Không phải sửa code. Kèm: `pm2`, Caddy (HTTPS tự động), swap 2 GB để build (hoặc build sẵn), Inngest Cloud, trỏ webhook Stream về server. Đặt AWS Budgets cảnh báo chi phí; Security Group chỉ mở 80/443, SSH chỉ cho IP người dùng.
- **Làm sau cùng:** deploy thử, rồi đến khi demo mới deploy thật (merge `main`). Trước đó phát triển và test ở local + ngrok.
- **Hướng phát triển (ghi vào đồ án):** tách worker riêng cho agent (Vercel cho giao diện + worker giữ kết nối agent và guard) để mở rộng và cô lập lỗi khi có nhiều cuộc gọi đồng thời.
- Ghi chú đồ án: dữ liệu cuộc họp nằm ngoài Việt Nam (Neon Singapore; Stream, OpenAI, NVIDIA ở Mỹ). Nêu như một giới hạn về lưu trữ dữ liệu (tra lại quy định Luật An ninh mạng).

## B. Việc tiếp theo (tạm dừng — chờ bạn bảo làm)

- [x] **Đã gộp vào `29-finish` (28/10):** `feat/safety-policy` (A1) → `feat/kill-switch` (A5) → `feat/vn-policy` → `feat/stream-auth` (phân quyền Stream). Test cuộc gọi + chat 27–28/10 đạt (chi tiết `nhat-ky/2026-10-27-ket-qua-test-cuoc-goi.md`). **Còn D1** (cuộc gọi của meeting tạo trước bản sửa phân quyền, `XK7kzlKr1M0orQiw1c5QR`).
- [ ] `vn_policy` — chờ bàn: **mở rộng nội dung chính sách** (hiện chỉ 4 nhóm). Đề xuất bổ sung: đường chín đoạn, vùng biển/biên giới; xúc phạm quốc kỳ, quốc huy, quốc ca, lãnh tụ, anh hùng dân tộc; phỉ báng chính quyền, chiến tranh tâm lý, ly khai; chia rẽ khối đại đoàn kết; bịa đặt khẳng định như sự thật. Mỗi nhóm cần câu thử và đo lại.
- [x] Sửa sau test 27–28/10: chép lời realtime ghi `language: "vi"` (đã kiểm chứng); chỉ nhận transcript đầu tiên của meeting; không tóm tắt transcript rỗng; webhook chat trả lời ngay + chống trùng (hết trả lời 3 lần); câu trả lời cố định của chat bằng tiếng Việt.
- [~] **Nâng cấp model OpenAI** (mọi model đang dùng bị tắt 14–20/01/2027): khảo sát `khao-sat/doi-model.md`, kế hoạch duyệt 28/10, nhánh `feat/model-upgrade`.
- [ ] **Chờ bàn: bản chép lời sau cuộc gọi là tiếng Anh.** Stream transcription đặt `language: "en"` và **không hỗ trợ tiếng Việt** (chỉ có `auto`, `en`, `zh`, `th`…). Bản chép lời bị dịch méo ("tích phân" → "Tick Fun"), nên kiểm duyệt hậu kỳ chạy trên văn bản sai và summary ra tiếng Anh (người dùng Việt đọc không thuận). Hướng có thể: lưu bản chép lời tiếng Việt từ realtime (đã có sẵn trong guard) và dùng nó cho kiểm duyệt hậu kỳ + summary; hoặc thử `auto`.
- [ ] Kiểm duyệt hậu kỳ chặn nhầm câu từ chối của agent ("This is the last warning…") khi ghép cặp với câu hỏi chế tạo bom (lệch kết quả khi ghép cặp).
- [ ] Sau đó: chế độ guard (A2) → thực nghiệm → deploy (A3).
- [ ] Chỉnh prompt `jailbreak_llm`: đang gắn nhãn jailbreak cho yêu cầu độc hại trực tiếp (khảo sát A2, mục 6).
- [ ] Bộ dữ liệu thử nghiệm + script đo cho Chương 3 (tỷ lệ phát hiện theo detector, độ trễ, caught_in_time, EN vs VI).
- [ ] Ẩn danh PII trước khi lưu (mục 4.5 đề cương).

## C. Việc cần làm ngay về vận hành

- [ ] **Test lại một cuộc gọi thật** sau khi merge `main` (Next 15.3.8, bản vá CVE) và nâng `@stream-io/node-sdk` 0.7.44 → 0.7.64 ngày 21/10. Build đã qua, nhưng `connectOpenAi` chưa được kiểm tra với bản mới.
- [ ] **Đổi webhook Stream về Vercel** sau khi test (`https://meetai-pi-nine.vercel.app/api/webhook`).
- [ ] Bản Vercel đang chạy code cũ có lỗi: `ws` bufferutil, giao thức beta (`session.type`), VAD tắt → agent không nhận instructions. Cần deploy code mới (và vẫn còn vấn đề A3).
- [x] ~~Commit các thay đổi hiện tại~~ — đã commit 20/10 trên `29-finish` và đã push lên `origin/29-finish` (chưa merge `main` vì merge sẽ tự deploy production trên Vercel). File `.docx`/`.pdf` đồ án được đưa vào `.gitignore` (repo công khai); quản lý phiên bản bằng Google Drive/OneDrive.
- [ ] `npm audit` còn báo một số lỗ hổng trong dependency — chưa xử lý.
- [ ] Đồ án: thêm phần lỗ hổng phân quyền Stream và bảng kiểm chứng (`khao-sat/stream-auth.md`); mục "Stream token ràng buộc call_id" giờ đã đúng với code.

## D. Tài liệu đồ án

**18/10/2026:** đã tạo `docs/ĐỒ ÁN - bản sửa.docx` (+ PDF, 122 trang). Bản này tổ chức lại theo đúng cấu trúc trong đề cương (3 chương), sửa các điểm sai liệt kê bên dưới, bổ sung phần các mô hình AI, chuyển guardrail lên Chương 2 (mục 2.3.4 và 2.4), viết kịch bản thực nghiệm và thêm kết quả sơ bộ. File gốc `ĐỒ ÁN.docx` được giữ nguyên.

Việc còn lại:
- [ ] Bạn đọc duyệt bản sửa; xác nhận **cách 1** (giữ mục 3.2.4 "Kết quả thử nghiệm sơ bộ") hay **cách 2** (bỏ mục đó).
- [ ] Điền kết quả thực nghiệm chính thức vào 3.2.1 và 3.2.2 (hiện đang ghi "sẽ bổ sung").
- [ ] Mục 2.4(e) ghi kill-switch, trang quản trị và ẩn danh PII là "đang hoàn thiện". Cần làm xong hoặc sửa lại câu chữ trước khi nộp.
- [ ] **Sau khi deploy AWS (A3):** viết lại phần an toàn tầng triển khai (Chương 2) và kiểm thử hạ tầng (Chương 3, Hình 3.10) đang ghi Vercel/serverless (khoảng 10 đoạn + 1 hình). Đảo lập luận "không phải quản trị máy chủ nên giảm bề mặt tấn công" thành các biện pháp bảo mật tự quản trị; dùng việc agent bị ngắt trên Vercel làm lý do chuyển sang EC2.
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
