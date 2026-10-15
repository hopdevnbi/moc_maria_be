# P12 — Quầy xác minh và đổi quà

**API:** GET /staff/gift-redemptions/branches; POST /staff/gift-redemptions/verify; POST /staff/gift-redemptions/redeem.

- JWT đang hoạt động, không phải tài khoản buộc đổi mật khẩu. Super Admin có admin.portal được thao tác ở chi nhánh đang hoạt động. Nhân viên chỉ được thao tác nếu thuộc nhóm RECEPTIONIST/BRANCH_MANAGER/ADMIN, có staff.portal và được Super Admin cấp quyền đích danh cho chi nhánh bằng POST /admin/gift-events/counter-access/grant. Thu hồi quyền bằng /revoke; mỗi lần cấp/thu hồi có lý do >=10 ký tự, lưu audit.
- Verify chỉ xác minh token hash SHA-256, hạn mã/phiếu, chi nhánh trong snapshot và trạng thái ISSUED; **không đổi quà**. Redeem dùng transaction khóa reward rồi token, kiểm tra lại quyền, cập nhật REDEEMED đúng một lần và ghi lịch sử. Mỗi lượt retry cùng actor/branch/idempotency key được trả lại biên nhận; key mới sẽ bị ALREADY_REDEEMED.
- Mã QR nguyên gốc chỉ truyền trong JSON POST, không đưa vào query string, log, báo cáo hoặc lưu vào ví. Mã xác minh từ backend P08 tồn tại tối đa 5 phút. Không xác nhận offline; không liên kết checkout/booking ở P12.
- **Migration mới:** 1791900100000-GiftEventCounterAccess.ts, chỉ tạo bảng phân quyền quầy (không tự cấp quyền). Chỉ chạy khi release owner chấp thuận migration P04 và P12 theo đúng thứ tự; không seed tài khoản, quà, khách hay chi nhánh.
- FE: /nhan-qua, hỗ trợ thiết bị quét QR kiểu bàn phím; **camera di động chưa nghiệm thu**, không được coi là hỗ trợ.
- Chưa bật GIFT_EVENTS_ENABLED hoặc chạy migration production. Test: npm test -- --runInBand gift-redeem.service.spec.ts.
