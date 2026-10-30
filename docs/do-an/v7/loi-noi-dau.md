# LỜI NÓI ĐẦU

> Phiên bản v7. Thay nội dung Lời nói đầu.

Các nền tảng hội thoại video ngày càng tích hợp trợ lý AI có khả năng tham gia trực tiếp vào cuộc trò chuyện bằng giọng nói. Mô hình hội thoại thời gian thực dạng speech-to-speech cho phép agent phản hồi gần như tức thì, nhưng nội dung do agent tạo ra được phát tới người nghe ngay khi đang được sinh, và câu nói của người dùng có thể chứa yêu cầu độc hại, kỹ thuật jailbreak hoặc nội dung vi phạm quy định về thông tin trên không gian mạng tại Việt Nam. Đề tài "Nghiên cứu xây dựng AI Agent hội thoại video thời gian thực tích hợp cơ chế kiểm duyệt nội dung" xây dựng một nền tảng web trong đó AI Agent tham gia cuộc gọi video bằng giọng nói, cùng một lớp kiểm duyệt nội dung (guardrail) giám sát hội thoại trong cuộc gọi, kênh chat sau cuộc họp và dữ liệu sau cuộc gọi.

Chương 1 trình bày cơ sở lý thuyết: AI Agent và mô hình hội thoại thời gian thực; các nguy cơ prompt injection, jailbreak và rủi ro đối với dữ liệu hội thoại; mô hình guardrail với NVIDIA Nemotron Safety Guard, NemoGuard JailbreakDetect, bộ phân loại dựa trên mô hình ngôn ngữ và quy định của Luật An ninh mạng 2018; các công nghệ và mô hình AI được sử dụng.

Chương 2 trình bày phân tích và thiết kế hệ thống: kiến trúc tổng thể, luồng xử lý của AI Agent, mô hình nguy cơ và yêu cầu đối với giải pháp kiểm duyệt; các chức năng nghiệp vụ, cơ chế an toàn về xác thực, thanh toán, cuộc gọi và dữ liệu; kết nối agent với OpenAI Realtime, dịch vụ kiểm duyệt, cơ sở dữ liệu, hạ tầng triển khai; thiết kế lớp kiểm duyệt gồm bốn bộ phát hiện, chính sách phân mức xử lý, chế độ kiểm duyệt strict trong cuộc gọi, kill-switch, cách ly cuộc họp và bảo vệ dữ liệu cá nhân.

Chương 3 trình bày môi trường triển khai trên AWS EC2 và kết quả thực nghiệm theo ba kịch bản: kiểm duyệt trên tập 254 câu văn bản, cuộc gọi thông thường và cuộc gọi có hành vi vi phạm cùng các lớp an toàn sau cuộc họp.
