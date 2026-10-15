# P14 – Chống lạm dụng Event

## Chống spam và replay

- GiftAbuseService có 4 nhóm độc lập theo tài khoản JWT: OPEN 12 lần / 10 phút theo event, ISSUE_QR 8 lần / 5 phút theo reward, VERIFY 30 lần / 5 phút theo chi nhánh, REDEEM 20 lần / 5 phút theo chi nhánh.
- Atomic PostgreSQL UPSERT trả HTTP 429 EVENT_RATE_LIMITED; bộ đếm nhất quán giữa các pod.
- Duplicate open, stock/budget cap, idempotency và khóa giao dịch P07 vẫn là lớp bảo vệ chính; P14 không thay đổi cơ cấu giải hoặc số lượt.
- QR gốc chỉ qua JSON POST HTTPS; không nằm trong URL, log, DB, báo cáo. Replay bị chặn bởi trạng thái REDEEMED (P12); mã mới vô hiệu hóa mã cũ (P08).
- Quyền quầy phải được cấp riêng theo nhân viên và chi nhánh.

## Migration và vận hành

Migration P14: 1791900200000-GiftEventRateLimits.ts. Thứ tự: P04 nền tảng -> P12 quyền quầy -> P14 bộ đếm. Chỉ release owner được chạy migration khi môi trường đã nghiệm thu; không bật GIFT_EVENTS_ENABLED trước đó.

Theo dõi tỷ lệ 429 theo action, QR_NOT_FOUND, ALREADY_REDEEMED, stock/budget exhausted mà không ghi token/PII. Bảo trì có thể xóa bộ đếm của cửa sổ quá 30 ngày sau duyệt; không bao giờ dọn lịch sử quà thật.

Giới hạn hiện tại là theo tài khoản JWT, không thay WAF/IP protection. Thử tải thật, IP bot và thử nhiều tài khoản thuộc gate P15–P17. Không bảo đảm chống tất cả hành vi gian lận.
