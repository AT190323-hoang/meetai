# Khảo sát: nâng cấp model OpenAI

> Ngày: 28/10/2026. Trạng thái: **kế hoạch duyệt 28/10; bước 2 đã code trên `feat/model-upgrade`, chờ test**. Nguồn: trang pricing và deprecations chính thức của OpenAI (đọc 28/10/2026).

## 1. Đang dùng gì, khi nào bị tắt

| Vai trò | Model hiện tại | Chỗ trong code | OpenAI tắt ngày | Thay thế OpenAI đề xuất |
|---|---|---|---|---|
| Agent cuộc gọi | `gpt-realtime` (mặc định của `@stream-io/openai-realtime-api` 0.4.2 = snapshot `2025-08-28`) | `connectOpenAi` trong `webhook/route.ts` (không truyền `model`) | **20/01/2027** | `gpt-realtime-2.1` |
| Chép lời người dùng trong cuộc gọi | `gpt-4o-mini-transcribe` | `webhook/route.ts` | 26/02/2027 | `gpt-transcribe` hoặc `gpt-live-transcribe` |
| Chat sau họp | `gpt-4o` | `webhook/route.ts` | **14/01/2027** | `gpt-6-luna` (theo trang deprecations) |
| Tóm tắt cuộc họp | `gpt-4o` (agent-kit) | `inngest/functions.ts` | **14/01/2027** | như trên |
| Phân loại `jailbreak_llm`, `vn_policy` | `gpt-4o-mini` | `lib/jailbreak.ts`, `lib/vn-policy.ts` (env ghi đè được) | **14/01/2027** | `gpt-6-luna` |
| Content safety, NemoGuard | NVIDIA Nemotron | `lib/nemotron.ts`, `lib/jailbreak.ts` | — | không đổi |

→ **Tất cả model OpenAI đang dùng sẽ bị tắt trong khoảng 3–4 tháng tới.** Phải đổi trước khi demo/bảo vệ nếu ngày đó sau 14/01/2027.

## 2. Bảng giá (USD / 1M token, Standard)

**Realtime (âm thanh chiếm phần lớn chi phí):**

| Model | Audio vào | Audio ra | Audio vào (cache) | Text vào / ra |
|---|---|---|---|---|
| `gpt-realtime` (đang dùng) | 32 | 64 | 0,40 | 4 / 16 |
| `gpt-realtime-2.1` | 32 | 64 | 0,40 | 4 / 24 |
| `gpt-realtime-2.1-mini` | 10 | 20 | 0,30 | 0,60 / 2,40 |

**Text:**

| Model | Vào | Ra | Ghi chú |
|---|---|---|---|
| `gpt-4o` (đang dùng) | 2,50 | 10 | sắp tắt |
| `gpt-4o-mini` (đang dùng) | 0,15 | 0,60 | sắp tắt |
| `gpt-6.1-terra` | 1 | 5 | "fast, efficient", có reasoning (mặc định `medium`) |
| `gpt-6.1-sol` | 2 | 10 | bậc cao hơn |
| `gpt-6-luna` | 0,10 | 0,50 | "most efficient, high-volume tasks", có reasoning (mặc định `medium`, tắt được bằng `none`) |

**Chép lời (USD / phút):** `gpt-4o-mini-transcribe` 0,003 · `gpt-transcribe` 0,0045 · `gpt-live-transcribe` 0,017.

## 3. Đánh đổi theo từng vai trò

**Agent cuộc gọi → `gpt-realtime-2.1`.**
- Giá âm thanh **không đổi**; chỉ text ra đắt hơn (24 so với 16), phần này rất nhỏ trong cuộc gọi thoại.
- OpenAI ghi cải thiện: nhận dạng chữ-số (số điện thoại, mã), xử lý im lặng / tiếng ồn, ngắt lời, làm theo chỉ dẫn, dùng công cụ; có reasoning chỉnh được (nguồn thứ ba nói mặc định `low`; mức cao làm tăng độ trễ). Không có số liệu riêng cho tiếng Việt → **phải tự đo bằng cuộc gọi thật**.
- `gpt-realtime-2.1-mini`: rẻ ~3 lần, chất lượng thấp hơn. Hợp làm phương án thực nghiệm so sánh trong Chương 3, chưa nên làm mặc định.

**Chat sau họp và tóm tắt → `gpt-6.1-terra`** (thay vì `gpt-6-luna` như OpenAI gợi ý cho `gpt-4o`).
- Rẻ hơn `gpt-4o` 2,5 lần mà là đời mới hơn; viết tốt hơn bậc luna. Chat cần độ trễ thấp → đặt `reasoning_effort` thấp (`low` hoặc `none`); tóm tắt chạy nền nên để mặc định.
- Nhân tiện có thể yêu cầu tóm tắt bằng tiếng Việt (vấn đề summary tiếng Anh, ngày 27/10).

**Phân loại `jailbreak_llm`, `vn_policy` → `gpt-6-luna`, `reasoning_effort: "none"`.**
- Rẻ hơn `gpt-4o-mini` 1,5 lần. Tắt reasoning để giữ độ trễ thấp — **độ trễ bộ phân loại quyết định chế độ strict (A2)**.
- Rủi ro lớn nhất: số đo hiện có (`vn_policy` 18/18 + 5/5, `jailbreak_llm` p50 1,07 s / p90 3,5 s) là của `gpt-4o-mini`. Đổi model = **đo lại toàn bộ**. Tham số cũng phải đổi (`max_tokens` → `max_completion_tokens`; `temperature` có thể không được nhận khi có reasoning).

**Chép lời trong cuộc gọi.** Giữ `gpt-4o-mini-transcribe` (tắt muộn nhất, 26/02/2027). Thử `gpt-transcribe` sau; trang của `gpt-live-transcribe` ghi không hỗ trợ endpoint `v1/realtime`, nên có thể không dùng được trong phiên của agent.

## 4. Độ phức tạp khi tích hợp

| Thay đổi | Sửa code | Rủi ro | Kiểm chứng |
|---|---|---|---|
| Agent cuộc gọi | 1 tham số `model` trong `connectOpenAi`. Thư viện 0.4.2 đã dùng giao thức GA, đúng giao thức của dòng 2.x. | Proxy `connect_agent` của Stream phải chấp nhận tên model mới (kiểu `RealtimeAPIModel` của thư viện chưa liệt kê 2.1 nhưng nhận chuỗi bất kỳ). Reasoning mặc định có thể làm chậm câu trả lời. | 1–2 cuộc gọi thật, so độ trễ và chất lượng tiếng Việt |
| Chat | Đổi tên model, thêm `reasoning_effort` | Thấp | Chạy lại phần A/C của checklist |
| Tóm tắt | Đổi tên model trong agent-kit (agent-kit 0.13 không gửi `max_tokens` nếu không đặt) | Thấp | 1 cuộc gọi, đọc summary |
| Bộ phân loại | Đổi env + sửa tham số API | Trung bình: phải đo lại | `vn-policy-survey.mjs`, bộ câu jailbreak, đo độ trễ |

Nên để tên model trong biến môi trường (như `VN_POLICY_MODEL` đang làm) để so sánh cũ/mới khi thực nghiệm.

## 5. Đề xuất thứ tự

1. Gộp các nhánh đã test vào `29-finish` (còn D1), rồi tách `feat/model-upgrade`.
2. Agent cuộc gọi → `gpt-realtime-2.1`; chat + tóm tắt → `gpt-6.1-terra` (kèm tóm tắt tiếng Việt). Test bằng cuộc gọi và chat.
3. Bộ phân loại → `gpt-6-luna`: đo lại độ chính xác và độ trễ, **gộp chung với khảo sát strict mode (A2)** vì cùng phụ thuộc độ trễ.
4. (Thực nghiệm Chương 3) so sánh `gpt-realtime-2.1` với `-mini` về chi phí, độ trễ, chất lượng.

## 6. Tiến độ

**Bước 1 (28/10):** đã gộp 4 nhánh vào `29-finish`, tách `feat/model-upgrade`.

**Bước 2 (28/10, chờ test):** tên model gom vào `src/lib/models.ts` (ghi đè bằng env).
- Kiểm tra tài khoản: `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-6.1-terra`, `gpt-6-luna` đều dùng được.
- Agent cuộc gọi: `connectOpenAi({ model: REALTIME_MODEL })`. Chưa đặt reasoning cho realtime (để mặc định); đo độ trễ khi test.
- Chat: `gpt-6.1-terra`, `reasoning_effort: "low"`. Thử một câu: `low` 3,0 s, `none` 2,4 s; chọn `low` vì chat đã chạy nền sau khi trả lời webhook.
- Tóm tắt: `gpt-6.1-terra`, prompt yêu cầu viết tiếng Việt và suy ra từ bị chép sai. Chạy thử trên transcript `nilQr…`: 8,8 s, 1.817 token vào / 629 ra; summary tiếng Việt đúng nội dung, tự hiểu "Tick Fun" là tích phân, ghi nhận đúng các đoạn từ chối và lập trường chủ quyền.

**Bước 3:** bộ phân loại → `gpt-6-luna` (chưa làm, gộp với khảo sát A2).
