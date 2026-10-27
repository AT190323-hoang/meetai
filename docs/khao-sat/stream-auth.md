# Khảo sát và sửa: phân quyền Stream (chat + video)

> Ngày: 21/10/2026. Nhánh `feat/stream-auth` (tách từ `feat/vn-policy`). Trạng thái: **đã sửa code và cấu hình Stream, đã kiểm chứng bằng script; chờ test giao diện + cuộc gọi thật**.

## 1. Lỗ hổng tìm thấy

Chat và Video dùng **chung một Stream app**. Quyền đọc trực tiếp từ API (`getCallType("default")`, `getChannelType("messaging")`).

| # | Lỗ hổng | Bằng chứng | Hậu quả |
|---|---|---|---|
| 1 | Mọi người dùng được upsert với role **`admin`** trên Stream Chat (`generateChatToken`) | `admin` của kênh `messaging` có `read-channel`, `create-message`, `delete-channel`, `truncate-channel` không giới hạn chủ sở hữu | Người dùng A **đọc, ghi, xóa chat của người dùng B**, gồm cả tóm tắt cuộc họp agent trả lời |
| 2 | Mọi người dùng là **`admin`** trên Stream Video (`generateToken`) | `admin` có `delete-call`, `delete-recording`, `kick-user`, `update-call` | Xóa được cuộc gọi, recording của người khác |
| 3 | Role **`user`** mặc định của call type `default` quá rộng | `user` có `join-call`, `read-call`, `list-recordings`, `list-transcriptions`, `end-call`… cho **mọi** cuộc gọi | Biết ID meeting là vào được cuộc gọi, liệt kê recording/transcript → **vượt qua cơ chế cách ly (A5)**. Đổi role sang `user` thôi là **chưa đủ** |
| 4 | Webhook chat không kiểm tra người gửi | `message.new` trả lời mọi người nhắn vào kênh có ID trùng meeting | Tạo trước kênh với ID meeting của nạn nhân → nhận tóm tắt cuộc họp của nạn nhân |
| 5 | Token chat không hết hạn | `createToken(userId)` không có `exp` | Lộ một lần là dùng mãi |
| 6 | Lỗi phụ: upsert agent bằng `existingAgent.userId` | `meetings.create` | Ghi đè hồ sơ Stream của chủ meeting bằng tên agent |

Đính chính: `validity_in_seconds` truyền sai nhưng **vô hại** — SDK bỏ qua khi đã có `exp`, token video vẫn hết hạn sau 1 giờ.

## 2. Cách sửa

**Code** (`src/modules/meetings/server/procedures.ts`, `src/app/api/webhook/route.ts`, `call-connect.tsx`, `chat-ui.tsx`):
- Role **`user`** cho cả chat và video; token chat hết hạn sau 1 giờ.
- **Server tạo kênh chat** (`prepareChatChannel`) sau khi kiểm tra quyền sở hữu, chủ meeting là thành viên; client chỉ `watch`. Meeting `flagged` bị từ chối.
- `generateToken` nhận `meetingId`, kiểm tra quyền sở hữu, cấp **call token** chỉ dùng cho `default:<meetingId>`.
- Tạo cuộc gọi với chủ meeting và agent là thành viên, **role `call_member` ghi rõ**. Webhook `call.session_started` thêm agent làm `call_member` cho các cuộc gọi tạo trước bản sửa (không chặn nếu lỗi).
- Webhook chat chỉ trả lời **chủ meeting**.
- Sửa upsert agent (`existingAgent.id`), bỏ `validity_in_seconds`.

**Cấu hình Stream** (`scripts/thuc-nghiem/stream-restrict-user-role.cjs`, chạy 21/10):
- Role `user` của call type `default` chỉ còn: `block-user-owner`, `create-call-reaction`, `enable-noise-cancellation-any-team`, `kick-user-owner`, `mute-users-owner`, `pin-call-track-owner`, `update-call-owner`, `update-call-permissions-owner`, `update-call-settings-owner`. Các role khác **không đổi**.
- Bản sao lưu: `scripts/thuc-nghiem/stream-call-type-default-grants.backup.json`. Khôi phục: chạy script với `--rollback`.
- Ảnh hưởng tới bản production trên Vercel: không đáng kể (code cũ cấp role `admin`; webhook đang trỏ về ngrok).

**Phát hiện khi kiểm chứng:** thêm thành viên bằng `updateCallMembers` **không ghi role** thì thành viên nhận role toàn cục (`user`) và bị từ chối. Phải ghi rõ `role: "call_member"`. Đã sửa trong code.

## 3. Kiểm chứng (`scripts/thuc-nghiem/stream-access-check.cjs`)

Script tạo người dùng, kênh và cuộc gọi **dùng một lần** (không chạm meeting thật), thử bằng token như app cấp, rồi xóa.

| Ai | Hành động | Trước | Sau |
|---|---|---|---|
| Kẻ xâm nhập, chat role `admin` (code cũ) | Đọc / ghi chat của chủ meeting | ✅ được | (không còn cấp role này) |
| Kẻ xâm nhập, chat role `user` | Đọc / ghi chat của chủ meeting | – | ❌ bị từ chối |
| Kẻ xâm nhập, video role `admin` (code cũ) | Đọc cuộc gọi, liệt kê recording, vào cuộc gọi | ✅ được | (không còn cấp role này) |
| Kẻ xâm nhập, video role `user` | Đọc cuộc gọi, liệt kê recording, vào cuộc gọi | ✅ **được** | ❌ bị từ chối (403) |
| Chủ meeting (call token) | Đọc và vào cuộc gọi của mình | ✅ | ✅ |
| Chủ meeting (call token), **cuộc gọi cũ không có thành viên** | Vào cuộc gọi | – | ✅ |
| Agent (thành viên) | Vào cuộc gọi | ✅ | ✅ |
| Agent được thêm làm `call_member` vào **cuộc gọi cũ** | Vào cuộc gọi | – | ✅ |
| Chủ meeting (chat role `user`, thành viên) | Đọc chat của mình | ✅ | ✅ |

16/16 phép thử đúng kỳ vọng. Mạng tới Stream ở máy dev chập chờn (timeout mặc định 3 s của SDK); script dùng timeout 30 s và chạy lại khi lỗi mạng.

## 4. Còn lại

- **Test thật:** vào cuộc gọi bằng trình duyệt (agent vào được, nói chuyện bình thường) và chat sau họp. Có trong kịch bản test của nhật ký 21/10.
- Kênh chat cũ do client tạo trước bản sửa: server `addMembers` chủ meeting khi mở chat (vô hại nếu đã là thành viên).
- Chương 2/3 của đồ án: đoạn "Stream token ràng buộc call_id" giờ đã đúng với code; nên thêm phần lỗ hổng phân quyền và bảng kiểm chứng này (bằng chứng tốt cho ngành An toàn thông tin).
