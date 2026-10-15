# P08 — Ví quà và mã QR của khách

**Trạng thái:** API + unit tests đã hoàn thiện, chưa chạy migration hoặc cấp quà production.

## Endpoint, đều yêu cầu JWT CUSTOMER và Cache-Control: private, no-store

| Method | Đường dẫn | Chức năng |
|---|---|---|
| GET | /gift-events/me | Hạng khách hiện tại, điều kiện, số lượt và kết quả gần nhất |
| GET | /gift-events/me/rewards | Danh sách quà chỉ thuộc tài khoản đăng nhập |
| GET | /gift-events/me/rewards/:id | Điều kiện quà/snapshot và hạn nhận |
| GET | /gift-events/opens/:id | Khôi phục kết quả đã cấp, không mở lại |
| POST | /gift-events/me/rewards/:id/qr | Sinh mã QR ngắn hạn, không đổi quà |

QR: bí mật ngẫu nhiên 256 bit, lưu SHA-256 hash tại DB, hết hạn tối đa 5 phút hoặc hạn quà (mốc đến trước). Cấp lại vô hiệu hóa mã cũ. Không đưa QR token vào URL hay log.

Tình trạng quà: ISSUED, EXPIRED (suy từ hạn), REDEEMED và VOIDED. Không phát mã QR cho quà đã hết hạn hoặc đã đổi.

**Chưa có chức năng nhân viên quét/xác nhận đổi quà** trong chặng P08. Đổi quà tại quầy và liên kết booking thuộc các chặng tiếp theo, chưa được triển khai. Tính năng mặc định khóa khi GIFT_EVENTS_ENABLED chưa bật.

Kiểm thử: npm test -- --runInBand gift-wallet.service.spec.ts; npm run typecheck; npm run build.
