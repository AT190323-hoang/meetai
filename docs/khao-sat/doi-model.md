# Khảo sát: nâng cấp model OpenAI

> Ngày: 28/10/2026. Trạng thái: **kế hoạch duyệt 28/10; bước 2 và 3 đã code và đo trên `feat/model-upgrade`; chờ một cuộc gọi thật**. Nguồn: trang pricing và deprecations chính thức của OpenAI (đọc 28/10/2026).

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


**Đo agent realtime qua Stream** (`scripts/thuc-nghiem/realtime-model-check.cjs`, 28/10): cuộc gọi dùng một lần, câu hỏi dạng chữ (không tính thời gian chép lời), đo tới đoạn transcript đầu tiên của agent (≈ lúc agent bắt đầu nói). 12 lượt mỗi cấu hình:

| Cấu hình | Hoàn thành | p50 | p90 |
|---|---|---|---|
| `gpt-realtime` (cũ) | 12/12 | 539 ms | 571 ms |
| `gpt-realtime-2.1` (mặc định) | 12/12 | 735 ms | 836 ms |
| `gpt-realtime-2.1`, reasoning `low` | 12/12 | 697 ms | 777 ms |
| `gpt-realtime-2.1`, reasoning `minimal` | 12/12 | 682 ms | 720 ms |
| `gpt-realtime-2.1-mini` | 12/12 | 744 ms | 980 ms |

- Proxy `connect_agent` của Stream nhận tên model mới, kết nối ~1,4–2,2 s như cũ. Trả lời tiếng Việt đúng ở mọi cấu hình.
- Bản 2.1 bắt đầu nói chậm hơn ~0,15–0,25 s; hạ reasoning (server xác nhận `effort` đã đổi) không cải thiện rõ hơn độ dao động → **giữ mặc định**, không thêm code. Bản mini không nhanh hơn.
- Khác biệt nhỏ: 2.1 đọc số điện thoại theo từng chữ số ("0 3 5 4, 0 9 9, 1 2 3"), bản cũ đọc theo cụm.

**Bước 3: bộ phân loại** (`scripts/thuc-nghiem/classifier-model-compare.mjs`, 28/10). Prompt đọc thẳng từ code; 13 câu jailbreak (7 tấn công gồm 1 câu chép lời sai từ cuộc gọi 27/10, 6 không phải tấn công gồm câu hỏi chế tạo bom) + 25 câu `vn_policy` (20 câu người dùng gồm 2 câu từ cuộc gọi 27/10, 5 câu agent); mỗi câu 3 lần; gọi theo lô 4 như guard. Hai lượt đo:

| Model | jailbreak | vn_policy | Không ổn định | p50 | p90 | USD / 1.000 lượt |
|---|---|---|---|---|---|---|
| `gpt-4o-mini` (cũ) | 39/39 | 75/75 | 0 | 926–937 ms | 1.130–1.187 ms | 0,072 |
| `gpt-6-luna`, reasoning `none` | 39/39 | 75/75 | 0 | 1.405–1.454 ms | 2.227–2.257 ms | 0,052 |
| `gpt-6-luna`, reasoning `low` | 39/39 | 75/75 | 0 | 1.533 ms | 2.062 ms | 0,065 |
| **`gpt-5.6-luna`, reasoning `none`** | **39/39** | **75/75** | 0 | **1.129 ms** | **1.417 ms** | ≈0,11 (ước tính) |
| `gpt-5.4-nano`, reasoning `none` | 39/39 | 72/75 | 0 | 879 ms | 1.071 ms | — |

- **Chọn `gpt-5.6-luna` (reasoning `none`)** thay cho `gpt-6-luna` của kế hoạch: cùng độ chính xác 100%, nhanh hơn ~0,3 s ở p50 và ~0,8 s ở p90. Độ trễ bộ phân loại là giới hạn dưới của strict mode (A2), nên ưu tiên tốc độ; chênh chi phí không đáng kể (~0,1 USD / 1.000 lượt). `gpt-5.4-nano` nhanh nhất nhưng bỏ sót G5 (xuyên tạc lịch sử) → loại.
- `gpt-6-luna` vẫn dùng được bằng env (`JAILBREAK_CLASSIFIER_MODEL`, `VN_POLICY_MODEL`).
- Code: `max_tokens` → `max_completion_tokens` (model có reasoning không nhận `max_tokens`); `reasoning_effort: "none"` qua `classifierOptions` (với reasoning khác `none`, `temperature: 0` bị từ chối).
- Ghi chú: `jailbreak_llm` đúng câu "chế tạo bom" (không phải jailbreak) ở mọi model trong bộ câu này; mục "jailbreak_llm gắn nhầm nhãn" trong `van-de-mo.md` cần đối chiếu lại với bộ câu của khảo sát A2.
- Max ~12–14 s ở vài lượt là nghẽn mạng của máy dev (cũng gặp với gpt-4o-mini), không phải của model.

## 7. Chi phí thực đo (28/10)

`scripts/thuc-nghiem/realtime-model-check.cjs` đọc `usage` của `response.done`, tính theo bảng giá mục 2 (câu hỏi dạng chữ, 6 câu trả lời mỗi model):

| Model | Token âm thanh ra / câu | Token suy luận / câu | USD / câu trả lời |
|---|---|---|---|
| `gpt-realtime` (cũ) | 205 | 0 | 0,0193 |
| `gpt-realtime-2.1` | 235 | 22 | 0,0177 |
| `gpt-realtime-2.1-mini` | 199 | 34 | 0,0043 |

- Đổi sang `gpt-realtime-2.1` **không làm tăng** chi phí mỗi câu trả lời (chênh ±10%). Âm thanh agent nói chiếm phần lớn chi phí.
- Chat và tóm tắt rẻ hơn trước (`gpt-6.1-terra` rẻ hơn `gpt-4o` 2,5 lần); bộ phân loại đắt hơn ~1,5 lần nhưng chỉ ~0,1 USD / 1.000 lượt.
- Chi phí tăng ngày 28/10 là do **dùng nhiều hơn**: 20 phút gọi (27/10: 9,8 phút) và các script đo của khảo sát này (~90 câu trả lời realtime ≈ 1,5 USD, ~1.700 lượt phân loại ≈ 0,15 USD).
- Trong cuộc gọi thật, mỗi câu trả lời còn xử lý lại toàn bộ hội thoại trước đó (phần lớn được cache, 0,40 USD / 1M token) nên chi phí mỗi phút tăng dần theo độ dài cuộc gọi.
- `gpt-realtime-2.1-mini` rẻ hơn ~4 lần, độ trễ tương đương (mục 6); chất lượng tiếng Việt chưa đánh giá. Dùng được cho các buổi test (`REALTIME_MODEL=gpt-realtime-2.1-mini`) và là phương án so sánh cho Chương 3.
