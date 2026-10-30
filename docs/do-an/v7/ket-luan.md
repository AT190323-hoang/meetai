# KẾT LUẬN

> Phiên bản v7. Thay nội dung Kết luận và Phụ lục.

Đề tài đã xây dựng nền tảng hội thoại video thời gian thực tích hợp AI Agent và lớp kiểm duyệt nội dung. Người dùng tạo agent với chỉ dẫn tùy chỉnh, tổ chức cuộc gọi video trong đó agent hội thoại bằng giọng nói tiếng Việt, xem lại bản ghi hình, bản chép lời tiếng Việt, bản tóm tắt và hỏi đáp với agent sau cuộc họp; hệ thống quản lý gói dịch vụ và thanh toán theo mô hình SaaS và được triển khai trên AWS EC2.

Về an toàn thông tin, đề tài đã thực hiện các nội dung sau:

- Phân tích bề mặt tấn công của AI Agent hội thoại thời gian thực và xác lập chín yêu cầu đối với giải pháp kiểm duyệt.
- Xây dựng lớp kiểm duyệt gồm bốn bộ phát hiện: Nemotron Safety Guard cho nội dung độc hại, NemoGuard JailbreakDetect và `jailbreak_llm` cho jailbreak, `vn_policy` cho các nhóm nội dung bị cấm theo Luật An ninh mạng 2018; đặt tại ba điểm kiểm soát là cuộc gọi, kênh chat sau họp và hậu kiểm.
- Xây dựng chính sách phân mức BLOCK, CARE, LOG; chế độ kiểm duyệt strict với ngưỡng chờ 2 s; kill-switch kết thúc cuộc gọi khi vi phạm lặp lại; cách ly nội dung và khóa kênh chat của cuộc họp vi phạm.
- Ẩn dữ liệu cá nhân trong dữ liệu lưu trữ bằng mã đánh dấu và mã hóa AES-256-GCM, chỉ hiển thị cho chủ cuộc họp và ghi nhật ký mỗi lần hiển thị.
- Lưu vết mọi kết luận kiểm duyệt và thời gian xử lý từng lượt nói.

Trên tập 254 câu văn bản, lớp kiểm duyệt phát hiện 87,4% câu người dùng vi phạm với tỷ lệ chặn nhầm 18,8%, phát hiện toàn bộ câu trả lời có hại của agent và không chặn nhầm câu trả lời an toàn nào. Trong cuộc gọi thật, các câu vi phạm bị từ chối trước khi agent nói, kill-switch kết thúc cuộc gọi đúng ngưỡng và thời gian phản hồi của agent có trung vị khoảng 3 s. `jailbreak_llm` và `vn_policy` phát hiện các nhóm vi phạm mà hai mô hình của NVIDIA không phát hiện.

Hệ thống còn các hạn chế: Nemotron chặn nhầm một số câu hỏi hợp lệ về y tế và câu hư cấu có yếu tố phạm tội; câu từ chối và lời cảnh báo phụ thuộc vào khả năng nghe hiểu của mô hình hội thoại; độ trễ của dịch vụ NVIDIA dao động lớn; lớp kiểm duyệt đánh giá từng lượt nói, chưa phân tích tấn công dàn trải qua nhiều lượt; bộ nhận dạng dữ liệu cá nhân chưa nhận dạng họ tên, địa chỉ; dữ liệu cuộc họp được xử lý bởi các dịch vụ đặt ngoài Việt Nam.

Hướng phát triển gồm: đưa nội dung câu bị chặn vào chỉ dẫn từ chối để lời cảnh báo không phụ thuộc vào khả năng nghe của mô hình; điều chỉnh ngưỡng xử lý theo nhóm vi phạm dựa trên dữ liệu chặn nhầm; kiểm duyệt theo ngữ cảnh nhiều lượt; tự triển khai các mô hình NIM để chủ động về dữ liệu và độ trễ; tách tiến trình agent khỏi máy chủ giao diện để mở rộng theo số cuộc gọi đồng thời; xây dựng trang quản trị theo dõi vi phạm; đánh giá trên bộ dữ liệu tấn công tiếng Việt quy mô lớn.

