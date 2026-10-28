# Transcript tiếng Việt từ phiên realtime (28/10/2026)

> Trạng thái: **đã code trên `feat/vn-transcript`, tự kiểm bằng script đạt; chờ test gộp** (`kiem-thu/cho-test-gop.md`).

## Vấn đề

Tab Transcript, summary và kiểm duyệt hậu kỳ dùng bản chép lời của **Stream** (`language: "en"`, Stream không hỗ trợ tiếng Việt) → bản dịch tiếng Anh méo ("tích phân" → "Tick Fun"). Trong phiên agent đã có bản tiếng Việt từ OpenAI: lời người dùng (`gpt-4o-mini-transcribe`, `language: vi`, đang chạy cho guard) và lời agent (văn bản model sinh ra cho chính câu nó nói).

## Quyết định (người dùng duyệt 28/10)

- Lưu bản tiếng Việt theo từng lượt; **tab Transcript và summary dùng bản này**, bản Stream làm dự phòng (cuộc gọi cũ, `REALTIME_GUARD=off`).
- **Kiểm duyệt hậu kỳ giữ bản Stream:** là lần chép lời độc lập, bắt được câu mà bản OpenAI chép sai (28/10: "chế tạo bom" → "chế tạo bông" lọt guard, Stream ghi "bomb maker").
- Dòng chép sai (chữ Ả Rập, Hàn…) hiện nguyên văn — transcript là bằng chứng.
- Không sửa logic guard: phần ghi chép là module riêng, chỉ nghe sự kiện, không gửi lệnh nào cho phiên.

## Thăm dò sự kiện qua proxy Stream (cuộc gọi dùng một lần, 28/10)

- **Không có** `response.output_audio.delta`: proxy Stream giữ phần âm thanh → không tính được độ dài âm thanh.
- **Có** `output_audio_buffer.started` / `stopped` kèm `response_id`: thời điểm agent bắt đầu / ngừng phát ra loa.
- Câu nói hết: văn bản xong sau 0,7 s nhưng phát tới 5,5 s → văn bản chạy trước âm thanh rất xa.
- Câu bị huỷ: không có `stopped`; `response.done` có `status: "cancelled"` và văn bản đã sinh (dài hơn phần đã phát).

## Cách làm

- Bảng `transcript_items` (meeting, người nói, vai trò, nội dung, `start_ms`/`end_ms` tính từ lúc agent vào cuộc gọi, `interrupted`).
- `src/lib/transcript-recorder.ts`, gắn cạnh guard trong webhook:
  - lời người dùng: ghi khi có bản chép lời (thời điểm bắt đầu / ngừng nói từ VAD);
  - câu agent nói hết: ghi nguyên văn khi `output_audio_buffer.stopped`; đo **tốc độ nói** (từ / giây) từ các câu này;
  - câu agent bị huỷ: thời gian đã phát (`started` → huỷ) × tốc độ nói → cắt văn bản, thêm "…", `interrupted = true`; chưa phát gì thì không ghi.
- `src/lib/transcript.ts` (`getRealtimeTranscript`): đọc theo thời gian, gộp các dòng liên tiếp cùng người nói (VAD tách câu).
- `meetings.getTranscript` và summary (Inngest) dùng bản này nếu có. Prompt tóm tắt chỉ nhắc "bản dịch tiếng Anh" khi phải dùng bản Stream.

## Tự kiểm (`scripts/thuc-nghiem/transcript-recorder-check.ts`)

Phát lại chuỗi sự kiện thật trên client giả, ghi vào một meeting cũ rồi xoá: 6/6 đạt — câu nói hết ghi đủ; câu bị tách gộp lại; câu bị huỷ sau 2 s cắt còn 8 từ ("Lịch sử toán học bắt đầu từ thời…") với tốc độ đo được 3,5 từ/giây; câu chưa phát không ghi; đúng thứ tự thời gian.

## Giới hạn

- Phần câu bị huỷ là **ước tính** theo tốc độ nói trung bình, có thể lệch vài từ.
- Thời gian tính từ lúc agent vào cuộc gọi, không khớp tuyệt đối với bản ghi hình của Stream.
