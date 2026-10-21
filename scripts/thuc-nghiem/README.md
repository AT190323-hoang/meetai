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
| `s6-multiturn.mjs` | Đưa cả chuỗi hội thoại vào Nemotron: có giúp không, có "dính cờ" không | 12/16; dính cờ 2/2, báo nhầm câu hỗ trợ của agent |

Chi tiết và kết luận: [docs/safety-guard.md](../../docs/safety-guard.md) mục 9.
