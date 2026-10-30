# CHƯƠNG 1 (từ mục 1.3)

> Phiên bản v6. Thay từ mục 1.3 đến hết Chương 1. Mục 1.1, 1.2 giữ nguyên.

## 1.3. Guardrail kiểm duyệt nội dung cho mô hình ngôn ngữ lớn

Guardrail là lớp kiểm soát đặt quanh mô hình ngôn ngữ lớn, đánh giá nội dung đầu vào và đầu ra theo một bộ chính sách và quyết định cho phép, từ chối hoặc ghi nhận. NVIDIA phát triển NeMo Guardrails – bộ công cụ mã nguồn mở cho phép thiết lập các "đường ray" (rails) tại nhiều vị trí: kiểm soát đầu vào (input rails), kiểm soát đầu ra (output rails), kiểm soát luồng hội thoại (dialog rails) và kiểm soát dữ liệu truy xuất (retrieval rails) [19, 20]. Mỗi đường ray sử dụng một mô hình phân loại chuyên biệt để đánh giá nội dung.

{{keep: Hình 1.1}}

Hệ thống trong đề tài áp dụng mô hình này với bốn bộ phát hiện: hai mô hình của NVIDIA, một bộ phân loại jailbreak dựa trên mô hình ngôn ngữ và một bộ phân loại theo quy định nội dung của Việt Nam.

### 1.3.1. NVIDIA Nemotron Safety Guard và NemoGuard JailbreakDetect

Các mô hình của NVIDIA được phân phối dưới dạng NVIDIA NIM (NVIDIA Inference Microservices) – vi dịch vụ đóng gói sẵn mô hình cùng bộ máy suy luận, cung cấp giao diện API tương thích chuẩn OpenAI. Hệ thống gọi các điểm cuối do NVIDIA lưu trữ tại build.nvidia.com.

Llama-3.1-Nemotron-Safety-Guard-8B-v3 là mô hình phân loại an toàn nội dung 8 tỷ tham số, xây dựng trên Llama 3.1 và huấn luyện trên bộ dữ liệu an toàn đa ngôn ngữ [17, 23]. Mô hình nhận câu của người dùng và (tùy chọn) câu trả lời của agent, trả về kết quả JSON gồm đánh giá an toàn của câu người dùng (User Safety), của câu trả lời (Response Safety) và danh sách nhóm vi phạm (Safety Categories) theo bộ tiêu chí 23 nhóm S1–S23. Ngữ cảnh tối đa khoảng 8.000 token; tiếng Việt không thuộc 9 ngôn ngữ được hỗ trợ chính thức. Bộ tiêu chí không có nhóm dành cho jailbreak hay prompt injection: mô hình đánh giá nội dung có độc hại hay không, không đánh giá ý đồ vượt rào của câu lệnh.

{{keep: Bảng 1.2}}

NemoGuard JailbreakDetect là mô hình phát hiện jailbreak trong hệ sinh thái NemoGuard [18], hoạt động như bộ phân loại trên vector nhúng (embedding) của câu đầu vào và trả về cờ jailbreak cùng điểm tin cậy. Mô hình được huấn luyện chủ yếu trên các prompt jailbreak phổ biến, dài và viết bằng tiếng Anh.

### 1.3.2. Bộ phân loại dựa trên mô hình ngôn ngữ

Bộ phân loại dựa trên mô hình ngôn ngữ (LLM-as-a-classifier) dùng một mô hình ngôn ngữ đa dụng với chỉ dẫn hệ thống mô tả tiêu chí phân loại và định dạng kết quả JSON. Tiêu chí được viết bằng ngôn ngữ tự nhiên nên điều chỉnh được mà không cần huấn luyện lại, và mô hình hiểu được câu ngắn, câu tiếng Việt, câu có lỗi chép lời. Hệ thống sử dụng hai bộ phân loại loại này trên mô hình `gpt-5.6-luna` với chế độ suy luận tắt:

- `jailbreak_llm`: phát hiện các kỹ thuật vượt rào (ghi đè chỉ dẫn, đòi lộ system prompt, nhập vai AI không giới hạn, giả danh thẩm quyền, đóng khung giả định); yêu cầu độc hại trực tiếp không kèm kỹ thuật vượt rào thuộc phạm vi của Nemotron.
- `vn_policy`: phân loại theo các nhóm nội dung bị cấm trên không gian mạng của Việt Nam (mục 1.3.3).

So với các giải pháp khác như bộ lọc từ khóa, OpenAI Moderation API hay Llama Guard, cách kết hợp này cho phép tùy biến tiêu chí theo yêu cầu riêng của hệ thống trong khi vẫn dùng mô hình chuyên biệt cho nhóm rủi ro nội dung phổ biến.

### 1.3.3. Quy định về nội dung trên không gian mạng tại Việt Nam

Luật An ninh mạng năm 2018 [28] quy định các hành vi bị nghiêm cấm về an ninh mạng tại Điều 8 và các nhóm thông tin trên không gian mạng phải được phòng ngừa, xử lý tại Điều 16, gồm: thông tin tuyên truyền chống Nhà nước (xuyên tạc, phỉ báng chính quyền nhân dân; gây chia rẽ, thù hận giữa các dân tộc, tôn giáo; xúc phạm dân tộc, quốc kỳ, quốc huy, quốc ca, lãnh tụ, anh hùng dân tộc); thông tin kích động gây bạo loạn, phá rối an ninh, gây rối trật tự công cộng; thông tin làm nhục, vu khống; thông tin bịa đặt, sai sự thật gây hoang mang trong nhân dân.

Bộ phân loại `vn_policy` cụ thể hóa các nhóm trên thành bảy nguyên tắc: chủ quyền lãnh thổ (gồm lập trường về Hoàng Sa, Trường Sa và "đường chín đoạn"), lịch sử, kích động chống Nhà nước, bôi nhọ lãnh đạo và cơ quan nhà nước, xúc phạm biểu tượng quốc gia, chia rẽ dân tộc – tôn giáo – vùng miền, bịa đặt thông tin như sự thật. Nội dung được đánh giá theo mục đích, không theo chủ đề: câu hỏi tìm hiểu, phê bình chính sách một cách ôn hòa và tin đồn được hỏi lại là hợp lệ; câu hỏi dẫn dắt có tiền đề xúc phạm được tính là vi phạm.

## 1.4. Công nghệ và công cụ sử dụng

### 1.4.1. Giao diện người dùng

Giao diện được xây dựng bằng Next.js 15 (App Router) và React 19, tổ chức theo thành phần (component) cho các màn hình quản lý agent, quản lý cuộc họp, cuộc gọi video và trò chuyện. Tailwind CSS 4 và thư viện shadcn/ui cung cấp hệ thống thành phần giao diện thống nhất, hiển thị được trên máy tính và thiết bị di động [1–4].

### 1.4.2. API phía máy chủ

Next.js đồng thời cung cấp API phía máy chủ. Nghiệp vụ được cài đặt bằng tRPC [5] với kiểu dữ liệu thống nhất giữa máy khách và máy chủ; mỗi chức năng (agents, meetings, premium) là một router riêng. Better Auth quản lý đăng ký, đăng nhập bằng email – mật khẩu hoặc GitHub, Google và phiên làm việc. Stream Video SDK và Stream Chat SDK [9, 10] cung cấp hạ tầng cuộc gọi video và trò chuyện; OpenAI API [11] cung cấp mô hình hội thoại, chép lời, tóm tắt và phân loại; Inngest [12] chạy các tác vụ nền sau cuộc họp; Polar [13] quản lý gói dịch vụ và thanh toán.

### 1.4.3. Cơ sở dữ liệu

Dữ liệu được lưu trong PostgreSQL trên nền tảng Neon [7], truy cập qua Drizzle ORM [6]. Schema được khai báo bằng TypeScript và đồng bộ lên cơ sở dữ liệu bằng Drizzle Kit. Bản ghi hình và luồng media do Stream lưu trữ; cơ sở dữ liệu chỉ lưu đường dẫn và siêu dữ liệu.

### 1.4.4. Môi trường triển khai và công cụ hỗ trợ

Ứng dụng chạy trên máy chủ ảo AWS EC2 (Ubuntu 24.04) với Caddy làm reverse proxy cấp chứng chỉ TLS tự động và pm2 quản lý tiến trình; Inngest được tự vận hành trên cùng máy chủ. Quá trình phát triển sử dụng Visual Studio Code, Git, Drizzle Studio và các trang quản trị của Stream, Polar.

### 1.4.5. Các mô hình AI sử dụng trong hệ thống

Bảng 1.3: Các mô hình AI sử dụng trong hệ thống

| Vai trò | Mô hình | Nhà cung cấp |
|---|---|---|
| Agent hội thoại trong cuộc gọi (speech-to-speech) | `gpt-realtime-2.1` | OpenAI Realtime API |
| Chép lời câu nói người dùng (tiếng Việt) | `gpt-transcribe` | OpenAI Realtime API |
| Tóm tắt cuộc họp, trả lời chat sau họp | `gpt-6.1-terra` | OpenAI API |
| Kiểm duyệt nội dung (content safety) | Llama-3.1-Nemotron-Safety-Guard-8B-v3 | NVIDIA NIM |
| Phát hiện jailbreak dạng mẫu | NemoGuard JailbreakDetect | NVIDIA NIM |
| Phát hiện jailbreak (`jailbreak_llm`), chính sách nội dung Việt Nam (`vn_policy`) | `gpt-5.6-luna` (suy luận tắt) | OpenAI API |

## 1.5. Tổng kết chương 1

Chương 1 trình bày khái niệm AI Agent và mô hình hội thoại thời gian thực speech-to-speech; các nguy cơ prompt injection, jailbreak và rủi ro đối với dữ liệu hội thoại; mô hình guardrail với các bộ phát hiện của NVIDIA, bộ phân loại dựa trên mô hình ngôn ngữ và quy định về nội dung trên không gian mạng tại Việt Nam; cùng các công nghệ và mô hình AI được sử dụng. Nemotron Safety Guard đánh giá nội dung độc hại nhưng không phát hiện jailbreak và không bao quát các quy định riêng của Việt Nam; hệ thống kết hợp thêm `jailbreak_llm` và `vn_policy` để bao phủ hai nhóm này. Thiết kế cụ thể được trình bày ở Chương 2.
