# P14 – Chống lạm dụng Event

## Chống spam và replay

- GiftAbuseService có 4 nhóm độc lập theo tài khoản JWT: OPEN 12 lần / 10 phút theo event, ISSUE_QR 8 lần / 5 phút theo reward, VERIFY 30 lần / 5 phút và REDEEM 20 lần / 5 phút.
- VERIFY và REDEEM có hai bộ đếm: chung cho tài khoản trên mọi chi nhánh (all-branches) và riêng từng chi nhánh. Nhân viên chuyển từ cơ sở A sang B không làm mới giới hạn.
- Scope đưa vào bảng phải là UUID v4 (event/reward/branch); riêng all-branches chỉ hợp lệ cho VERIFY hoặc REDEEM. Yêu cầu scope tùy ý bị chặn 400 trước DB, tránh spam tạo vô hạn dòng bộ đếm.
- Atomic PostgreSQL UPSERT trả HTTP 429 EVENT_RATE_LIMITED; bộ đếm nhất quán giữa các pod.
- Duplicate open, stock/budget cap, idempotency và khóa giao dịch P07 vẫn là lớp bảo vệ chính; P14 không thay đổi cơ cấu giải hoặc số lượt.
- QR gốc chỉ qua JSON POST HTTPS; không nằm trong URL, log, DB, báo cáo. Replay bị chặn bởi trạng thái REDEEMED (P12); mã mới vô hiệu hóa mã cũ (P08).
- Quyền quầy phải được cấp riêng theo nhân viên và chi nhánh.

## Migration và vận hành

Migration P14: 1791900200000-GiftEventRateLimits.ts. Thứ tự: P04 nền tảng -> P12 quyền quầy -> P14 bộ đếm. Chỉ release owner được chạy migration khi môi trường đã nghiệm thu; không bật GIFT_EVENTS_ENABLED trước đó.

Theo dõi tỷ lệ 429 theo action, QR_NOT_FOUND, ALREADY_REDEEMED, stock/budget exhausted mà không ghi token/PII. Bảo trì có thể xóa bộ đếm của cửa sổ quá 30 ngày sau duyệt; không bao giờ dọn lịch sử quà thật.

Giới hạn hiện tại là theo tài khoản JWT, không thay WAF/IP protection. Thử tải thật, IP bot và thử nhiều tài khoản thuộc gate P15–P17. Không bảo đảm chống tất cả hành vi gian lận.

## Audit bổ sung sau mất kết nối

- Test unit chạy npm test -- --runInBand gift-abuse: kiểm tra 429, các bucket, scope hợp lệ, nhánh toàn cục; kiểm tra controller không gọi service cấp/đổi quà khi bộ đếm từ chối.
- Không có migration bổ sung: vẫn dùng bảng bộ đếm P14 đã thiết kế.
- Chưa thử nghiệm nhiều pod PostgreSQL thực tế hoặc chống bot IP đã xác minh reverse proxy. Unit mock PASS chưa tương đương nghiệm thu production.
