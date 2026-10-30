# PHỤ LỤC


Mã nguồn ứng dụng: https://github.com/AT190323-hoang/meetai

Mã nguồn lớp kiểm duyệt nằm trong thư mục `src/lib`: `nemotron.ts` (content safety), `jailbreak.ts` (hai bộ phát hiện jailbreak), `vn-policy.ts` (chính sách nội dung Việt Nam), `safety-policy.ts` (phân mức xử lý, kill-switch), `safety-events.ts` (điều phối và lưu vết), `realtime-guard.ts` (kiểm duyệt trong cuộc gọi), `pii.ts` (bảo vệ dữ liệu cá nhân), `transcript-recorder.ts` (bản chép lời tiếng Việt). Hậu kiểm và tóm tắt nằm trong `src/inngest/functions.ts`; kiểm duyệt kênh chat nằm trong `src/app/api/webhook/route.ts`. Bộ dữ liệu và các script thực nghiệm nằm trong thư mục `scripts/thuc-nghiem`.
