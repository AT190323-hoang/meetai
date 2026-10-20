# Nhật ký 19–20/10/2026 — Đánh giá tiến độ, đề xuất thiết kế, commit

## 19/10 — Đánh giá và thảo luận (không sửa code)
- **Đánh giá tiến độ:** khoảng 60–65% so với ý định ban đầu. Phần lõi (guard realtime, hậu kiểm, phát hiện jailbreak) đã chạy với dữ liệu thật. Còn thiếu: giao diện an toàn (badge `flagged`, kill-switch, trang vi phạm), test chat (DB chưa có bản ghi `chat`), thực nghiệm chính thức cho Chương 3, deploy (agent chỉ chạy ở local).
- **Giải thích nguyên lý:** Nemotron chỉ phân loại, không sinh câu từ chối. Realtime: agent tự nói câu từ chối theo chỉ dẫn. Chat: câu cố định `CHAT_REFUSAL`. Hậu kiểm: chỉ ghi DB và gắn cờ.
- **Thảo luận thiết kế** (ghi trong `de-xuat/2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md`, chờ quyết định):
  - Shadow guard có khoảng "lọt" 1–2 s âm thanh; phương án strict mode (+1,3–2,5 s/lượt).
  - Guard chỉ chấm từng lượt, kể cả hậu kiểm → tài liệu đang nói quá ("phát hiện tấn công nhiều lượt"), phải sửa code hoặc tài liệu trước khi nộp.
  - Guardrail không bị lu mờ bởi an toàn sẵn có của mô hình: 7 lý do + bảng 4 ô đo giá trị tăng thêm.

## 20/10 — Commit và push
- Commit toàn bộ thay đổi trên nhánh `29-finish` thành các commit: sửa lỗi realtime agent, guard Nemotron, sửa thụt lề, tài liệu.
- `.docx`/`.pdf` đồ án đưa vào `.gitignore` (repo công khai); quản lý phiên bản bằng cloud.
- Push `origin/29-finish`. **Chưa merge `main`** vì merge sẽ tự deploy production trên Vercel.
- Bổ sung vào `CLAUDE.md` phần bối cảnh đồ án và quy trình làm việc để phiên Claude Code trên máy khác bắt kịp.

## Việc tiếp theo (chờ "làm tiếp")
1. Khảo sát + kế hoạch cho giao diện an toàn (badge `flagged`, kill-switch ẩn nội dung, trang liệt kê vi phạm) — không cần gọi điện để làm.
2. Test chat và chạy lại cả luồng (cần người dùng gọi thật, đang hoãn).
3. Chốt chính sách phân mức (A1), strict mode / ngữ cảnh nhiều lượt (A2/A4).
4. Thực nghiệm chính thức + điền Chương 3.
