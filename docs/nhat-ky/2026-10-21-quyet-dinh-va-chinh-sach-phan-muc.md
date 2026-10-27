# Nhật ký 21/10/2026 — Chốt các quyết định A1–A5, triển khai chính sách phân mức

## 1. Đồng bộ và vận hành
- Pull đề xuất kill-switch do người dùng viết trên máy WSL (`de-xuat/2026-10-20-kill-switch-va-quy-trinh-su-co.md`).
- Merge `main` (bản vá CVE, Next 15.3.8) vào `29-finish`.
- Phát hiện `npm install` trên clone mới **thất bại** (ERESOLVE) từ khi nâng `openai-realtime-api` lên 0.4: `@stream-io/node-sdk` 0.7.44 chỉ chấp nhận ≤0.3. Nâng `node-sdk` lên 0.7.64. Build qua.
- Bỏ hạn 31/10 khỏi tài liệu (người dùng xác nhận chưa có hạn cố định). Ghi quy ước nhánh: `29-finish` là nhánh dev, chức năng lớn làm trên `feat/<tên>`, chỉ merge `main` khi deploy thật.

## 2. Các quyết định
| Mục | Kết luận | Tài liệu |
|---|---|---|
| A5 | Cách ly: chặn ở server, owner xác nhận mới xem lại, không tự gỡ cờ; cảnh báo ở vi phạm thứ 5 và 9, kill-switch ở thứ 10 (chỉ đếm câu người dùng mức chặn); khóa chat với meeting flagged | `de-xuat/2026-10-20-…` mục 6 |
| A1 | Bảng `block` / `care` / `log`; detector mới `vn_policy` (chính sách nội dung Việt Nam); S6 thành mức `care` | `de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md` |
| A4 | Giữ kiểm từng lượt; sửa tài liệu đang nói quá; "giám khảo cả cuộc họp" để sau | `van-de-mo.md` A4 |
| A3 | Cả app lên AWS EC2 (Singapore), làm sau cùng | `van-de-mo.md` A3 |
| A2 | Sản phẩm chạy **một** chế độ guard cố định, người dùng không chọn; ứng viên: strict có giới hạn thời gian | `khao-sat/a2-shadow-vs-strict.md` |

## 3. Đo đạc (scripts/thuc-nghiem/)
- **S6, câu trả lời của agent:** 13/13 đúng; câu hỗ trợ không bị báo nhầm.
- **S6, câu người dùng kiểm riêng:** 11/12 đúng, ổn định qua 3 lần.
- **Phát hiện:** kiểm theo cặp (câu người dùng + câu trả lời) làm lệch kết luận và nhãn cho câu người dùng → quy tắc "câu người dùng chỉ lấy từ lần kiểm riêng". Hậu kiểm đang mắc đúng lỗi này → đã sửa.
- **Ngữ cảnh nhiều lượt:** gây dính cờ (2/2) và báo nhầm câu agent → không áp dụng (A4).
- **Số liệu cuộc gọi 18/10:** shadow chỉ cắt kịp 5/9 lượt người dùng; `jailbreak_llm` chậm nhất (p50 1,07 s, p90 3,5 s). `jailbreak_llm` gắn nhãn jailbreak cho yêu cầu độc hại trực tiếp, trái với prompt của nó.
- Mạng ở máy này kết nối IPv4 tới NVIDIA và Neon chậm (~11 s), đôi khi timeout; script chạy với `--dns-result-order=ipv4first` và thử lại.

## 4. Triển khai chính sách phân mức (nhánh `feat/safety-policy`)
- `src/lib/safety-policy.ts`: bảng mức, chuẩn hóa tên nhóm, ngoại lệ S6, nhãn lạ → `log` + cảnh báo, các ghi chú cho agent. Tự kiểm tra: `scripts/thuc-nghiem/policy-check.ts` (23/23).
- `safety_events.severity` (enum `safety_severity`, đã `db:push`). Chỉ gắn `flagged` theo `shouldFlagMeeting`.
- Realtime: xử lý theo mức; ghi chú từ chối / chế độ hỗ trợ **bổ sung** vào instructions gốc.
- Chat: xử lý theo mức; chế độ hỗ trợ giữ cho cả meeting qua `hasCareSignal`.
- Hậu kiểm: kiểm riêng câu người dùng.
- Type-check, lint, build đều qua. **Chưa test** với chat và cuộc gọi thật.

## 5. Kill-switch và cách ly (nhánh `feat/kill-switch`, tách từ `feat/safety-policy`)
- Schema: `meetings.blocked_turns`, `meetings.safety_acknowledged_at` (đã `db:push`).
- Server: cách ly trong `getOne` / `getTranscript` / `getSafetyEvents`, `getMany` không gửi nội dung, `acknowledgeSafety`, khóa chat với meeting flagged.
- Guard realtime: đếm lượt bị chặn, cảnh báo ở 5 và 9, kill-switch ở 10 (`call.end()`), cấu hình qua `SAFETY_WARN_AT` / `SAFETY_KILL_AT`.
- Giao diện: huy hiệu flagged, banner theo `flaggedBy`, tab Safety, các tab nội dung giải thích lý do bị ẩn.
- Khảo sát phát hiện: không thể vào lại cuộc gọi để gắn agent lần nữa (điều kiện trạng thái `upcoming` có sẵn), nên không cần kiểm tra thêm.
- Type-check, lint, build qua. **Chưa test.**

## Việc tiếp theo
1. Người dùng test chat (bằng chữ) và cuộc gọi thật theo kịch bản trong chat của phiên này; xong thì merge `feat/safety-policy` về `29-finish`.
2. Test `feat/kill-switch`: giao diện + cuộc gọi với `SAFETY_WARN_AT=2`, `SAFETY_KILL_AT=3`.
3. `vn_policy`.

## 6. `vn_policy` (nhánh `feat/vn-policy`, tách từ `feat/kill-switch`)
- Khảo sát (`khao-sat/vn-policy.md`): tách riêng 18/18 câu người dùng, 5/5 câu agent, p90 mỗi lượt 1,41 s; gộp với `jailbreak_llm` kém chính xác hơn (17/18) và chỉ nhanh hơn ~0,1 s.
- Code: `src/lib/vn-policy.ts` (prompt giống hệt bản đã đo), enum `safety_detector` thêm `vn_policy` (đã `db:push`), `checkUserInput` 4 detector, `checkAgentReply` cho câu agent ở cả 3 điểm kiểm duyệt, câu agent chỉ vi phạm `vn_policy` thì được sửa, `VN_POSITION_NOTE` thêm vào instructions mọi agent.
- Nội dung chính sách giữ 4 nhóm; mở rộng để bàn sau.
- Type-check, lint, build qua. **Chưa test.**

## 7. Phân quyền Stream (nhánh `feat/stream-auth`, tách từ `feat/vn-policy`)
- Phát hiện: mọi người dùng là `admin` trên Stream chat và video; role `user` mặc định của call type `default` vào được mọi cuộc gọi; webhook chat không kiểm tra người gửi; token chat không hết hạn.
- Sửa code + thu hẹp role `user` trên Stream (có sao lưu và `--rollback`). Phát hiện thêm khi kiểm chứng: thành viên thêm sau phải ghi rõ `role: "call_member"`.
- Kiểm chứng bằng `scripts/thuc-nghiem/stream-access-check.cjs`: 16/16, gồm cả cuộc gọi cũ (không làm hỏng meeting đã tạo). Chi tiết: `khao-sat/stream-auth.md`.

## Kịch bản test

Đã gộp thành checklist: [../kiem-thu/2026-10-21-checklist-test.md](../kiem-thu/2026-10-21-checklist-test.md).
