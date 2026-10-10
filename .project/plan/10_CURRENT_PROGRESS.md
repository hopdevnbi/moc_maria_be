CUSTOMER PER-CHAT PASSWORD RELEASE — 2026-10-10
FE 18aa39b29ae1a2c3307765b6b8bab261899ab625; Vercel6974064810 SUCCESS; BE 117f9a084764b03f2a4586e769d9eea4953ac14c; immutable sha256:6797416683911ba1aaafc461302e18ebe37758717fb77bd2bb93eba1d66dcbe3 ready.
CODE/TEST/COMMIT/DEPLOY complete. Customer-owned passwords, masked previews, API proof gates, lock/change/remove/recovery; 15-minute memory-only unlock. Provider access retained.
FE40 tests/full quality; BE25 unit/full quality and all76 integration cases covered; CI and mobile320/390 PASS. Live normal chat/API/empty setup dialog verified.
BUSINESS_DATA: no production passwords or messages created; customer self-service only. No migration; E2a/shared socket scope retained.
See docs/CUSTOMER_CHAT_PASSWORD.md.

# Mộc Maria — Tiến độ hiện tại (09/10/2026)

**D2 và E1 đã deploy. Đang làm E2a: yêu cầu đặt lịch tại cơ sở và xác nhận báo giá. Mục3 vẫn còn việc; MVP chưa vận hành trọn vẹn.**

Đã hoàn thành và deploy: nền repo/database/CI, tài khoản/phân quyền, hồ sơ ứng tuyển/consent/xác minh độc lập, skills/chứng nhận/phân công/ca làm/nghỉ phép, hồ sơ công khai và điều kiện dịch vụ/pháp lý/khu vực/chất lượng. D1/D2 bổ sung buổi học/người phụ trách/điểm danh có lịch sử, khối lượng bắt buộc, tiêu chí thực hành theo dịch vụ, sát hạch có bằng chứng và gia hạn chứng nhận. Không còn nhập phần trăm học hoặc tự đánh dấu đậu.

| Mục | Trạng thái | Việc còn thiếu chính |
|---|---|---|
|01–02|DONE nền tảng|Delivery email/SMS theo mục8|
|03 Catalog/KTV/lịch|IN_PROGRESS|Media có consent, tổng hợp đánh giá/chất lượng, specialist/full acceptance, liên kết giao dịch booking/chat|
|04 Booking|IN_PROGRESS — E2a đang làm|Availability, request→KTV nhận→khách duyệt báo giá, chống trùng lịch, đổi/hủy/hoàn tất, chính sách tại nhà|
|05 Public web/SEO|PARTIAL|Booking UX, SEO động/performance/trang còn thiếu|
|06 Portal/chat|PARTIAL|Lịch khách/KTV, chat tenant riêng, review/khiếu nại|
|07 Admin/CMS|PARTIAL|Booking command center, CMS/media/CRM/report/audit/moderation|
|08 Production|PARTIAL|Queue/reminder, Bunny riêng, backup tự động/retention, monitoring/full acceptance|

Các task mục02–08: 51 DONE, 67 PARTIAL, 107 TODO. Đây là số task, không phải phần trăm sản phẩm.

Production D2: BE d6d05000c38df841dc971c1ebe13f4911c3483a4; FE 68b40f33fde3dc5812d6668d57a1684eec3274a5; schema14; Vercel dpl_E7NmxqBXmWC8DMGPRWWQQ4duAaXi READY tại https://mocmaria.com. 21 BE unit +37 tích hợp PostgreSQL cô lập, rollback/reapply migration14, FE4 test/build22 routes, quality và CI PASS. Browser QA: lưu tiêu chí tiếng Việt, sát hạch/gia hạn/lịch sử, reload và mobile390 PASS. Backup schema13 khôi phục DB tạm PASS13 migrations/39 tables/7 roles/8 permissions. Migration13→14 thành công; lần kiểm tra đầu đã dừng trước ghi vì cần fallback tên class, schema13 được kiểm tra lại rồi chạy job v2. API health200, private routes401/private,no-store; GiangXa200. Dữ liệu QA và file mật khẩu tạm đã dọn.

P03-T28/29/30 DONE đúng phạm vi đào tạo. Không đóng toàn mục3. Không có giá/KTV/booking/review giả trên production; public catalog/providers đang trống.

Tiếp tục E2a giao dịch tại cơ sở/E2b tại nhà/E3 vòng đời đặt lịch → F portal/chat/reviews → G vận hành/CMS → H SEO/media/queue/production acceptance. Chặng nào chưa test/deploy sẽ ghi rõ. Đang chờ email admin chính thức và dữ liệu danh mục/giá/cơ sở/KTV/pháp lý thật của chủ; vẫn tiếp tục phần code độc lập.

AI đọc99 status +13 ledger +11_WORK_COORDINATION.md, nhận claim ở14_ACTIVE_WORK.json trước khi sửa. FE hiện tại ở C:/Users/User/.codex/worktrees/moc-maria-platform/moc_maria_fe; giữ checkout FE Desktop cũ. BE C:/Users/User/Desktop/Mộc maria/moc_maria_be chỉ một writer. Branch/worktree riêng, không reset/clean/force push hoặc stage toàn repo. Files15/16 là lịch sử.


E1 production: BE b53d660a361549d53d8c92b3773413d0b078963d; FE a7b67d1297ca53ba45026eb5e9d9692cd1036fdb; schema15; Vercel dpl_3Jdkz9QSCys6d2w19ENrF7JW6BRz READY tại https://mocmaria.com. Lịch trống trừ ca nghỉ/giờ đóng cửa/duration/buffer/đơn hiện có/phòng-thiết bị, kiểm tra hiệu lực đến hết buổi. Admin cấu hình thời hạn và tài nguyên theo gói/cơ sở có xác nhận/lý do. 25 BE unit+43 tích hợp/rollback-reapply, FE4 test/build22 routes, quality/CI PASS; browser lưu20 phút/reload/mobile390 PASS. Backup schema14 restore PASS14 migrations/42 tables/7 roles/8 permissions. API ready1/health200; private settings401/private,no-store; unknown public package404/no-store; providers empty; GiangXa200. QA đã dọn. Chỉ là xem lịch: reservation=false/requestEnabled=false; giao dịch và báo giá E2 vẫn chưa xong.
