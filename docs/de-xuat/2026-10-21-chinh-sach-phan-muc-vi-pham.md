# Quyết định: Chính sách phân mức vi phạm (A1)

> Ngày: 21/10/2026. Trạng thái: **đã chốt**, chưa triển khai.
> Bối cảnh: sản phẩm xây dựng cho thị trường Việt Nam.

## 1. Vấn đề

Hiện mọi kết luận unsafe đều bị xử lý như nhau: cắt lời agent và gắn `flagged`. Ví dụ câu "Đọc lại cho tôi số điện thoại này được không?" bị chặn vì **S9 PII/Privacy**, dù đây là yêu cầu hợp lý trong cuộc họp.

Sau quyết định A5 ([kill-switch](2026-10-20-kill-switch-va-quy-trinh-su-co.md)), mức vi phạm còn quyết định hai việc:
- meeting có bị cách ly (ẩn nội dung và khóa chat) không;
- vi phạm có được tính vào ngưỡng 5/9/10 không.

## 2. Bảng phân mức

| Mức | Hành động | Nhóm |
|---|---|---|
| **Chặn** (`block`) | Cắt lời agent và từ chối, gắn `flagged` (cách ly và khóa chat). Câu của người dùng được **tính vào ngưỡng** cảnh báo và kill-switch. | S1 Violence, S2 Sexual, S3 Criminal Planning, S4 Guns/Illegal Weapons, S5 Controlled Substances, S7 Sexual (minor), S8 Hate, S11 Threat, S16 Fraud/Deception, S17 Malware, S22 Illegal Activity, **jailbreak** (`jailbreak_nemoguard`, `jailbreak_llm`), **`vn_policy`** |
| **Ghi nhận** (`log`) | Agent trả lời bình thường, chỉ lưu `safety_events`. Không cách ly, không tính ngưỡng. | S9 PII/Privacy, S10 Harassment, S12 Profanity, S13 Needs Caution, S14 Other, S15 Manipulation, S18 High Risk Gov Decision Making, S19 Political/Misinformation, S20 Copyright, S21 Unauthorized Advice, S23 Immoral/Unethical |
| **Riêng: S6** Suicide/Self Harm | Cắt câu trả lời có hại. Agent **phản hồi hỗ trợ** và gợi ý đường dây trợ giúp. Meeting gắn `flagged`, nhưng **không tính vào ngưỡng kill-switch**. | S6 |

Lý do xếp mức:
- **Ghi nhận:** các nhóm hay báo nhầm trong bối cảnh cuộc họp, như đọc số điện thoại, chửi thề khi bức xúc, xin lời khuyên y tế hay pháp lý. S13/S14 quá mơ hồ, S23 quá rộng.
- **S10 Harassment:** thường nhắm vào agent. Ca nặng (đe dọa, thù ghét) đã bị chặn qua S11/S8 theo quy tắc "lấy mức cao nhất".
- **S15 Manipulation:** thao túng agent đã có hai detector jailbreak bắt ở mức chặn.
- **S6:** người có ý định tự hại mà bị cảnh báo rồi bị ngắt cuộc gọi thì càng nguy hiểm. Cần phản hồi hỗ trợ, không trừng phạt.
- **S18/S19:** Nemotron đánh giá chính trị theo chuẩn chung, không biết lập trường Việt Nam và không hỗ trợ chính thức tiếng Việt. Để ở mức ghi nhận thì tin chính trị và kinh tế quốc tế không bị chặn. Nội dung chống phá do `vn_policy` đảm nhận (mục 3).

Các nhóm ở mức ghi nhận vẫn có đủ số liệu. Sau thực nghiệm, nhóm nào thường là vi phạm thật thì nâng mức (bước "rút kinh nghiệm" của quy trình sự cố).

## 3. Detector mới `vn_policy` (chính sách nội dung Việt Nam)

Đây là bộ phân loại gpt-4o-mini với chính sách viết riêng, cùng cách làm với `jailbreak_llm`. Nó chạy song song với các detector khác nên không thêm độ trễ, nhưng tốn thêm một lần gọi API mỗi lượt. Áp dụng cho **cả người dùng lẫn agent**.

**Chặn:**
- Phủ nhận hoặc xuyên tạc các lập trường đã rõ ràng: chủ quyền Hoàng Sa, Trường Sa; các sự kiện lịch sử.
- Kêu gọi, kích động chống phá Nhà nước.
- Bôi nhọ, xúc phạm lãnh đạo hoặc cơ quan nhà nước.

**Được phép:** thảo luận và đưa tin chính trị theo thông tin chính thống, lập trường Việt Nam; tin và phân tích chính trị, kinh tế quốc tế.

**Ghi nhận, không chặn:** tin chưa kiểm chứng ("nghe nói chính phủ sắp…"). LLM không xác minh được sự thật, đặc biệt là tin mới.

Yêu cầu khi viết prompt:
- **Ghi rõ lập trường** trong chính sách, ví dụ "Hoàng Sa và Trường Sa thuộc chủ quyền Việt Nam". Không dựa vào hiểu biết của mô hình, vì gpt-4o-mini có thể coi "vùng tranh chấp" là trung lập và đúng.
- Kèm ví dụ câu vi phạm và câu được phép, cả tiếng Việt lẫn tiếng Anh.

Cơ sở pháp lý tham khảo: Luật An ninh mạng 2018 (điều 8, 16). **Cần tra lại văn bản gốc trước khi trích dẫn trong đồ án.**

Khi vi phạm:
- Câu của **người dùng**: mức chặn, tính vào ngưỡng 5/9/10. Không ngắt ngay ở lần đầu vì detector LLM có thể báo nhầm.
- Câu của **agent**: cắt lời, cho agent nói lại theo lập trường đúng.

**Lớp phòng ngừa bổ sung:** thêm một đoạn chỉ dẫn mặc định vào instructions của mọi agent (trả lời theo lập trường chính thống của Việt Nam về chủ quyền và lịch sử). Lớp 1 phòng ngừa, lớp 2 (`vn_policy`) phát hiện và lưu bằng chứng. Chương 3 có thể so sánh hai cấu hình: có và không có chỉ dẫn mặc định.

Đây là chính sách tuân thủ pháp luật, phụ thuộc thị trường triển khai. Muốn áp dụng ở nước khác thì thay chính sách. Trong đồ án nên nói rõ điểm này, cùng với tính minh bạch: điều khoản sử dụng thông báo cho người dùng rằng nội dung cuộc họp được kiểm duyệt theo pháp luật Việt Nam.

## 4. Quy tắc chung

1. Một câu thuộc nhiều nhóm thì **lấy mức cao nhất**.
2. **Vi phạm của agent** ở mức chặn: cắt lời và gắn `flagged`, nhưng không tính vào ngưỡng của người dùng. Kết luận cho câu agent đọc từ trường `Response Safety`, vì danh sách nhóm Nemotron trả về là chung cho cả câu hỏi và câu trả lời.
3. **Lỗi API** (fail-open) không tính là vi phạm.
4. **Một chính sách chung** cho mọi agent, đặt trong code (`src/lib/safety-policy.ts`). Cho từng agent tự cấu hình thì để hướng phát triển.
5. Bảng `safety_events` thêm cột **`severity`** (`block` / `log`). Enum `safety_detector` thêm `vn_policy`. Cả hai cần `db:push`. Chương 3 tách được "detector phát hiện" và "hệ thống thực sự chặn".

## 5. Giới hạn cần nêu trong đồ án

- `vn_policy` dùng LLM nên có thể báo nhầm với thảo luận nhạy cảm nhưng hợp lệ. Cần bộ câu thử gồm cả câu được phép và câu vi phạm.
- Hệ thống không kiểm chứng được tin giả. Chỉ phát hiện xuyên tạc các lập trường đã rõ ràng và lời kêu gọi chống phá.

## 6. Thứ tự triển khai đề xuất

Chính sách phân mức → kill-switch và cách ly (A5) → `vn_policy` → thực nghiệm.

## Liên quan

- [2026-10-20-kill-switch-va-quy-trinh-su-co.md](2026-10-20-kill-switch-va-quy-trinh-su-co.md) (A5)
- [2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md](2026-10-19-strict-mode-va-ngu-canh-nhieu-luot.md) (lý do số 1: chính sách riêng của hệ thống)
- [../safety-guard.md](../safety-guard.md)
