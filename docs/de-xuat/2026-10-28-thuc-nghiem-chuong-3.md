# Đề xuất: thực nghiệm chính thức cho Chương 3 (28/10/2026)

> Trạng thái: **chờ người dùng duyệt**. Bám theo khung đã viết trong đồ án (mục 3.2.1 và 3.2.2, bảng 3.2–3.4), phần "Kết quả" hiện còn trống.

## 1. Lệch giữa đồ án và hệ thống hiện tại (cần sửa khi viết kết quả)

| Đồ án đang ghi | Hiện tại |
|---|---|
| 3.2.1: cấu hình B "kiểm duyệt song song (mặc định)"; kỳ vọng độ trễ A/B "chênh lệch không đáng kể" | Mặc định là **strict có giới hạn 2 s** (A2, 28/10) → so sánh **3 cấu hình**: tắt guard / shadow / strict; strict chậm hơn có chủ đích |
| Bộ phân loại jailbreak "dựa trên gpt-4o-mini" (Ch. 2, 3.2.2, bảng 3.5) | `gpt-5.6-luna` (gpt-4o-mini bị OpenAI tắt 01/2027); thêm detector `vn_policy` |
| "Ba bộ phát hiện" | Bốn: content safety, NemoGuard, `jailbreak_llm`, `vn_policy` |
| Chỉ số "tỷ lệ can thiệp kịp thời (`caught_in_time`)" | Ở strict, nghĩa là "quyết định trước khi agent nói"; thêm chỉ số **tỷ lệ quyết định trước T** (bảng `guard_turns`) |
| Kỳ vọng nhóm 6 (nhiều lượt): "hậu kiểm ghi nhận toàn bộ chuỗi" | A4: chỉ kiểm từng lượt; hậu kiểm không phân tích chuỗi (đã sửa ý này trong đề xuất A4) |

## 2. Giai đoạn 1 — thực nghiệm văn bản (không cần gọi, chạy được ngay)

Đúng bước "chạy thêm bộ câu dạng văn bản trực tiếp qua các bộ phát hiện" của 3.2.2, nhưng làm thành thực nghiệm chính, vì tách được ảnh hưởng của chép lời và lặp lại được.

**Bộ dữ liệu** `scripts/thuc-nghiem/dataset/chuong3.json`: 7 nhóm của bảng 3.3, **mỗi câu có bản tiếng Việt và tiếng Anh**, có nhãn kỳ vọng (an toàn / vi phạm, detector kỳ vọng):

| Nhóm | Nội dung | Số câu (× 2 ngôn ngữ) |
|---|---|---|
| 1 | Câu bình thường | 15 |
| 2 | Nhạy cảm nhưng hợp lệ (chặn nhầm) | 15 |
| 3 | Nội dung độc hại (vũ khí, hack, lừa đảo, ma túy, bạo lực…) | 20 |
| 4 | Jailbreak (bỏ qua chỉ dẫn, lộ system prompt, mạo danh, nhập vai, giả định) | 15 |
| 5 | Ép agent sinh nội dung xấu (qua câu chuyện, vai diễn) | 10 |
| 6 | Tấn công nhiều lượt (chuỗi 3 lượt) | 5 chuỗi |
| 7 | Tấn công qua chat sau họp | 8 |
| + | `vn_policy` (chủ quyền, lịch sử, kích động, bôi nhọ + câu hợp lệ) | 15 |
| + | Câu trả lời của agent (từ chối đúng, nội dung có hại, sai lập trường) cho `checkAgentReply` | 20 |

Tổng ≈ 230 câu. Câu độc hại chỉ là **yêu cầu**, không chứa cách làm cụ thể; câu agent có hại viết chung chung (như bộ H1–H4 đã dùng).

**Script** `scripts/thuc-nghiem/chuong3-offline.mjs`: đọc prompt và cấu hình từ code (như các script khảo sát), chạy 4 detector giống `checkUserInput` / `checkAgentReply`, 3 lần mỗi câu. Xuất:
- Bảng 3.4: tỷ lệ phát hiện theo từng detector và cả lớp, tỷ lệ chặn nhầm (nhóm 1–2), chênh lệch Anh – Việt, độ trễ p50/p90/max theo detector, độ ổn định giữa các lần chạy.
- Ma trận nhóm × detector (detector nào bắt nhóm nào — chứng minh vì sao cần 4 detector).
- File CSV + bảng Markdown vào `docs/thuc-nghiem/ket-qua-chuong3.md` để chép vào đồ án.

**Chi phí ước tính:** OpenAI (`gpt-5.6-luna`, 2 detector) ≈ 1.400 lượt ≈ **0,2–0,3 USD**. Nemotron + NemoGuard qua NVIDIA (credit miễn phí). Không gọi model realtime.

## 3. Giai đoạn 2 — thực nghiệm trong cuộc gọi (gộp vào buổi test sau)

Một tập con của bộ dữ liệu (≈ 20 câu Việt, 10 câu Anh) đọc trong cuộc gọi thật:
- **3.2.1 độ trễ:** cùng bộ câu với 3 cấu hình `REALTIME_GUARD=off` / `shadow` / strict (mặc định); số đo tự động từ `guard_turns` (ngừng nói → agent nói, chép lời, guard) — không cần bấm giờ tay.
- **3.2.2 trong cuộc gọi:** tỷ lệ phát hiện qua giọng nói so với văn bản → **sai lệch do chép lời** (đối chiếu bản chép lời với câu gốc); tỷ lệ quyết định trước T; agent có bị cắt / có từ chối không.
- **Tóm tắt:** chấm 1–5 theo bảng 3.2 cho các cuộc gọi trên.
- Script tổng hợp đọc DB theo danh sách meeting.
- Chi phí ước tính: ~15–20 phút gọi ≈ **2–4 USD** với `gpt-realtime-2.1` (nên dùng bản đầy đủ khi đo cho đồ án). Nên chạy trên EC2 (A3) để tránh nghẽn mạng máy dev; nếu chạy trên máy dev thì ghi rõ giới hạn.

## 4. Cần người dùng quyết

1. Duyệt kích thước bộ dữ liệu (≈ 230 câu) hay muốn nhỏ/lớn hơn.
2. Mình soạn câu, người dùng duyệt lại danh sách trước khi chạy (đề xuất), hay chạy luôn.
3. Giai đoạn 2 làm trên máy dev (sớm, có nhiễu mạng) hay đợi EC2.
