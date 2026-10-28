# Đề xuất: ẩn danh dữ liệu cá nhân (PII) trước khi lưu (28/10/2026)

> Trạng thái: **chờ người dùng quyết**. Đồ án (mục 3.1.4) ghi "ẩn danh dữ liệu cá nhân trước khi lưu trữ lâu dài… đã được thiết kế và đang hoàn thiện"; đề cương (mục 4.5) cũng nhắc. Code hiện **chưa** ẩn danh.

## Hiện trạng: PII nằm ở đâu

| Nơi lưu | Ai giữ | Có PII nguyên văn? | Ẩn danh được? |
|---|---|---|---|
| `transcript_items` (transcript tiếng Việt) | DB của mình | Có | Có — lúc ghi |
| `safety_events.content` (bằng chứng kiểm duyệt) | DB của mình | Có (vd. số điện thoại người dùng đọc) | Có — lúc ghi |
| `meetings.summary` | DB của mình | Có thể (model tóm tắt chép lại số) | Có — dặn model + lọc kết quả |
| Tin nhắn chat sau họp | **Stream Chat** | Có | Không (dữ liệu nằm ở Stream) |
| Bản chép lời, bản ghi hình của Stream | **Stream** | Có (cả âm thanh) | Không |

Guard **phải đọc bản gốc** để đánh giá, nên chỉ ẩn danh **khi lưu**, không ẩn trước khi kiểm.

## Đề xuất

1. **Loại PII ẩn bằng mẫu nhận dạng** (đáng tin, không tốn API): số điện thoại Việt Nam (cả dạng có dấu cách / gạch nối, +84), email, số CCCD / CMND (9 / 12 chữ số), số thẻ ngân hàng (13–19 chữ số, kiểm tra Luhn), số tài khoản ngân hàng khi đi kèm từ "tài khoản / STK".
2. **Không ẩn tên người và địa chỉ:** cần mô hình nhận dạng thực thể, dễ ẩn nhầm và thêm độ trễ / chi phí → ghi là giới hạn.
3. **Cách thay:** giữ loại, bỏ giá trị: `[số điện thoại]`, `[email]`, `[CCCD]`, `[số thẻ]`, `[số tài khoản]`. Giữ 2–3 chữ số cuối (vd. `[số điện thoại …123]`) nếu muốn đối chiếu bằng chứng.
4. **Áp dụng khi ghi:** `transcript_items`, `safety_events.content`, `summary` (thêm dặn model tóm tắt không chép PII, rồi lọc lại kết quả).
5. **Ngoài phạm vi (ghi vào đồ án là giới hạn):** dữ liệu ở Stream (chat, bản chép lời, bản ghi hình); muốn xử lý phải đặt chính sách lưu trữ / xoá phía Stream.
6. Kiểm chứng: script tự kiểm với bộ câu có / không có PII (không gọi API), cộng một dòng trong test gộp.

## Cần người dùng quyết

1. Danh sách loại PII ở mục 1 đủ chưa (thêm / bớt)?
2. Thay hoàn toàn (`[số điện thoại]`) hay giữ vài chữ số cuối?
3. Có áp dụng cho `safety_events` (bằng chứng) không — Chương 3 cần đọc lại câu bị chặn, nhưng số điện thoại không ảnh hưởng việc phân tích.
4. Trang quản trị theo dõi vi phạm mà đồ án nhắc: làm (vai trò admin, danh sách meeting bị gắn cờ) hay sửa đồ án thành "hướng phát triển" như quyết định A5?
