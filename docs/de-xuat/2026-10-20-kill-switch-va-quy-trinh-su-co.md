# Đề xuất: Kill-switch, cách ly hậu kỳ và quy trình phản ứng sự cố

> Ngày: 20/10/2026. Trạng thái: **đã chốt 21/10/2026** (xem mục 6). Mức chặn theo [A1](2026-10-21-chinh-sach-phan-muc-vi-pham.md).
> Ghi chú: góp ý dựa trên code và tài liệu hiện có, chưa đối chiếu với đề cương gốc. Cần dán phần ý định ban đầu của kill-switch để đối chiếu.

## 1. "Kill-switch" đang gộp ba việc khác nhau

| Tầng | Việc | Hiện trạng |
|---|---|---|
| Ngăn chặn realtime | Cắt lời agent, ngắt agent hoặc kết thúc call khi vi phạm lặp lại | Mới có cắt lời và từ chối, chưa có leo thang |
| Cách ly hậu kỳ | Ẩn summary, recording, transcript của meeting `flagged` | Chưa làm |
| Xử lý chủ thể | Khóa agent hoặc người dùng | Chưa làm, nên để ngoài phạm vi |

Đề xuất đặt tên: tầng 2 là **quarantine (cách ly)**, "kill-switch" dành cho tầng 1. Câu chữ trong đồ án sẽ rõ hơn.

## 2. Góp ý chính

1. **Ẩn trên UI chưa phải kiểm soát an toàn.**
   - `meetings.getOne` vẫn trả `summary`, `transcriptUrl`, `recordingUrl`. Các URL này là link Stream, ai có link đều mở được.
   - Việc chặn phải nằm ở server: procedure không trả các trường đó khi `flagged`. UI chỉ hiển thị cảnh báo.
   - Chat sau cuộc họp cũng dùng `summary` làm ngữ cảnh, nên phải chặn cả ở đó.

2. **Có thể có lỗ hổng stored injection.**
   - Người dùng jailbreak trong call, transcript chứa payload. Inngest đưa payload vào summary, rồi chat đưa summary vào prompt GPT.
   - Hiện hậu kiểm chạy song song với summary, nên summary vẫn được tạo từ nội dung đã bị flag.
   - Quarantine nên chặn cả chuỗi này (bỏ qua summary, hoặc không nạp summary vào chat khi `flagged`). Đáng viết vào Chương 2 hoặc 3.

3. **Mô hình đe dọa chưa rõ: ẩn khỏi ai?**
   - Code chưa có vai trò admin hay reviewer, và người tạo meeting thường chính là người vi phạm.
   - Hai hướng: (a) ẩn khỏi owner với cơ chế "xem sau khi xác nhận cảnh báo"; (b) thêm vai trò reviewer tối thiểu.
   - Nghiêng về (a) cho đồ án, vì (b) kéo theo cả hệ phân quyền.

4. **False positive quyết định thiết kế.**
   - Ví dụ S9 chặn câu "đọc số điện thoại". Nếu `flagged` tự ẩn hết nội dung thì UX hỏng.
   - Kill-switch phụ thuộc A1: chỉ nhóm mức cao mới kích hoạt quarantine, mức thấp chỉ ghi nhận.
   - Cần thao tác **review**: xác nhận vi phạm, hoặc bỏ cờ (dismiss) khi là false positive. Hành động review cũng được ghi lại.

5. **Leo thang theo ngưỡng.**
   - Một lần vi phạm thì từ chối. Vi phạm lặp lại N lần trong một meeting thì agent rời call hoặc kết thúc call, rồi cách ly.
   - Rẻ và hợp tên "kill-switch" nhất: chỉ cần đếm `safety_events` trong `realtime-guard.ts`.

6. **Mâu thuẫn giữa bằng chứng và ẩn danh PII.** `safety_events` cần giữ nội dung làm bằng chứng, trong khi mục 4.5 muốn ẩn danh PII trước khi lưu. Cần chốt: lưu nội dung gốc có thời hạn, hay lưu bản đã che và hash.

## 3. Khung quy trình phản ứng sự cố (bám NIST SP 800-61)

**Phát hiện** (3 detector) → **Phân loại mức** (A1) → **Ngăn chặn** (từ chối, ngắt call) → **Bảo toàn bằng chứng** (`safety_events` chỉ thêm, không sửa) → **Rà soát** (trang sự kiện, xác nhận hoặc dismiss) → **Khắc phục** (mở lại, giữ cách ly hoặc xóa) → **Rút kinh nghiệm** (chỉnh ngưỡng dựa trên số liệu).

Số liệu thu được cho Chương 3: thời gian từ vi phạm đến khi ngăn chặn, `caught_in_time`, tỷ lệ cách ly nhầm.

## 4. Phạm vi gợi ý

- **Bắt buộc:** chặn ở server (trường `summary`/URL), banner cảnh báo, trang liệt kê sự kiện, nút review/dismiss có ghi log.
- **Nên làm:** leo thang ngắt call sau N vi phạm.
- **Để sau hoặc ghi là hướng phát triển:** vai trò admin, khóa tài khoản, thông báo.

## 5. Câu hỏi cần chốt

1. Quarantine ẩn khỏi ai: owner có "xem sau khi xác nhận", hay cần reviewer riêng? (Quyết định hầu hết phần còn lại, nên bàn trước.)
2. Có làm leo thang ngắt call (mục 2.5) không, ngưỡng N là bao nhiêu?
3. Dismiss false positive có cho owner tự làm không? Nếu có, kẻ vi phạm tự gỡ cờ được, nên có thể cần giới hạn.
4. Lưu nội dung gốc hay bản đã che trong `safety_events`?
5. A1 (chính sách phân mức) phải bàn cùng lúc, vì ngưỡng quarantine phụ thuộc vào nó.

## 6. Quyết định (21/10/2026)

**Q1 — Cách ly ẩn khỏi ai:** chọn hướng (a). Không thêm vai trò reviewer.
- Owner (người tạo meeting, cũng là người nói chuyện với agent) bị ẩn summary, transcript, recording khi meeting `flagged`.
- Owner bấm **xác nhận đã vi phạm** thì xem lại được. Lần xác nhận được ghi lại (ai, lúc nào). Cờ `flagged` **giữ nguyên**.
- Chặn ở **server**: `meetings.getOne`, `meetings.getMany`, `meetings.getTranscript` không trả `summary` / `transcriptUrl` / `recordingUrl` / transcript khi meeting flagged mà chưa xác nhận. UI chỉ hiển thị cảnh báo và nút xác nhận.
- Sau khi xác nhận, owner xem được nội dung và danh sách các câu bị gắn cờ kèm nhóm vi phạm (trang liệt kê sự kiện).
- Trong đồ án phải nói rõ: việc ẩn **không phải hàng rào chặn owner**. Giá trị nằm ở: người dùng biết mình bị ghi nhận, có bằng chứng xác nhận, chặn ở server, cắt đường stored injection.

**Q2 — Leo thang trong cuộc gọi:**
- Vi phạm 1–4: từ chối như hiện tại.
- Vi phạm thứ 5: từ chối + **cảnh báo** "nếu tiếp tục vi phạm, cuộc trò chuyện sẽ bị kết thúc".
- Vi phạm thứ 9: **cảnh báo lần cuối**.
- Vi phạm thứ 10: **kill-switch**: agent nói câu kết thúc, server kết thúc cuộc gọi cho mọi người, meeting bị cách ly.
- **Cách đếm:** số **lượt nói của người dùng** bị kết luận unsafe (mỗi câu tính 1 lần dù nhiều detector bắt). Vi phạm của agent không tính. Chỉ đếm các nhóm thuộc **mức chặn** theo A1.
- Ngưỡng cấu hình qua biến môi trường `SAFETY_WARN_AT=5`, `SAFETY_KILL_AT=10` (cảnh báo lần cuối ở `SAFETY_KILL_AT - 1`). Khi demo có thể hạ thấp mà không sửa code.

**Q3 — Gỡ cờ (dismiss):** owner **không** tự gỡ cờ được, vì người vi phạm sẽ tự xóa dấu vết. Dismiss false positive để ở hướng phát triển (khi có vai trò reviewer).
- **Chat sau họp bị khóa vĩnh viễn** với meeting `flagged` (lựa chọn A), kể cả sau khi xác nhận. Webhook `message.new` không gọi GPT, UI ẩn ô nhập và hiện thông báo khóa.
  - Lý do: chat đưa `summary` vào system prompt mà guard chat không kiểm summary → payload trong transcript bị flag có thể lọt vào summary rồi "cài" vào agent (stored injection).
  - Hướng phát triển (lựa chọn B): hậu kiểm chạy trước khi tóm tắt, loại các lượt bị gắn cờ để tạo summary "sạch" rồi mở lại chat.

**Q4 — Bằng chứng:** tạm giữ **nội dung gốc** trong `safety_events` (cần cho phân tích false positive ở Chương 3). Ghi rõ là đánh đổi với mục 4.5 (ẩn danh PII), ẩn danh để hướng phát triển.

**Q5 — Phụ thuộc A1:** chỉ vi phạm thuộc **mức chặn** mới làm meeting `flagged` (kích hoạt cách ly + khóa chat) và được tính vào ngưỡng Q2. Vi phạm mức thấp chỉ ghi nhận. A1 đã chốt ngày 21/10, xem [2026-10-21-chinh-sach-phan-muc-vi-pham.md](2026-10-21-chinh-sach-phan-muc-vi-pham.md).

## Liên quan

- [van-de-mo.md](../van-de-mo.md): A1, A4, mục B (kill-switch, trang sự kiện, ẩn danh PII)
- [2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md](2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md)
