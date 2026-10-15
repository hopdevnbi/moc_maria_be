# P17 – Release readiness, legal gate và rollback

**Đây là runbook, không phải giấy phép GO-LIVE. Không chạy migration hay phát voucher thật trong chặng này.**

## Gate trước phát hành

- P10 phải nối giao diện mở hộp với API backend và hiệu ứng chỉ chạy sau khi server trả quà thật; retry/network timeout và 2 tab cùng user đã kiểm tra.
- Hoàn thành P15_QA_GATE.md: DB QA cô lập, concurrency 2 quầy, thử tải, Safari/Chrome ở mobile, quyền camera nếu dự định dùng.
- Super Admin phê duyệt start/end theo giờ Việt Nam, hạng STANDARD/VIPx chính xác, quà, tỷ lệ, tồn, quỹ, địa điểm, thời hạn và điều lệ.
- Finance/Legal phê duyệt quy trình khuyến mại, chứng từ, thuế và cách giao quà. CASH_COUNTER hiện bị cấm phát thực tế khi chưa có pháp lý.
- Nhân viên quầy được tập huấn: mã QR phải kiểm tra online; quyền được Super Admin cấp theo từng chi nhánh. Không giao quà offline.

## Backup / Migration / Canary

1. Ghi SHA FE/BE, digest container backend, bản Vercel đang chạy, config CORS_ORIGINS và GIFT_EVENTS_ENABLED (không ghi secrets).
2. DBA tạo backup production và phục hồi thử trên DB cách ly; kiểm tra backup hợp lệ.
3. QA cô lập áp migration 1791900000000, 1791900100000, 1791900200000 đúng thứ tự rồi chạy đủ E2E.
4. Chỉ release owner áp migration production sau chữ ký gate; deploy backend với GIFT_EVENTS_ENABLED=false.
5. CORS_ORIGINS bao gồm cả mocmaria.com, event.mocmaria.com và các origin đã có. Smoke GET/OPTIONS qua FE scripts/event-release-smoke.ps1, không làm mất config đang chạy.
6. Test login, logout, cookie refresh, returnTo trên Chrome/Safari di động thật ở event subdomain. Không tự động bật live chỉ vì GET 200.
7. Sau khi có chữ ký QA/Product/Finance/Legal/Release Owner mới cân nhắc bật flag và kiểm tra canary; chỉ sau đó công bố event và phát quà thật.

## Monitor và rollback

- Theo dõi HTTP 429, 401/403, QR_EXPIRED, ALREADY_REDEEMED, booking unaffected, lỗi CORS/login, latency, DB lock waits, stock/budget conflicts.
- Đối soát hằng ngày: số entry = issued, stockIssued = actualIssued theo prize, số lịch sử REDEEM = redeemed, reserved liability = snapshot sum.
- Không log QR token, secret, refresh cookie, email/điện thoại khách.
- Incident: PAUSE event, GIFT_EVENTS_ENABLED=false, rollback image digest hoặc FE release đã kiểm tra, giữ nguyên lịch sử quà/đổi quà. Migration P04 cố ý không cho down khi đã có campaign; không force drop.
- Rollback P16 chỉ bỏ host rewrite, giữ DNS đã hoạt động. Lưu incident ID, nguyên nhân và tác động; phải QA lại trước resume.

## Trạng thái

Không có xác nhận tự động nào thay thế kiểm thử E2E thực tế hoặc ký duyệt pháp lý, tài chính, vận hành. Giữ NOT READY TO GO LIVE cho tới khi toàn bộ gate đạt.

## P17 quan sát trực tiếp ngày 15/10/2026

- Smoke script FE dùng GET/OPTIONS không chứa token. Trang mocmaria.com và release endpoint event host trả HTTP 200.
- Tại thời điểm đo, GET api.mocmaria.com/api/v1/gift-events/current trả HTTP 404, preflight CORS cho event host không xác nhận Origin/Credentials. Đây là blockers backend deploy/config, không thể bật feature thật.
- Bản FE b6d32c1 build thành công nhưng host root trả trang chủ thay vì landing. Source FE đã thêm Proxy host root tại 03a9499 và cần smoke lại sau khi Vercel hoàn thành deploy.
- Không chạy migration P04/P12/P14 trên production, không tạo quà thật hoặc sửa CORS/DNS để cố làm test xanh.
