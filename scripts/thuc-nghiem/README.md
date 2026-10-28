# Script thực nghiệm

Các script đo độ chính xác của Nemotron Safety Guard. Script đọc prompt trực tiếp từ `src/lib/nemotron.ts` nên luôn khớp với code. Chạy từ thư mục gốc repo, cần `NVIDIA_API_KEY` trong `.env`:

```bash
node --dns-result-order=ipv4first --env-file=.env scripts/thuc-nghiem/<tên>.mjs
```

`--dns-result-order=ipv4first` cần khi mạng chậm kết nối IPv4 tới NVIDIA (có lúc mất ~11 s, vượt timeout 10 s của Node).

| Script | Đo gì | Kết quả 21/10/2026 |
|---|---|---|
| `s6-agent-responses.mjs` | Câu trả lời của agent cho người có ý định tự hại: câu hỗ trợ có bị báo nhầm không, câu có hại có bị bắt không | 13/13 đúng (8 hỗ trợ → safe, 5 có hại → unsafe) |
| `s6-user-only.mjs` | Câu của người dùng kiểm riêng (như `checkUserInput`), 3 lần mỗi câu | 11/12 đúng, ổn định qua 3 lần |
| `policy-check.ts` | Tự kiểm tra `src/lib/safety-policy.ts` (`npx tsx scripts/thuc-nghiem/policy-check.ts`), không gọi API | 23/23 ca đạt |
| `rt-stats.cjs` | Độ trễ từng detector và `caught_in_time` từ bảng `safety_events` (chỉ đọc DB) | Xem `docs/khao-sat/a2-shadow-vs-strict.md` |
| `vn-policy-survey.mjs` | Detector `vn_policy`: độ chính xác và độ trễ, tách riêng so với gộp với `jailbreak_llm` (`[reps]` số lần chạy) | Tách riêng 18/18 + 5/5, p90 mỗi lượt 1,41 s. Xem `docs/khao-sat/vn-policy.md` |
| `realtime-model-check.cjs` | Model agent realtime chạy qua proxy Stream được không, đo thời gian tới khi agent bắt đầu nói (câu hỏi dạng chữ, cuộc gọi dùng một lần). `gpt-realtime-2.1@low` = kèm mức suy luận; `REPEAT=n` | 28/10: 2.1 p50 735 ms vs gpt-realtime 539 ms. Xem `docs/khao-sat/doi-model.md` |
| `classifier-model-compare.mjs` | So sánh model cho `jailbreak_llm` + `vn_policy` trên cùng bộ câu (13 jailbreak + 25 vn_policy, prompt đọc từ code): độ chính xác, độ ổn định, độ trễ, chi phí | 28/10: gpt-4o-mini, gpt-6-luna, gpt-5.6-luna đều 100%; gpt-5.6-luna p90 1,42 s |
| `strict-session-check.cjs` | Strict mode không cần người: tạo giọng tiếng Việt bằng TTS, phát vào phiên agent qua Stream với `create_response: false`; xem agent có tự trả lời không, bản chép lời có về không, `response.create` thủ công có chạy không | 28/10: 0 lần tự trả lời; chép lời về sau 0,3–0,9 s; trả lời thủ công chạy. VAD tách câu ở chỗ ngắt nghỉ |
| `guard-turns-stats.cjs` | So sánh shadow / strict từ bảng `guard_turns`: cách quyết định từng lượt, thời gian chép lời, guard, tới khi agent nói (chỉ đọc DB) | Chờ cuộc gọi thật |
| `agent-pair-check.mjs` | Vì sao Nemotron chặn nhầm câu agent: ghép với câu hỏi nó trả lời / câu hỏi sau / đứng riêng, trên ca thật 28/10 và câu có hại (chỉ Nemotron) | Ghép cặp 27/30; nguyên nhân: đoạn mở đầu chưa kịp từ chối. Xem `docs/khao-sat/agent-false-positive.md` |
| `transcript-recorder-check.ts` | Tự kiểm module ghi transcript tiếng Việt: phát lại sự kiện thật trên client giả, ghi vào một meeting cũ rồi xoá (không gọi API trả phí) | 6/6 đạt. Xem `docs/khao-sat/vn-transcript.md` |
| `s6-multiturn.mjs` | Đưa cả chuỗi hội thoại vào Nemotron: có giúp không, có "dính cờ" không | 12/16; dính cờ 2/2, báo nhầm câu hỗ trợ của agent |

Chi tiết và kết luận: [docs/safety-guard.md](../../docs/safety-guard.md) mục 9.
