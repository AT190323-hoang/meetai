# CHƯƠNG 2 – phần A (2.1, 2.2, mở đầu 2.3)

> Phiên bản v7. Thay từ sau tiêu đề Chương 2 đến trước mục 2.3.1.

## 2.1. Mô hình tổng thể hệ thống

Hệ thống là nền tảng web cho phép người dùng tạo AI Agent (tên và chỉ dẫn hệ thống), tổ chức cuộc gọi video có agent tham gia bằng giọng nói, sau đó xem lại bản ghi hình, bản chép lời, bản tóm tắt và hỏi đáp với agent về nội dung cuộc họp. Lớp kiểm duyệt nội dung (guardrail) giám sát hội thoại trong cuộc gọi, kênh chat sau họp và bản chép lời sau cuộc gọi.

Hình 2.1 mô tả kiến trúc tổng thể. Máy chủ ứng dụng Next.js chạy trên AWS EC2 gồm bốn khối: API tRPC phục vụ giao diện; bộ xử lý webhook nhận sự kiện từ Stream; khối agent session kết nối agent vào cuộc gọi, ghi bản chép lời tiếng Việt và ẩn dữ liệu cá nhân; lớp kiểm duyệt gọi các bộ phát hiện và áp dụng chính sách xử lý. Âm thanh cuộc gọi đi trực tiếp giữa máy chủ của Stream và OpenAI Realtime; máy chủ ứng dụng giữ một kết nối WebSocket điều khiển để cấu hình agent và nhận sự kiện văn bản. Các dịch vụ bên ngoài gồm Neon PostgreSQL, NVIDIA NIM, OpenAI API, Inngest và Polar.

Hình 2.1: Kiến trúc tổng thể hệ thống [@hinh/kien-truc-tong-the.png]

## 2.2. Phân tích hệ thống

### 2.2.1. Phân tích luồng xử lý của AI Agent

a) Vòng đời cuộc họp

Mỗi cuộc họp đi qua các trạng thái upcoming → active → processing → completed (hoặc cancelled). Song song, trạng thái an toàn `safety_status` nhận một trong ba giá trị pending, safe, flagged. Các sự kiện webhook của Stream điều khiển vòng đời cuộc họp theo bảng 2.1.

Bảng 2.1: Các sự kiện webhook điều khiển vòng đời cuộc họp

| Sự kiện từ Stream | Xử lý tại máy chủ |
|---|---|
| `call.session_started` | Chuyển trạng thái active; kết nối agent (`connectOpenAi`); cấu hình phiên; gắn bộ ghi bản chép lời và lớp kiểm duyệt |
| `call.session_participant_left` | Kết thúc cuộc gọi khi người dùng rời đi; khi agent mất kết nối, máy chủ kết nối lại agent với ngữ cảnh hội thoại gần nhất |
| `call.session_ended` | Chuyển trạng thái processing, ghi thời điểm kết thúc |
| `call.transcription_ready` | Lưu đường dẫn bản chép lời của Stream; phát sự kiện `meetings/processing` tới Inngest (tóm tắt và hậu kiểm) |
| `call.recording_ready` | Lưu đường dẫn bản ghi hình |
| `message.new` | Chat sau họp: kiểm duyệt tin nhắn → `gpt-6.1-terra` → kiểm duyệt câu trả lời → trả lời |

b) Nguồn dữ liệu văn bản

Âm thanh không đi qua máy chủ ứng dụng, nên lớp kiểm duyệt làm việc trên văn bản từ hai nguồn:

- Phiên OpenAI Realtime: câu trả lời của agent có bản chép lời theo thời gian thực qua sự kiện `response.output_audio_transcript.delta`; câu nói của người dùng được chép lời bằng `gpt-transcribe` với ngôn ngữ tiếng Việt, kết quả có sau khoảng 0,5 s kể từ khi người dùng ngừng nói. Nguồn này được dùng cho kiểm duyệt trong cuộc gọi và cho bản chép lời tiếng Việt lưu trong bảng `transcript_items`.
- Bản chép lời của Stream (định dạng JSONL, có mã người nói và mốc thời gian), có sau khi cuộc gọi kết thúc. Nguồn này được dùng cho hậu kiểm.

c) Yêu cầu chức năng

Người dùng đăng ký, đăng nhập bằng email – mật khẩu hoặc GitHub, Google; tạo, sửa, xóa agent; tạo, sửa, xóa, tìm kiếm cuộc họp; tham gia cuộc gọi video với agent; xem bản ghi hình, bản chép lời, bản tóm tắt và các sự kiện an toàn của cuộc họp; hỏi đáp với agent về nội dung cuộc họp qua kênh chat; nâng cấp gói dịch vụ.

d) Yêu cầu phi chức năng

Agent phản hồi trong vài giây sau khi người dùng ngừng nói; dữ liệu cuộc họp chỉ chủ cuộc họp truy cập được; mật khẩu, khóa API và dữ liệu cá nhân được bảo vệ khi lưu trữ và truyền tải; sự cố của dịch vụ bên ngoài không làm gián đoạn cuộc gọi; mọi tác vụ sau cuộc họp được thử lại khi lỗi.

### 2.2.2. Phân tích nguy cơ về nội dung độc hại, jailbreak và prompt injection

Tác nhân đe dọa là người dùng đã đăng nhập nhưng có ý đồ lạm dụng agent. Tài sản cần bảo vệ gồm chỉ dẫn hệ thống của agent, nội dung và dữ liệu cá nhân trong cuộc họp, uy tín và trách nhiệm pháp lý của nền tảng đối với phát ngôn của agent, tài nguyên AI trả phí. Bảng 2.2 tổng hợp các điểm vào.

Bảng 2.2: Bề mặt tấn công của hệ thống AI Agent hội thoại

| Điểm vào | Kịch bản tấn công | Hậu quả |
|---|---|---|
| Lời nói trong cuộc gọi → agent realtime | Câu ghi đè chỉ dẫn, nhập vai, giả danh, yêu cầu nội dung độc hại hoặc nội dung vi phạm quy định của Việt Nam | Agent lộ chỉ dẫn hệ thống, phát ngôn nội dung độc hại tới người nghe |
| Tin nhắn chat sau họp → mô hình chat | Prompt jailbreak hoặc injection qua kênh chat | Mô hình trả lời ngoài phạm vi, lộ cấu hình |
| Bản chép lời → mô hình tóm tắt, mô hình chat | Câu nói trong cuộc họp chứa chỉ dẫn gián tiếp (indirect injection) | Bản tóm tắt hoặc câu trả lời bị thao túng |
| Chỉ dẫn agent do người dùng cấu hình | Chỉ dẫn khiến agent có hành vi độc hại hoặc sai lập trường | Agent phát tán nội dung xấu |
| Câu trả lời của agent | Mô hình tự sinh nội dung vi phạm | Nội dung độc hại tới người dùng |
| Dữ liệu cá nhân được đọc trong cuộc gọi | Số điện thoại, số căn cước, số tài khoản xuất hiện trong bản chép lời, bản tóm tắt | Lộ dữ liệu cá nhân khi dữ liệu cuộc họp bị truy cập |

Trong hội thoại thời gian thực, câu trả lời của agent được phát tới người nghe ngay khi đang được sinh. Kiểm duyệt câu người dùng trước khi agent trả lời làm tăng độ trễ phản hồi; kiểm duyệt song song không tăng độ trễ nhưng một đoạn câu trả lời có thể đã được phát trước khi bị cắt. Hệ thống sử dụng chế độ kiểm duyệt trước có giới hạn thời gian chờ (mục 2.4.3).

### 2.2.3. Yêu cầu đối với giải pháp kiểm duyệt

- YC1 – Độ trễ có giới hạn: agent không phải chờ lớp kiểm duyệt quá T = 2 s.
- YC2 – Phát hiện nội dung độc hại, jailbreak và nội dung vi phạm quy định của Việt Nam.
- YC3 – Hỗ trợ tiếng Việt, câu nói ngắn và văn bản có lỗi chép lời.
- YC4 – Kiểm soát cả câu người dùng và câu trả lời của agent.
- YC5 – Nhiều điểm kiểm soát: trong cuộc gọi, kênh chat sau họp, hậu kiểm.
- YC6 – Phân mức xử lý: từ chối nội dung vi phạm, hỗ trợ người có dấu hiệu tự hại, chỉ ghi nhận nội dung cần lưu ý.
- YC7 – Phản ứng khi vi phạm lặp lại: cảnh báo, kết thúc cuộc gọi, cách ly nội dung cuộc họp.
- YC8 – Bảo vệ dữ liệu cá nhân trong dữ liệu lưu trữ.
- YC9 – Lưu vết mọi kết luận kiểm duyệt; sự cố của bộ phát hiện không làm gián đoạn cuộc gọi.

## 2.3. Thiết kế hệ thống

Thiết kế gồm các chức năng nghiệp vụ (mục 2.3.1), cơ chế an toàn về xác thực, thanh toán, hội thoại thời gian thực và dữ liệu, kết nối agent với OpenAI Realtime, dịch vụ kiểm duyệt, cơ sở dữ liệu và hạ tầng triển khai.
