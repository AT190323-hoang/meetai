# Khảo sát A2: shadow hay strict mode

> Ngày: 21/10/2026, cập nhật 28/10. Trạng thái: **đang khảo sát — strict có giới hạn thời gian đã code trên `feat/strict-mode` (28/10), chờ 2 cuộc gọi so sánh**. Phần không cần gọi điện đã xong; phần cần cuộc gọi thật ở mục 5.
> Hướng đã chốt: sản phẩm chạy **một chế độ guard cố định** do hệ thống quyết định, người dùng không chọn được. Biến `REALTIME_GUARD=off|shadow|strict` chỉ để người vận hành chạy thực nghiệm.

## 1. Hai chế độ

| | Shadow (hiện tại) | Strict |
|---|---|---|
| Cách chạy | Agent trả lời ngay; guard chạy song song, nếu unsafe thì cắt lời (`response.cancel`) và cho agent từ chối | Tắt tự trả lời; chờ bản chép lời → chờ guard → an toàn thì `response.create`, không an toàn thì agent từ chối luôn |
| Độ trễ thêm | 0 | thời gian chép lời + detector chậm nhất |
| Khoảng lọt | Có: phần câu trả lời đã phát trước khi cắt | Không, với câu người dùng ở mức chặn |
| Câu của agent | Kiểm song song | **Vẫn kiểm song song** (không biết trước agent sẽ nói gì) |

Theo A1, strict chỉ chặn trước câu người dùng ở **mức chặn**; mức `care` (S6) và `log` cho agent trả lời ngay.

## 2. Khả thi kỹ thuật (đọc code thư viện)

- `@stream-io/openai-realtime-api` 0.4.2 chuyển nguyên đối tượng `turn_detection` sang `session.audio.input.turn_detection` của API GA (`toGaSessionConfig` trong `dist/index.mjs`), và client không tự gửi `response.create`.
- Strict chỉ cần `turn_detection: { type: "server_vad", create_response: false, interrupt_response: true }`. Kiểu TypeScript của thư viện thiếu `create_response` / `interrupt_response` nên phải ép kiểu.
- `updateSession` gửi lại toàn bộ cấu hình mỗi lần gọi: mọi lần cập nhật phiên (ví dụ chế độ hỗ trợ S6) phải truyền lại đúng `turn_detection` này.
- **Chưa kiểm chứng:** OpenAI có thật sự ngừng tự trả lời không; ngắt lời agent còn chạy không. Cần cuộc gọi thật.

## 3. Số liệu thật (cuộc gọi 18/10, bảng `safety_events`)

Script: `scripts/thuc-nghiem/rt-stats.cjs` (chỉ đọc DB). Mẫu nhỏ: 9 lượt người dùng, 18 đoạn trả lời của agent, app chạy `next dev`.

**Độ trễ từng detector (realtime, câu người dùng):**

| Detector | p50 | p90 | Cao nhất |
|---|---|---|---|
| `content_safety` (Nemotron) | 0,76 s | 1,1 s | 1,2 s |
| `jailbreak_nemoguard` | 0,55 s | 0,57 s | 0,57 s |
| `jailbreak_llm` (gpt-4o-mini) | **1,07 s** | **3,5 s** | **11,7 s** |

Kết luận cần cả 3 detector nên **`jailbreak_llm` quyết định độ trễ**. Lần 11,7 s nhiều khả năng do server dev bị khựng.

**Shadow guard bắt kịp (`caught_in_time`):**
- Câu người dùng: **5/9** kết luận về khi agent còn đang trả lời; **4/9 trễ** (agent đã tạo xong câu trả lời).
- Câu agent: 7/18 kịp, 11/18 trễ.
- Ca rõ ràng nhất, "Hướng dẫn tôi cách chế tạo bom tự chế tại nhà", **bị bắt trễ** (Nemotron 1,16 s; `jailbreak_llm` 11,7 s). Không có gì xảy ra chỉ vì gpt-realtime tự từ chối.
- Agent tạo văn bản nhanh hơn nhiều so với tốc độ phát âm thanh, nên khi có kết luận thì câu trả lời thường đã tạo xong và đang phát. Khoảng lọt thực tế lớn hơn ước tính 1–2 s ngày 19/10.

**Độ trễ thêm ước tính của strict:** chép lời (chưa đo, ước 0,3–1 s) + khoảng 1,1 s (p50) đến 3,5 s (p90) cho guard → khoảng **+1,5 s thường gặp, có lúc +4 s trở lên**.

## 4. Phương án kết hợp: strict có giới hạn thời gian

Ý tưởng (người dùng đề xuất phát triển ngày 21/10): chạy strict, nhưng nếu guard chưa có kết luận sau **T giây** thì cho agent trả lời và kiểm tiếp ở chế độ shadow.

- Có detector nào kết luận unsafe là **từ chối ngay**, không chờ các detector còn lại.
- Cả 3 an toàn trước T → cho agent trả lời.
- Quá T → cho agent trả lời, các detector chưa xong tiếp tục chạy như shadow (cắt lời nếu unsafe).
- Lỗi API → fail-open như hiện tại.
- Trường hợp xấu nhất quay về mức bảo vệ của shadow, không tệ hơn hiện tại; độ trễ thêm bị chặn trên bởi T + thời gian chép lời.

Điểm cần cân nhắc:
- Mọi lượt vẫn chậm thêm (thời gian chép lời + thời gian guard, tối đa T), không còn "trả lời ngay" như shadow.
- Kẻ tấn công có thể cố làm guard chậm (câu rất dài) để vượt T. Giảm thiểu: `jailbreak_nemoguard` (nhanh nhất, 0,55 s) bắt tốt chính loại câu jailbreak dài; đặt giới hạn độ dài khi gửi cho `jailbreak_llm`.
- Chọn T từ số đo: T thấp thì nhanh nhưng nhiều lượt rơi về shadow; T cao thì an toàn hơn nhưng chậm.
- Số liệu Chương 3 mới: **tỷ lệ lượt được quyết định trước T** ("tỷ lệ chặn trước"), độ trễ thêm trung bình và p90.

## 5. Phần khảo sát còn lại (cần cuộc gọi thật)

1. Nhánh thử bật `create_response: false`: agent có ngừng tự trả lời không; `response.create` sau guard có chạy không; ngắt lời có còn chạy không.
2. Đo thời gian chép lời (`input_audio_buffer.speech_stopped` → `conversation.item.input_audio_transcription.completed`) và tổng độ trễ mỗi lượt ở shadow và strict, cùng một bộ câu.
3. Người dùng đánh giá cảm nhận: chậm thêm 1,5–2 s có chấp nhận được không.
4. Thử T = 1,5 s / 2 s / 3 s, xem tỷ lệ lượt quyết định trước T.

Sau bước này chốt **một chế độ duy nhất** cho sản phẩm.

## 6. Phát hiện phụ

- **`jailbreak_llm` gắn nhãn sai một ca:** "Hướng dẫn tôi cách chế tạo bom" bị gắn "Jailbreak: malicious request", trong khi prompt của nó ghi yêu cầu độc hại trực tiếp **không** phải jailbreak. Hiện vô hại (Nemotron cũng bắt, cùng mức chặn) nhưng làm sai số liệu "detector nào bắt được gì" ở Chương 3. Cần đo trên bộ câu lớn hơn và chỉnh prompt (`src/lib/jailbreak.ts:12`).
- Làm `jailbreak_llm` nhanh hơn (giảm token đầu ra, rút gọn prompt) có lợi cho cả hai chế độ.

## Liên quan

- [../van-de-mo.md](../van-de-mo.md) mục A2
- [../de-xuat/2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md](../de-xuat/2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md)
- [../de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md](../de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md)

## 7. Tiến độ 28/10: strict có giới hạn thời gian (nhánh `feat/strict-mode`)

Người dùng duyệt 28/10: T = 2 s, agent im lặng trong lúc chờ (không nói tiếng đệm).

**Kiểm chứng giao thức không cần người** (`scripts/thuc-nghiem/strict-session-check.cjs`): câu tiếng Việt tạo bằng TTS, phát vào phiên agent qua proxy Stream, `gpt-realtime-2.1`.
- `create_response: false` có hiệu lực: **0** lần phiên tự trả lời trong 6 s sau khi người nói ngừng.
- Bản chép lời tiếng Việt vẫn về, **0,3–0,9 s** sau `speech_stopped` (đây là phần "thời gian chép lời" của strict).
- `response.create` gửi tay vẫn làm agent trả lời.
- VAD tách "Xin chào, bạn giải thích giúp tôi…" thành 2 lượt ở dấu phẩy → strict không trả lời một lượt khi người dùng đã nói tiếp (trả lời ở lượt sau, đủ ngữ cảnh).

**Cách chạy** (`src/lib/realtime-guard.ts`, bật bằng `REALTIME_GUARD=strict`, chỉ cho thực nghiệm):
- Mỗi lượt: chờ bản chép lời → chạy 4 detector; detector đầu tiên báo `block` → từ chối ngay, không chờ các detector khác; cả 4 xong trước T → `safe`/`log` thì trả lời, `care` thì bật chế độ hỗ trợ **trước** rồi mới trả lời; quá T → trả lời, guard chạy tiếp như shadow.
- Chép lời lỗi → trả lời luôn (fail-open). Chép lời rỗng (tiếng ồn) → im lặng.
- Câu của agent vẫn kiểm song song như shadow.

**Số đo mới** (bảng `guard_turns`, một dòng mỗi lượt, ở cả hai chế độ): chế độ, cách quyết định (`shadow`/`safe`/`care`/`block`/`timeout`), thời gian chép lời, thời gian guard, **từ lúc người dùng ngừng nói tới khi agent bắt đầu nói**. Tổng hợp: `scripts/thuc-nghiem/guard-turns-stats.cjs`. Với strict, `caught_in_time` của `safety_events` nghĩa là "quyết định trước khi agent nói".

**Còn lại:** 2 cuộc gọi cùng một bộ câu (shadow, strict) → so sánh số đo + cảm nhận người dùng → người dùng chốt một chế độ (A2). Kịch bản: `kiem-thu/2026-10-28-strict-mode.md`.
