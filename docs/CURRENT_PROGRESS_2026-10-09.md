# Mộc Maria — Tiến độ hiện tại (09/10/2026)

**D2 đã deploy. Đang bắt đầu chặng E1: nền đặt lịch của mục 4. Mục 3 vẫn còn việc; MVP chưa vận hành trọn vẹn.**

Đã hoàn thành và deploy: nền repo/database/CI, tài khoản/phân quyền, hồ sơ ứng tuyển/consent/xác minh độc lập, skills/chứng nhận/phân công/ca làm/nghỉ phép, hồ sơ công khai và điều kiện dịch vụ/pháp lý/khu vực/chất lượng. D1/D2 bổ sung buổi học/người phụ trách/điểm danh có lịch sử, khối lượng bắt buộc, tiêu chí thực hành theo dịch vụ, sát hạch có bằng chứng và gia hạn chứng nhận. Không còn nhập phần trăm học hoặc tự đánh dấu đậu.

| Mục | Trạng thái | Việc còn thiếu chính |
|---|---|---|
|01–02|DONE nền tảng|Delivery email/SMS theo mục8|
|03 Catalog/KTV/lịch|IN_PROGRESS|Media có consent, tổng hợp đánh giá/chất lượng, specialist/full acceptance, liên kết giao dịch booking/chat|
|04 Booking|TODO — E1 đang làm|Availability, request→KTV nhận→khách duyệt báo giá, chống trùng lịch, đổi/hủy/hoàn tất, chính sách tại nhà|
|05 Public web/SEO|PARTIAL|Booking UX, SEO động/performance/trang còn thiếu|
|06 Portal/chat|PARTIAL|Lịch khách/KTV, chat tenant riêng, review/khiếu nại|
|07 Admin/CMS|PARTIAL|Booking command center, CMS/media/CRM/report/audit/moderation|
|08 Production|PARTIAL|Queue/reminder, Bunny riêng, backup tự động/retention, monitoring/full acceptance|

Các task mục02–08: 49 DONE, 63 PARTIAL, 113 TODO. Đây là số task, không phải phần trăm sản phẩm.

Production D2: BE d6d05000c38df841dc971c1ebe13f4911c3483a4; FE 68b40f33fde3dc5812d6668d57a1684eec3274a5; schema14; Vercel dpl_E7NmxqBXmWC8DMGPRWWQQ4duAaXi READY tại https://mocmaria.com. 21 BE unit +37 tích hợp PostgreSQL cô lập, rollback/reapply migration14, FE4 test/build22 routes, quality và CI PASS. Browser QA: lưu tiêu chí tiếng Việt, sát hạch/gia hạn/lịch sử, reload và mobile390 PASS. Backup schema13 khôi phục DB tạm PASS13 migrations/39 tables/7 roles/8 permissions. Migration13→14 thành công; lần kiểm tra đầu đã dừng trước ghi vì cần fallback tên class, schema13 được kiểm tra lại rồi chạy job v2. API health200, private routes401/private,no-store; GiangXa200. Dữ liệu QA và file mật khẩu tạm đã dọn.

P03-T28/29/30 DONE đúng phạm vi đào tạo. Không đóng toàn mục3. Không có giá/KTV/booking/review giả trên production; public catalog/providers đang trống.

Tiếp tục E1/E2/E3 đặt lịch → F portal/chat/reviews → G vận hành/CMS → H SEO/media/queue/production acceptance. Chặng nào chưa test/deploy sẽ ghi rõ. Đang chờ email admin chính thức và dữ liệu danh mục/giá/cơ sở/KTV/pháp lý thật của chủ; vẫn tiếp tục phần code độc lập.

AI đọc99 status +13 ledger +11_WORK_COORDINATION.md, nhận claim ở14_ACTIVE_WORK.json trước khi sửa. FE hiện tại ở C:/Users/User/.codex/worktrees/moc-maria-platform/moc_maria_fe; giữ checkout FE Desktop cũ. BE C:/Users/User/Desktop/Mộc maria/moc_maria_be chỉ một writer. Branch/worktree riêng, không reset/clean/force push hoặc stage toàn repo. Files15/16 là lịch sử.
