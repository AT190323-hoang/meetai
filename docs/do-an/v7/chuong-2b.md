# CHƯƠNG 2 – phần B (cuối 2.3.1 đến hết chương)

> Phiên bản v7. Thay từ sau Hình 2.34 đến trước Chương 3. Bỏ các ảnh mã nguồn (Hình 2.35–2.38 cũ), Bảng 2.19 "Các quyết định thiết kế".

c) Cơ chế an toàn xác thực và quản lý người dùng

Xác thực được cài đặt bằng Better Auth ở phía máy chủ, lưu dữ liệu qua Drizzle ORM. Hệ thống hỗ trợ đăng nhập bằng email – mật khẩu và OAuth 2.0 với GitHub, Google; `clientId`, `clientSecret` nằm trong biến môi trường. Plugin Polar tạo khách hàng thanh toán ngay khi người dùng đăng ký. Cấu hình trong `src/lib/auth.ts`:

```ts
export const auth = betterAuth({
    plugins: [
        polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            use: [
                checkout({
                    authenticatedUsersOnly: true,
                    successUrl: "/upgrade",
                }),
                portal(),
            ]
        })
    ],
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID as string,
            clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
        },
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
    },
    emailAndPassword: {
        enabled: true,
    },
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: { ...schema },
    }),
});
```

Mật khẩu được băm bằng scrypt kèm muối trước khi lưu. Phiên làm việc được lưu phía máy chủ trong bảng `session`; trình duyệt chỉ giữ mã phiên trong cookie, và phiên bị thu hồi ngay khi người dùng đăng xuất. Mọi thủ tục tRPC cần đăng nhập đều dùng `protectedProcedure`, từ chối yêu cầu không có phiên hợp lệ với mã UNAUTHORIZED.

d) Cơ chế an toàn gói dịch vụ và thanh toán

Thanh toán được ủy quyền hoàn toàn cho Polar: người dùng được chuyển tới trang thanh toán của Polar, hệ thống không tiếp nhận và không lưu dữ liệu thẻ. Mỗi người dùng tương ứng với một khách hàng Polar có `externalId` là mã người dùng. Giới hạn của gói miễn phí (1 agent, 3 cuộc họp) được kiểm tra ở phía máy chủ trong `premiumProcedure`, trạng thái gói được truy vấn trực tiếp từ Polar ở mỗi lần kiểm tra:

```ts
export const premiumProcedure = (entity: "meetings" | "agents") =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const customer = await polarClient.customers.getStateExternal({
      externalId: ctx.auth.user.id,
    });
    // ... đếm số cuộc họp và agent của người dùng
    const isPremium = customer.activeSubscriptions.length > 0;
    const isFreeAgentLimitReached = userAgents.count >= MAX_FREE_AGENTS;
    const isFreeMeetingLimitReached =
      userMeetings.count >= MAX_FREE_MEETINGS;
    if (entity === "meetings" && isFreeMeetingLimitReached
        && !isPremium) {
      throw new TRPCError({ code: "FORBIDDEN",
        message:
          "You have reached the maximum number of free meetings" });
    }
    // ... kiểm tra tương tự với agent
```

### 2.3.2. Stream SDK & WebRTC

Cuộc gọi video và kênh chat sử dụng Stream Video SDK và Stream Chat SDK. Luồng âm thanh, hình ảnh được truyền qua WebRTC, mã hóa bằng SRTP với khóa trao đổi qua DTLS. Khi agent tham gia, âm thanh được giải mã tại máy chủ của Stream để chuyển tới OpenAI Realtime; mã hóa áp dụng cho từng chặng truyền, không phải mã hóa đầu – cuối.

Người dùng được tạo trên Stream với vai trò `user`. Vai trò toàn cục `user` của loại cuộc gọi `default` không có quyền truy cập cuộc gọi bất kỳ; quyền vào một cuộc gọi đến từ tư cách thành viên với vai trò `call_member`. Khi tạo cuộc họp, máy chủ tạo cuộc gọi có mã trùng mã cuộc họp với hai thành viên là chủ cuộc họp và agent, bật sẵn ghi hình và chép lời:

```ts
const call = streamVideo.video.call("default", createdMeeting.id);
await call.create({
    data: {
        created_by_id: ctx.auth.user.id,
        members: [
            { user_id: ctx.auth.user.id, role: "call_member" },
            { user_id: existingAgent.id, role: "call_member" },
        ],
        custom: { meetingId: createdMeeting.id,
                  meetingName: createdMeeting.name },
        settings_override: {
            transcription: { language: "en", mode: "auto-on",
                             closed_caption_mode: "auto-on" },
            recording: { mode: "auto-on", quality: "1080p" },
        },
    },
});
```

Token cuộc gọi chỉ được cấp cho chủ cuộc họp, chỉ có hiệu lực với đúng cuộc gọi đó (`call_cids`) và hết hạn sau một giờ:

```ts
generateToken: protectedProcedure
    .input(z.object({ meetingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
        const [existingMeeting] = await db
            .select({ id: meetings.id })
            .from(meetings)
            .where(and(eq(meetings.id, input.meetingId),
                       eq(meetings.userId, ctx.auth.user.id)));
        if (!existingMeeting) {
            throw new TRPCError({ code: "NOT_FOUND",
                                  message: "Meeting not found" });
        }
        // ... cập nhật người dùng trên Stream với vai trò "user"
        return streamVideo.generateCallToken({
            user_id: ctx.auth.user.id,
            call_cids: [`default:${existingMeeting.id}`],
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
    }),
```

Kênh chat của cuộc họp được tạo ở phía máy chủ sau khi kiểm tra quyền sở hữu; token chat hết hạn sau một giờ. Bộ xử lý webhook chỉ trả lời tin nhắn của chủ cuộc họp.

### 2.3.3. OpenAI Realtime API

Agent được đưa vào cuộc gọi bằng hàm `connectOpenAi` của Stream Node SDK: Stream sinh token cho agent trong phạm vi cuộc gọi, đưa agent vào cuộc gọi như một thành viên và chuyển tiếp âm thanh hai chiều giữa cuộc gọi và OpenAI Realtime. Kết nối WebSocket trả về là kênh điều khiển phiên theo giao thức GA. Máy chủ cấu hình phiên bằng `session.update`:

```ts
realtimeClient.updateSession({
    instructions,
    turn_detection: {
        type: "server_vad",
        silence_duration_ms: VAD_SILENCE_MS,   // 900
        create_response: false,
        interrupt_response: true,
    },
    input_audio_transcription: {
        model: TRANSCRIPTION_MODEL, language: "vi" },
});
```

Bảng 2.9: Các tham số cấu hình phiên OpenAI Realtime

<!-- widths: 40, 22, 38 -->

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `model` | `gpt-realtime-2.1` | Mô hình hội thoại speech-to-speech |
| `instructions` | Chỉ dẫn của agent và ghi chú lập trường Việt Nam | Ghi chú lập trường được hệ thống nối vào mọi agent, người dùng không gỡ bỏ được |
| `turn_detection.silence_duration_ms` | 900 | Thời gian im lặng để xác định hết lượt nói |
| `turn_detection.create_response` | `false` | Agent không tự trả lời; lớp kiểm duyệt gửi `response.create` khi lượt nói được cho phép |
| `turn_detection.interrupt_response` | `true` | Người dùng được ngắt lời agent |
| `input_audio_transcription` | `gpt-transcribe`, `language: "vi"` | Chép lời câu nói người dùng bằng tiếng Việt |

Lớp kiểm duyệt dùng các sự kiện sau trên kênh điều khiển: `input_audio_buffer.speech_started/stopped` để xác định lượt nói, `conversation.item.input_audio_transcription.completed` để nhận câu người dùng, `response.created/done` để theo dõi câu trả lời, `response.output_audio_transcript.delta/done` để nhận nội dung câu trả lời, `output_audio_buffer.started/stopped` để xác định thời điểm agent phát tiếng. Lệnh `response.cancel` chỉ được gửi khi có câu trả lời đang chạy và `response.create` chỉ được gửi khi không có câu trả lời nào đang chạy hoặc đang được yêu cầu; thư viện kết nối của Stream ngắt agent khi nhận sự kiện lỗi từ máy chủ OpenAI.

Khi agent mất kết nối trong lúc cuộc gọi còn diễn ra, máy chủ kết nối lại agent (tối đa 3 lần liên tiếp, 5 lần mỗi cuộc gọi) và đưa vào chỉ dẫn các dòng hội thoại gần nhất từ bản chép lời tiếng Việt.

Bộ ghi bản chép lời lắng nghe cùng kênh điều khiển và ghi vào bảng `transcript_items`: câu người dùng từ bản chép lời của `gpt-transcribe`, câu agent khi agent dừng phát tiếng. Câu trả lời bị ngắt được cắt theo thời lượng đã phát và đánh dấu `interrupted`. Bản chép lời này được dùng cho tab Transcript, cho bản tóm tắt sau cuộc họp và làm ngữ cảnh khi agent kết nối lại.

### 2.3.4. Dịch vụ kiểm duyệt nội dung

Dịch vụ kiểm duyệt gồm các mô-đun TypeScript phía máy chủ, được dùng chung cho ba điểm kiểm soát.

Bảng 2.10: Các mô-đun của dịch vụ kiểm duyệt

| Mô-đun | Chức năng |
|---|---|
| `nemotron.ts` | `checkSafety`: gọi Nemotron Safety Guard, trả về đánh giá câu người dùng, câu trả lời và nhóm vi phạm |
| `jailbreak.ts` | `detectJailbreakNemoGuard`, `detectJailbreakLLM`: hai bộ phát hiện jailbreak |
| `vn-policy.ts` | `detectVnPolicy`: phân loại theo quy định nội dung của Việt Nam; ghi chú lập trường cho agent |
| `safety-policy.ts` | Ánh xạ nhóm vi phạm sang mức xử lý; ngưỡng kill-switch; các chỉ dẫn từ chối, cảnh báo, hỗ trợ |
| `safety-events.ts` | `checkUserInput`, `checkAgentReply`, `recordSafetyEvent`: điều phối bộ phát hiện và lưu vết |
| `realtime-guard.ts` | Kiểm duyệt trong cuộc gọi ở chế độ strict, kill-switch |
| `pii.ts` | Nhận dạng, gắn nhãn và mã hóa dữ liệu cá nhân |

Nemotron được gọi qua điểm cuối NIM tương thích Chat Completions, với prompt theo mẫu của NVIDIA gồm bộ tiêu chí S1–S23 và đoạn hội thoại cần đánh giá; `temperature` bằng 0. Kết quả là đối tượng JSON, ví dụ `{"User Safety": "unsafe", "Safety Categories": "Guns and Illegal Weapons"}`. Hai bộ phân loại trên `gpt-5.6-luna` dùng `response_format: json_object`, `reasoning_effort: "none"` và giới hạn `max_completion_tokens`.

Mọi bộ phát hiện tuân theo nguyên tắc fail-open: khi dịch vụ gặp lỗi (mất kết nối, quá hạn, kết quả sai định dạng), nội dung được coi là an toàn và lỗi được ghi vào cột `error` của bảng `safety_events`.

Bảng 2.11: Cấu hình dịch vụ kiểm duyệt

<!-- widths: 36, 30, 34 -->

| Biến môi trường | Giá trị mặc định | Ý nghĩa |
|---|---|---|
| `NVIDIA_API_KEY`, `NVIDIA_BASE_URL` | – | Khóa và địa chỉ dịch vụ NVIDIA NIM |
| `NEMOTRON_MODEL` | `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` | Mô hình content safety |
| `OPENAI_API_KEY` | – | Khóa OpenAI cho `jailbreak_llm`, `vn_policy` |
| `GUARD_STRICT_TIMEOUT_MS` | 2000 | Ngưỡng chờ T của chế độ strict |
| `VAD_SILENCE_MS` | 900 | Thời gian im lặng xác định hết lượt nói |
| `SAFETY_WARN_AT`, `SAFETY_KILL_AT` | 5, 10 | Ngưỡng cảnh báo và kết thúc cuộc gọi |
| `PII_ENCRYPTION_KEY` | – | Khóa AES-256 mã hóa dữ liệu cá nhân |

### 2.3.5. Cơ sở dữ liệu

Cơ sở dữ liệu PostgreSQL (Neon) gồm nhóm bảng xác thực (`user`, `session`, `account`, `verification`) do Better Auth quản lý; nhóm nghiệp vụ (`agents`, `meetings`, `transcript_items`); nhóm an toàn (`safety_events`, `guard_turns`, `pii_reveals`). Luồng media và bản ghi hình do Stream lưu; trạng thái gói dịch vụ do Polar quản lý. Các bảng liên kết bằng khóa ngoại với quy tắc xóa lan truyền.

{{keep: Bảng 2.12}}

{{keep: Bảng 2.13}}

{{keep: Bảng 2.14}}

{{keep: Bảng 2.15}}

Bảng 2.16: Bảng dữ liệu meetings

| Tên cột | Kiểu | Mô tả |
|---|---|---|
| `id` | text (khóa chính) | Mã cuộc họp, trùng mã cuộc gọi Stream |
| `name` | text | Tên cuộc họp |
| `user_id`, `agent_id` | text (khóa ngoại) | Chủ cuộc họp, agent tham gia |
| `status` | enum | upcoming, active, processing, completed, cancelled |
| `started_at`, `ended_at` | timestamp | Thời điểm bắt đầu, kết thúc |
| `transcript_url`, `recording_url` | text | Đường dẫn bản chép lời và bản ghi hình của Stream |
| `summary` | text | Bản tóm tắt |
| `safety_status` | enum | pending, safe, flagged |
| `blocked_turns` | integer | Số lượt nói bị chặn (kill-switch) |
| `safety_acknowledged_at` | timestamp | Thời điểm chủ cuộc họp xác nhận cảnh báo vi phạm |
| `created_at`, `updated_at` | timestamp | Thời điểm tạo, cập nhật |

Bảng 2.17: Bảng dữ liệu safety_events

| Tên cột | Kiểu | Mô tả |
|---|---|---|
| `id` | text (khóa chính) | Mã sự kiện |
| `meeting_id` | text (khóa ngoại) | Cuộc họp |
| `source` | enum | realtime, chat, post_call |
| `role` | enum | user, agent |
| `detector` | enum | content_safety, jailbreak_nemoguard, jailbreak_llm, vn_policy |
| `content` | text | Nội dung được kiểm duyệt (dữ liệu cá nhân đã thay bằng nhãn) |
| `unsafe`, `severity` | boolean, enum | Kết luận vi phạm; mức block, care, log |
| `categories` | text[] | Nhóm vi phạm |
| `latency_ms` | integer | Độ trễ của bộ phát hiện |
| `caught_in_time` | boolean | Kết luận có trước khi agent nói xong hay không |
| `error` | text | Lỗi khi gọi bộ phát hiện |

Bảng 2.18: Bảng dữ liệu guard_turns

| Tên cột | Kiểu | Mô tả |
|---|---|---|
| `id`, `meeting_id` | text | Mã lượt, cuộc họp |
| `mode` | enum | strict, shadow |
| `content` | text | Câu người dùng (dữ liệu cá nhân đã thay bằng nhãn) |
| `decision` | enum | safe, care, block, timeout, shadow |
| `transcription_ms` | integer | Từ khi ngừng nói đến khi có bản chép lời |
| `guard_ms` | integer | Từ khi có bản chép lời đến khi đủ kết luận |
| `response_start_ms` | integer | Từ khi ngừng nói đến khi agent bắt đầu nói |
| `severity` | enum | Mức xử lý cuối cùng |

Bảng 2.19: Bảng dữ liệu transcript_items

| Tên cột | Kiểu | Mô tả |
|---|---|---|
| `id`, `meeting_id` | text | Mã dòng, cuộc họp |
| `speaker_id`, `role` | text, enum | Người nói (người dùng hoặc agent) |
| `content` | text | Nội dung tiếng Việt, dữ liệu cá nhân thay bằng mã đánh dấu |
| `start_ms`, `end_ms` | integer | Mốc thời gian tính từ đầu cuộc gọi |
| `interrupted` | boolean | Câu trả lời của agent bị ngắt |
| `pii` | text | Giá trị dữ liệu cá nhân gốc, mã hóa AES-256-GCM |

Bảng 2.20: Bảng dữ liệu pii_reveals

| Tên cột | Kiểu | Mô tả |
|---|---|---|
| `id`, `meeting_id` | text | Mã bản ghi, cuộc họp |
| `transcript_item_id`, `value_index` | text, integer | Giá trị dữ liệu cá nhân được hiển thị |
| `user_id` | text | Người yêu cầu hiển thị |
| `created_at` | timestamp | Thời điểm hiển thị |

Kết nối tới Neon dùng TLS; chuỗi kết nối nằm trong biến môi trường. Schema được khai báo trong `src/db/schema.ts`, Drizzle Kit đồng bộ schema lên cơ sở dữ liệu theo cấu hình:

```ts
export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Mọi truy vấn đi qua Drizzle ORM với tham số được ràng buộc, không ghép chuỗi SQL. Mỗi thủ tục tRPC lọc dữ liệu theo mã người dùng của phiên đăng nhập.

### 2.3.6. Hạ tầng triển khai

Toàn bộ ứng dụng chạy trên một máy chủ AWS EC2 tại vùng Singapore. Caddy làm reverse proxy, cấp và gia hạn chứng chỉ TLS tự động; ứng dụng Next.js và máy chủ Inngest do pm2 quản lý, chỉ lắng nghe trên địa chỉ nội bộ. Nhóm bảo mật của máy chủ chỉ mở cổng 80, 443 cho mọi địa chỉ và cổng 22 cho địa chỉ của người quản trị, xác thực SSH bằng khóa. Các khóa bí mật nằm trong tệp `.env` quyền 600, không thuộc kho mã nguồn. Webhook của Stream được xác thực chữ ký; yêu cầu không có chữ ký hợp lệ bị từ chối.

## 2.4. Thiết kế lớp kiểm duyệt nội dung (guardrail)

Lớp kiểm duyệt kết hợp bốn bộ phát hiện, đặt tại ba điểm kiểm soát (trong cuộc gọi, kênh chat sau họp, hậu kiểm) và áp dụng chính sách phân mức cho mọi kết luận (hình 2.35).

Hình 2.35: Kiến trúc lớp kiểm duyệt nội dung [@hinh/kien-truc-kiem-duyet.png]

### 2.4.1. Kiến trúc bốn bộ phát hiện

Câu người dùng được đưa đồng thời qua bốn bộ phát hiện trong hàm `checkUserInput`; mức xử lý của lượt nói là mức cao nhất trong các kết luận. Câu trả lời của agent đi qua `checkAgentReply` gồm content safety (ghép với câu hỏi tương ứng) và `vn_policy` (câu hỏi làm ngữ cảnh). Các bộ phát hiện chạy song song, độ trễ của cả lớp bằng độ trễ của bộ chậm nhất.

Bảng 2.21: So sánh bốn bộ phát hiện

| Bộ phát hiện | Mô hình | Phạm vi | Áp dụng cho |
|---|---|---|---|
| content_safety | Nemotron Safety Guard 8B v3 | 23 nhóm nội dung độc hại, tự hại, dữ liệu cá nhân | Câu người dùng, câu agent |
| jailbreak_nemoguard | NemoGuard JailbreakDetect | Prompt jailbreak dạng mẫu, tiếng Anh | Câu người dùng |
| jailbreak_llm | `gpt-5.6-luna` | Kỹ thuật vượt rào, kể cả câu ngắn, tiếng Việt | Câu người dùng |
| vn_policy | `gpt-5.6-luna` | 7 nguyên tắc theo Luật An ninh mạng 2018 | Câu người dùng, câu agent |

Mọi agent nhận thêm một ghi chú hệ thống về lập trường chính thức của Việt Nam (chủ quyền Hoàng Sa, Trường Sa; "đường chín đoạn" không có cơ sở pháp lý; các sự kiện lịch sử). Câu trả lời của agent chỉ vi phạm `vn_policy` được agent đính chính thay vì từ chối.

### 2.4.2. Chính sách phân mức xử lý

Mỗi kết luận được ánh xạ sang một trong ba mức xử lý.

Bảng 2.22: Mức xử lý theo nhóm vi phạm

<!-- widths: 12, 55, 33 -->

| Mức | Nhóm vi phạm | Xử lý |
|---|---|---|
| BLOCK | Violence, Sexual, Sexual (minor), Criminal Planning/Confessions, Guns and Illegal Weapons, Controlled/Regulated Substances, Hate/Identity Hate, Threat, Fraud/Deception, Malware, Illegal Activity; jailbreak; vi phạm `vn_policy` | Từ chối, gắn cờ cuộc họp, tính vào kill-switch |
| CARE | Suicide and Self Harm | Câu người dùng: agent chuyển sang chế độ hỗ trợ, cuộc họp không bị gắn cờ. Câu agent: cắt câu trả lời, trả lời lại theo hướng hỗ trợ, gắn cờ cuộc họp |
| LOG | PII/Privacy, Harassment, Profanity, Needs Caution, Manipulation, High Risk Gov Decision Making, Political/Misinformation/Conspiracy, Unauthorized Advice, Copyright, Immoral/Unethical, Other; tin đồn dạng câu hỏi (`vn_policy: unverified`) | Chỉ ghi nhận |

Khi câu người dùng đã bị chặn, kết luận BLOCK của content safety trên câu trả lời của agent cho lượt đó chỉ được ghi nhận: lượt nói đã bị từ chối và câu trả lời thường là câu mở đầu của lời từ chối.

### 2.4.3. Kiểm duyệt trong cuộc gọi

Lớp kiểm duyệt trong cuộc gọi hoạt động ở chế độ strict (hình 2.36). Phiên Realtime được cấu hình `create_response: false`, nên agent chỉ trả lời khi lớp kiểm duyệt gửi `response.create`:

- Khi có bản chép lời câu người dùng, bốn bộ phát hiện chạy song song. Kết luận BLOCK đầu tiên khiến agent từ chối ngay, không chờ các bộ còn lại.
- Khi cả bốn bộ kết luận an toàn hoặc LOG, agent được phép trả lời; lượt CARE chuyển phiên sang chế độ hỗ trợ trước khi trả lời.
- Sau T = 2 s mà chưa đủ kết luận, agent được phép trả lời và lớp kiểm duyệt tiếp tục chạy song song; kết luận BLOCK đến sau sẽ cắt câu trả lời đang phát.
- Agent không trả lời khi người dùng đang nói tiếp.

Hình 2.36: Luồng xử lý một lượt hội thoại ở chế độ strict [@hinh/luong-strict.png]

Cơ chế phát hiện hoạt động giọng nói (VAD) tách câu tại các khoảng ngừng. Các mảnh câu bắt đầu trong vòng 2,5 s sau mảnh trước được gộp thành một câu: lớp kiểm duyệt kiểm cả câu, mỗi câu chỉ được đếm một lần vào kill-switch và bản chép lời ghi một dòng. Lượt nói từ hai từ trở xuống (tiếng đệm như "Ừ.", "Vâng") được coi là không phải yêu cầu mới; câu trả lời sau đó được ghép với yêu cầu trước nó khi kiểm duyệt.

Câu trả lời của agent được kiểm theo từng đoạn: bản chép lời được cộng dồn, mỗi khi đủ một câu hoàn chỉnh (từ 40 ký tự, kết thúc bằng dấu câu) thì được gửi kiểm tra cùng câu hỏi tương ứng, và được kiểm lần cuối khi câu trả lời kết thúc. Kết luận chặn đầu tiên của content safety (BLOCK hoặc CARE) trên đoạn mở đầu chỉ được thực hiện nếu vẫn giữ nguyên khi kiểm thêm phần tiếp theo của câu trả lời:

```ts
const moreTextComing = !state.transcriptDone
    || state.checkedLength < state.text.length;
const deferBlock = (severity === "block" || severity === "care") &&
    !state.openingBlockDeferred && moreTextComing &&
    isSoleContentSafetyObjection(results, userSeverity);
if (deferBlock) {
    state.openingBlockDeferred = true;
    severity = "log";
}
```

Khi cần can thiệp, lớp kiểm duyệt gửi `response.cancel` nếu có câu trả lời đang chạy, chờ `response.done`, rồi gửi `response.create` kèm chỉ dẫn từ chối không nhắc lại nội dung vi phạm. Khi gắn vào cuộc gọi, lớp kiểm duyệt gửi trước một yêu cầu tới cả bốn bộ phát hiện để thiết lập sẵn kết nối. Thời gian của mỗi lượt nói (chép lời, kiểm duyệt, phản hồi) được ghi vào bảng `guard_turns`.

### 2.4.4. Kiểm duyệt kênh chat và hậu kiểm

Kênh chat sau họp kiểm duyệt trước hoàn toàn: tin nhắn của người dùng đi qua `checkUserInput`; tin nhắn ở mức BLOCK nhận câu từ chối cố định mà không gọi mô hình chat; tin nhắn ở mức CARE được trả lời theo hướng hỗ trợ. Câu trả lời của `gpt-6.1-terra` đi qua `checkAgentReply` trước khi gửi; câu trả lời vi phạm được thay bằng câu từ chối. Ngữ cảnh của mô hình chat gồm bản tóm tắt và các tin nhắn gần nhất.

Hậu kiểm là tác vụ Inngest chạy song song với tác vụ tóm tắt khi bản chép lời của Stream sẵn sàng. Tác vụ gộp các đoạn liên tiếp của cùng người nói thành lượt, kiểm tra lần lượt các câu người dùng bằng `checkUserInput` và lưu kết quả với nguồn `post_call`. Bản chép lời của Stream là bản chép lời độc lập với bản chép lời dùng trong cuộc gọi. Sau khi hoàn tất, cuộc họp được đặt trạng thái safe nếu chưa bị gắn cờ.

Tác vụ tóm tắt dùng bản chép lời tiếng Việt trong `transcript_items` (dữ liệu cá nhân thay bằng nhãn), sinh bản tóm tắt tiếng Việt gồm phần tổng quan và các ghi chú theo chủ đề, mốc thời gian bằng `gpt-6.1-terra`.

### 2.4.5. Kill-switch và cách ly cuộc họp

Số lượt nói bị chặn của mỗi cuộc họp được lưu trong cột `blocked_turns`. Ở lượt bị chặn thứ `SAFETY_WARN_AT` (5), câu từ chối kèm lời cảnh báo; ở lượt trước ngưỡng kết thúc, kèm lời cảnh báo cuối cùng; ở lượt thứ `SAFETY_KILL_AT` (10), agent nói câu kết thúc và máy chủ kết thúc cuộc gọi bằng `call.end()` (thử lại khi lỗi, ngắt kết nối agent nếu vẫn lỗi). Agent không được kết nối lại sau khi kill-switch kích hoạt.

Cuộc họp ở trạng thái flagged bị cách ly: bản tóm tắt, bản chép lời và bản ghi hình bị ẩn, giao diện hiển thị cảnh báo và nguồn vi phạm (người dùng hoặc agent). Nội dung hiển thị lại sau khi chủ cuộc họp xác nhận cảnh báo; thời điểm xác nhận được lưu vào `safety_acknowledged_at`. Kênh chat của cuộc họp flagged bị khóa vĩnh viễn.

### 2.4.6. Bảo vệ dữ liệu cá nhân

Mô-đun `pii.ts` nhận dạng số điện thoại, email (kể cả email đọc thành chữ), số căn cước, số thẻ (kiểm tra Luhn), số tài khoản (đứng sau từ khóa như "số tài khoản", "STK") và dãy từ 9 chữ số trở lên, kể cả dãy số được chép lời thành chữ ("không chín một hai…"). Họ tên và địa chỉ không được nhận dạng.

Trước khi lưu vào `transcript_items`, mỗi giá trị được thay bằng một mã đánh dấu và các giá trị gốc được mã hóa bằng AES-256-GCM với khóa trong biến môi trường `PII_ENCRYPTION_KEY`:

```ts
export function maskPii(text: string, itemId: string) {
    const matches = findPii(text);
    if (matches.length === 0) {
        return { content: text, encrypted: null };
    }
    const key = encryptionKey();
    // ... không có khóa: chỉ thay bằng nhãn, không lưu giá trị gốc
    let content = "";
    let cursor = 0;
    matches.forEach((match, index) => {
        content += `${text.slice(cursor, match.start)}` +
            piiMarker(itemId, index, match.type, match.value.length);
        cursor = match.end;
    });
    content += text.slice(cursor);

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([
        cipher.update(JSON.stringify(matches.map((m) => m.value)),
                      "utf8"),
        cipher.final(),
    ]);
    // iv | auth tag | ciphertext, base64
    return { content,
             encrypted: Buffer.concat([iv, cipher.getAuthTag(), data])
                            .toString("base64") };
}
```

Giao diện hiển thị mã đánh dấu dưới dạng làm mờ. Khi chủ cuộc họp nhấn vào, thủ tục `revealPii` kiểm tra quyền sở hữu và trạng thái cách ly, giải mã, trả về giá trị và ghi một dòng vào `pii_reveals`. Bảng `safety_events`, `guard_turns` và bản tóm tắt chỉ lưu nhãn (ví dụ `[số điện thoại]`). Lớp kiểm duyệt đọc nội dung gốc trong bộ nhớ.

## 2.5. Tổng kết chương 2

Chương 2 trình bày kiến trúc tổng thể, vòng đời cuộc họp, hai nguồn văn bản cho kiểm duyệt, mô hình nguy cơ với sáu điểm vào và chín yêu cầu đối với giải pháp kiểm duyệt. Phần thiết kế gồm các chức năng nghiệp vụ qua biểu đồ use case và biểu đồ tuần tự; cơ chế an toàn về xác thực, thanh toán, cuộc gọi và dữ liệu; kết nối agent với OpenAI Realtime; dịch vụ kiểm duyệt; cơ sở dữ liệu; hạ tầng triển khai. Lớp kiểm duyệt kết hợp bốn bộ phát hiện tại ba điểm kiểm soát, áp dụng chính sách phân mức, hoạt động ở chế độ strict trong cuộc gọi, có kill-switch, cách ly cuộc họp và bảo vệ dữ liệu cá nhân. Chương 3 đánh giá lớp kiểm duyệt bằng thực nghiệm.
