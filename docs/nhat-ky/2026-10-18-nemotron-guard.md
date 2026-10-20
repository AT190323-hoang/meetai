# Nhật ký 17–18/10/2026 — Tích hợp Nemotron Safety Guard

## Mục tiêu phiên
Tích hợp NVIDIA Nemotron làm guardrail cho AI agent — ban đầu chỉ hậu kiểm, sau mở rộng sang luồng hội thoại realtime.

## Diễn biến chính

### 1. Khảo sát
- Đọc đề cương + báo cáo đồ án; đối chiếu với model card Nemotron → phát hiện đề cương mô tả sai taxonomy (S1–S5, S4 = Jailbreak) và Nemotron không hỗ trợ chính thức tiếng Việt.
- Phân tích khả năng đưa Nemotron vào luồng realtime: âm thanh không đi qua server → chỉ kiểm được ở tầng văn bản (transcript). Hai phương án: chặn trước (+0.6–1.8 s/lượt) hoặc giám sát song song → **chọn song song** (xem quyết định D1 trong `safety-guard.md`).
- Làm rõ nguồn transcript: realtime lấy từ phiên OpenAI (sự kiện), hậu kiểm lấy từ transcript của Stream qua Inngest.

### 2. Đo đạc trước khi làm
- Nemotron qua API NVIDIA: ~0.6 s (an toàn) / ~1.1–1.4 s (vi phạm). Bắt đúng câu bom cả EN lẫn VI.
- **Phát hiện:** Nemotron không bắt jailbreak; NemoGuard JailbreakDetect chỉ bắt DAN dài tiếng Anh → thêm bộ phân loại gpt-4o-mini, đúng 11/11.

### 3. Xây dựng
- `src/lib/nemotron.ts` — gọi Nemotron, prompt theo model card, fail-open.
- `src/lib/jailbreak.ts` — NemoGuard JailbreakDetect + bộ phân loại LLM.
- `src/lib/safety-events.ts` — chạy 3 detector song song, lưu kết quả, gắn cờ meeting.
- `src/lib/realtime-guard.ts` — shadow guard trong cuộc gọi.
- Webhook: bật chép lời người dùng, gắn guard, guard 2 lớp cho chat.
- Inngest: function `meetingsSafetyAudit`.
- Schema: `meetings.safety_status`, bảng `safety_events`.

### 4. Test thật & các lỗi phát hiện được
Các lỗi **có sẵn từ trước** (không do guard), lộ ra khi test:

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Agent rời cuộc gọi sau ~12–15 s, guard không ghi gì | Webhook Stream trỏ về **Vercel**; function serverless hết hạn → mất kết nối agent | Trỏ webhook về ngrok khi test local |
| `PUT /api/inngest 400` liên tục | Inngest dev chặn SDK 3.52.5 (CVE-2026-42047) | Nâng `inngest` → 3.54.2 |
| `bufferUtil.mask is not a function` | webpack đóng gói `ws` hỏng → instructions + guard không bao giờ được nạp | `serverExternalPackages` trong `next.config.ts` |
| `Missing required parameter: 'session.type'` → agent bị ngắt | `@stream-io/openai-realtime-api` 0.3.3 dùng giao thức beta, OpenAI nay dùng GA | Nâng lên 0.4.2; guard nghe thêm tên sự kiện GA |
| Agent ở lại nhưng không trả lời | Client GA gửi `turn_detection: null` → tắt VAD | Truyền `turn_detection: { type: "server_vad" }` |

**Hệ quả quan trọng:** trước khi sửa, agent (cả local lẫn Vercel) **chưa từng nhận được instructions** người dùng cấu hình.

Lỗi do guard và đã sửa:
- Gửi `response.create` ngay sau `response.cancel` có thể gây lỗi → xếp hàng chờ `response.done`.
- Bộ phân loại LLM gắn nhầm "yêu cầu độc hại" là jailbreak → chỉnh prompt.
- Log nhầm lẫn nhóm vi phạm giữa user/agent → log rõ từng bên.
- Mất bản ghi do timeout Neon → thử lại 1 lần.

### 5. Kết quả
Cuộc gọi thật: agent trả lời đúng vai, guard chặn đúng jailbreak tiếng Việt (chỉ bộ LLM bắt được), các câu về bom, và cắt câu trả lời đang phát mà không làm rớt agent. Chi tiết: `safety-guard.md` mục 7.

## Thay đổi phụ thuộc
- `inngest` 3.52.5 → 3.54.2
- `@stream-io/openai-realtime-api` 0.3.3 → 0.4.2

## Script thử nghiệm (scratchpad, chưa đưa vào repo)
- `nemotron-latency.mjs` — đo độ trễ Nemotron
- `nemotron-jailbreak.mjs` — thử nhóm S24 tùy chỉnh
- `jailbreak-detect.mjs`, `jailbreak-long.mjs` — thử NemoGuard
- `test-jailbreak.mts`, `test-guard.mts` — thử detector của dự án

→ Nên đưa vào repo (`scripts/eval/`) khi làm bộ thử nghiệm cho Chương 3.

## Còn mở
Xem `docs/van-de-mo.md`.
