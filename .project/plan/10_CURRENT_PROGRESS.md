# Mộc Maria — Tiến độ hiện tại (09/10/2026)

**Đang làm Phase 03, chặng D2. Website/API chạy; nền tảng booking chưa hoàn chỉnh.**

## Đã hoàn thành và deploy
- Phase01/02: nền repo/database/CI và tài khoản/phân quyền. Email/SMS delivery theo Phase08.
- A: đối chiếu Plan với source, sửa QA treo, ledger/ownership/worktree.
- B: hồ sơ ứng tuyển riêng, consent server theo phiên bản, xác minh liên hệ hiện tại độc lập, lý do và audit; chặn tự xác minh/tự duyệt.
- C1: skills gắn chứng nhận, phân công cơ sở, ca tuần, ca theo ngày và nghỉ phép; chặn ca chồng nhau.
- C2: hồ sơ công khai đã rà soát, wellness/chuyên gia, chất lượng và chính sách đúng dịch vụ/khóa/cơ sở/hình thức/khu vực, hiệu lực, pháp lý, phí/buffer/bán kính. Public chỉ trả dữ liệu an toàn khi đủ điều kiện. Chưa nhận booking.
- D1: học phần, buổi học có người phụ trách, danh sách học viên, điểm danh từng buổi với bằng chứng và lịch sử điều chỉnh; chống trùng giờ giảng viên/học viên, chống tự xác nhận kết quả.

Production D1: BE516ad558d309631d842bbd739fb2f2dfea4c1f19; FE0d2e43d38733d64b508ebf8fed75b4159a94227a; schema13; Vercel dpl_92tjoXBcRK1wPHDZMiYe5hfs6cze READY. 21 BE unit+32 integrations PostgreSQL cô lập/rollback+reapply, FE4 test/build22 routes và CI PASS. Browser tạo học phần/lịch, sửa điểm danh có lịch sử/reload/mobile PASS. Backup trước migration13 khôi phục DB tạm PASS12 migrations/34 tables. API health200, private training endpoints anonymous401/private,no-store. GiangXa200.

## Chưa hoàn thành
| Phase | Trạng thái | Còn thiếu chính |
|---|---|---|
|03 Catalog/KTV/lịch|IN_PROGRESS|Tỷ lệ học tính từ điểm danh/khối lượng bắt buộc, tiêu chí thực hành/lịch sử đánh giá lại/gia hạn, media consent, quality aggregates và full acceptance|
|04 Booking|TODO|Availability/transaction/concurrency, request→KTV accept→khách duyệt quote, đổi/hủy/complete|
|05 Public web/SEO|PARTIAL|Booking UX, SEO động/performance/trang còn thiếu|
|06 Portal/chat|PARTIAL|Lịch khách/KTV, chat tenant riêng, review/khiếu nại|
|07 Admin/CMS|PARTIAL|Booking command center, CMS/media/CRM/report/audit/quyền/moderation|
|08 Production|PARTIAL|Queue/reminder, Bunny riêng, backup tự động/retention, monitoring/full acceptance|

## Việc đang làm
D2: tiêu chí thực hành, tính attendance từ buổi học thật, lịch sử đánh giá, chứng nhận/gia hạn gắn bằng chứng hiện hành. Sau D mới đến E booking; tiếp đó F portal/chat/reviews, G vận hành/CMS, H SEO/media/queue/production acceptance. Các phase chưa đóng không được coi là đã xong.

Không có giá/KTV/booking/review giả trên production. Public catalog/providers đang trống; dữ liệu kinh doanh thật và quyết định pháp lý cần chủ cung cấp hoặc nhập admin. Chứng nhận nội bộ không phải giấy phép hành nghề nhà nước.

## Cách theo dõi và phối hợp
Bạn đọc file này để biết mốc. AI đọc99 status+13 ledger+11_WORK_COORDINATION.md, nhận phạm vi trong14_ACTIVE_WORK.json, dùng branch/worktree riêng và phối hợp API/schema/global CSS. Không reset/clean/force push hay stage toàn repo.
FE làm ở C:/Users/User/.codex/worktrees/moc-maria-platform/moc_maria_fe; checkout Desktop cũ được giữ. BE C:/Users/User/Desktop/Mộc maria/moc_maria_be có một writer. File15/16 là lịch sử.

Đang chờ: email admin chính thức, danh mục/giá/cơ sở/KTV thật, chính sách pháp lý từng dịch vụ, cấu hình email/SMS/media/chat khi cần. Tiếp tục code độc lập; không tự suy diễn hoặc công bố mẫu.
