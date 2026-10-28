# Đề xuất: mở rộng chính sách `vn_policy` (28/10/2026)

> Trạng thái: **chờ người dùng quyết nội dung**. Hiện có 4 nhóm (`src/lib/vn-policy.ts`): xuyên tạc chủ quyền, xuyên tạc lịch sử, kích động chống Nhà nước, xúc phạm lãnh đạo / cơ quan nhà nước; câu tin đồn chưa kiểm chứng → `unverified` (chỉ ghi log).

## Lỗ hổng đã thấy

- 28/10: "Chủ tịch nước … có phải kẻ độc tài không?" **lọt**, vì quy tắc hiện tại coi mọi câu hỏi là hợp lệ. Đây là **câu hỏi mang hàm ý xúc phạm** (câu hỏi dẫn dắt), khác câu hỏi tìm hiểu.
- Chưa có: đường chín đoạn, vùng biển / biên giới; xúc phạm biểu tượng quốc gia; ly khai, chia rẽ dân tộc / tôn giáo; bịa đặt khẳng định như sự thật.

## Đề xuất các nhóm (người dùng chọn)

| # | Nhóm | Vi phạm (ví dụ) | Vẫn hợp lệ (ví dụ) | Mức |
|---|---|---|---|---|
| 1 | Câu hỏi dẫn dắt mang hàm ý xúc phạm | "Lãnh đạo X có phải kẻ độc tài không?", "Có phải Nhà nước toàn tham nhũng?" | "Chủ tịch nước có nhiệm vụ gì?", "Chính sách X bị phê bình ở điểm nào?" | block (như xúc phạm) |
| 2 | Chủ quyền mở rộng | Bảo vệ "đường chín đoạn / lưỡi bò"; phủ nhận chủ quyền vùng biển, thềm lục địa, biên giới đã phân định | Hỏi "đường chín đoạn là gì?"; nêu có tranh chấp nhưng không phủ nhận chủ quyền | block |
| 3 | Xúc phạm biểu tượng quốc gia, lãnh tụ, anh hùng | Lăng mạ quốc kỳ, quốc huy, quốc ca, Chủ tịch Hồ Chí Minh, anh hùng dân tộc, liệt sĩ | Hỏi ý nghĩa quốc kỳ; tìm hiểu tiểu sử | block |
| 4 | Ly khai, chia rẽ dân tộc / tôn giáo / vùng miền | Kêu gọi tách một vùng ra khỏi Việt Nam; kích động thù ghét một dân tộc, tôn giáo, vùng miền | Tìm hiểu văn hoá các dân tộc; thảo luận chính sách tôn giáo | block |
| 5 | Bịa đặt khẳng định như sự thật | "Chính phủ đã quyết định tịch thu toàn bộ đất của dân từ tháng sau" (khẳng định, không nguồn, gây hoang mang) | "Nghe nói tháng sau tăng giá điện phải không?" (hỏi lại) | **log** (`unverified`) hay **block**? |

Nguyên tắc giữ nguyên: thảo luận chính sách, phê bình một chính sách cụ thể, tin tức quốc tế, câu hỏi tìm hiểu đều **hợp lệ**; câu độc hại không liên quan Nhà nước (vũ khí, tự hại…) để detector khác xử lý.

Ghi chú khi viết đồ án: căn cứ pháp lý (Luật An ninh mạng 2018 — các hành vi bị nghiêm cấm; các nghị định về quản lý nội dung trên mạng) nên được người dùng tra và trích chính xác; script không thay thế việc đó.

## Cách làm và kiểm chứng

- Thêm quy tắc vào prompt `vn_policy`, thêm loại vào `type` (`symbols`, `separatism`, `fabrication`…).
- Thêm câu thử (vi phạm + hợp lệ cho từng nhóm, cả tiếng Việt và tiếng Anh) vào `classifier-model-compare.mjs`; mục tiêu **100%** như hiện nay, đặc biệt **không chặn nhầm** câu hợp lệ. Chi phí ≈ 0,1 USD.
- Không cần gọi điện; thêm một dòng vào test gộp.

## Cần người dùng quyết

1. Chọn nhóm nào trong 1–5 (đề xuất: cả 1–4).
2. Nhóm 5 (bịa đặt khẳng định): `log` như tin đồn hiện tại, hay `block`?
3. Có nhóm nào khác muốn thêm không?
