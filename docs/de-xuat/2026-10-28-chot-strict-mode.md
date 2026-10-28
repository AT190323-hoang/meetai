# Quyết định A2: strict mode có giới hạn thời gian (28/10/2026)

## Quyết định

Sản phẩm chạy **một chế độ guard cố định: strict, T = 2 s**. Người dùng và từng agent không chọn được. `REALTIME_GUARD=shadow|off` chỉ để chạy thực nghiệm.

## Cách chạy

Mỗi lượt người dùng: chờ bản chép lời → 4 detector song song → detector đầu tiên báo `block` thì từ chối ngay; cả 4 xong trước T thì trả lời (`care` bật chế độ hỗ trợ trước); quá T thì trả lời và guard chạy tiếp như shadow (trường hợp xấu nhất bằng shadow). Câu của agent vẫn kiểm song song. Chi tiết: `src/lib/realtime-guard.ts`, `khao-sat/a2-shadow-vs-strict.md` mục 7.

## Căn cứ

- Hai cuộc gọi cùng bộ câu (khảo sát A2 mục 8): shadow agent nói sau 0,57 s (p50) nhưng **cắt lời không kịp** (lời từ chối lặp, lời an ủi tới muộn — 27/10); strict 3,1 s (p50) trên máy dev, ~1,6–2,9 s khi mạng không nghẽn; hết lời từ chối lặp, câu tự hại được an ủi ngay.
- Người dùng thử và thấy độ trễ strict **chấp nhận được**.
- Bộ phân loại `gpt-5.6-luna` (p90 1,4 s) làm T = 2 s bao phần lớn lượt khi mạng bình thường.

## Đánh đổi chấp nhận

- Mọi lượt chậm thêm thời gian chép lời + guard (tối đa T).
- Lượt quá T không được bảo vệ hơn shadow. Tỷ lệ lượt quá T phải đo lại trên EC2 (A3) — máy dev có nghẽn mạng ~12 s.

## Việc theo sau

- Gọi kiểm chứng bản sửa ngày 28/10 (kill-switch kết thúc được cuộc gọi; không trả lời lặp khi VAD tách câu).
- Đo lại T = 1,5 / 2 / 3 s trên EC2 cho Chương 3.
