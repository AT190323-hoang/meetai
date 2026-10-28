# Xử lý lỗ hổng thư viện (`npm audit`, 28/10/2026)

> Nhánh `feat/deps-audit`. Build production, lint và các script tự kiểm đạt; giao diện đăng nhập / thanh toán chờ test gộp.

## Kết quả

| | Nghiêm trọng | Cao | Trung bình | Thấp | Tổng |
|---|---|---|---|---|---|
| Trước | 4 | 37 | 48 | 1 | 90 |
| Sau | **0** | 9 | 36 | 1 | 46 |

## Đã nâng

| Gói | Từ → tới | Lỗ hổng chính được vá |
|---|---|---|
| `better-auth` | 1.2.8 → 1.7.14 | OAuth callback chấp nhận `state` không khớp; phiên cũ còn hiệu lực sau khi xoá người dùng (nghiêm trọng) |
| `drizzle-orm` | 0.43.1 → 0.45.4 (+ `drizzle-kit` 0.31.11) | SQL injection qua định danh SQL escape sai (cao). Bắt buộc đi cùng `better-auth` mới (peer `^0.45.2`) |
| `next` (+ `eslint-config-next`) | 15.3.8 → 15.5.28 | Cache key / content injection ở Image Optimization (nghiêm trọng) |
| `sharp` | 0.34.5 → 0.35.5 | Lỗ hổng libvips / libheif (cao) |
| Gói gián tiếp (`npm audit fix`) | — | `protobufjs` (thực thi mã), `proxy-addr` (giả IP), `ws`, `axios`, `lodash`, `path-to-regexp`, `body-parser`, `hono`… |

Ghi chú cài đặt: `drizzle-orm` khai báo peer tuỳ chọn cho React Native (`expo-sqlite`, `op-sqlite`), làm npm báo ERESOLVE dù dự án không dùng. Lần nâng đầu dùng `--legacy-peer-deps`; sau đó `npm install` thường chạy bình thường (kiểm 28/10).

## Còn lại và lý do giữ

| Gói | Mức | Vì sao chưa nâng | Ảnh hưởng thực tế |
|---|---|---|---|
| `inngest` 3.54, `@inngest/agent-kit` 0.13, `zod` 3.x bên trong chúng, `@opentelemetry/*` | cao | npm chỉ gợi ý **hạ** phiên bản; `inngest` 4.x là bản lớn (đổi API) và vẫn dùng `zod` 3 | `zod`: cạn bộ nhớ khi kiểm dữ liệu rất lớn — chỉ dùng cho schema nội bộ của SDK, không nhận dữ liệu người dùng. `opentelemetry`: DoS ở bộ phân tích header Jaeger / Prometheus exporter của SDK. Endpoint `/api/inngest` được ký bằng khoá của Inngest ở production |
| `postcss` bên trong `next` 15 | cao | Chỉ vá ở `next` 16 (bản lớn) | Chạy lúc build trên CSS của chính dự án, không xử lý CSS do người dùng gửi |
| 36 mức trung bình | trung bình | Phần lớn là gói gián tiếp của công cụ dev / SDK | Xem lại khi lên `next` 16 / `inngest` 4 |

## Kiểm tra sau khi nâng

- `npm run build`, `npm run lint`, `npx tsc --noEmit`: đạt.
- `policy-check.ts`: đạt. `transcript-recorder-check.ts` (ghi / đọc / xoá qua `drizzle-orm` mới): 6/6. `agent-reconnect-check.ts` (`ws` mới, `connectOpenAi`): 3/3.
- Chưa kiểm bằng giao diện: đăng nhập email / GitHub / Google, đăng xuất, trang nâng cấp gói (Polar) với `better-auth` 1.7 → danh sách test gộp.
