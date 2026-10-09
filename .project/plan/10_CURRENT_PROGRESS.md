# Mộc Maria — Tiến độ hiện tại (09/10/2026)

**Đang làm Phase 03. Website/API chạy; nền tảng booking chưa hoàn chỉnh.**

## Đã hoàn thành và deploy
- Phase01/02: nền repo/database/CI và tài khoản/phân quyền. Email/SMS delivery theo Phase08.
- A: đối chiếu Plan với source, sửa QA treo, ledger/ownership/worktree.
- B: hồ sơ ứng tuyển riêng, consent server theo phiên bản, xác minh liên hệ hiện tại độc lập, lý do và audit; chặn tự xác minh/tự duyệt.
- C1: skills gắn chứng nhận, phân công cơ sở, ca tuần, ca theo ngày và nghỉ phép; chặn ca chồng nhau.
- C2: hồ sơ công khai đã rà soát, phân loại wellness/chuyên gia, chất lượng; chính sách đúng dịch vụ/khóa đào tạo/cơ sở/hình thức/khu vực, hiệu lực và mã rà soát; phí/buffer/bán kính tại nhà. Public chỉ trả dữ liệu an toàn khi đủ điều kiện. Chưa nhận booking.

Production C2: BE 3a069e66dd1ccc44de175cd7a507fa4b01a76e10; FE eab0a4e2a192e9b408ad580e8306fb90f037844f; schema12; Vercel dpl_9qeeBbZLUCnKQAtmLSJinRvDMXoZ. Kiểm chứng:21 unit BE+26 integration PostgreSQL cô lập, FE quality/4 test/build/CI; browser lưu tiếng Việt/ngưng trạng thái/ngưng chính sách hết hạn/ngưng phạm vi/reload/mobile PASS. Backup schema11 khôi phục vào DB tạm PASS. Mã release/rollback ở 99_PROJECT_STATUS.txt.

## Chưa hoàn thành
| Phase | Trạng thái | Còn thiếu chính |
|---|---|---|
|03 Catalog/KTV/lịch|IN_PROGRESS|Buổi đào tạo/điểm danh/giảng viên, tiêu chí/lịch sử đánh giá lại/gia hạn, media consent, quality aggregates và full acceptance|
|04 Booking|TODO|Availability/transaction/concurrency, request→KTV accept→khách duyệt quote, đổi/hủy/complete|
|05 Public web/SEO|PARTIAL|Booking UX, SEO động/performance/trang còn thiếu|
|06 Portal/chat|PARTIAL|Lịch khách/KTV, chat tenant riêng, review/khiếu nại|
|07 Admin/CMS|PARTIAL|Booking command center, CMS/media/CRM/report/audit/quyền/moderation|
|08 Production|PARTIAL|Queue/reminder, Bunny riêng, backup tự động/retention, monitoring/full acceptance|

## Việc đang làm
D1: buổi đào tạo, người phụ trách, điểm danh có bằng chứng. D2: tiêu chí thực hành/lịch sử đánh giá/gia hạn. Sau D mới đến E booking; tiếp đó F portal/chat/reviews, G vận hành/CMS, H SEO/media/queue/production acceptance. Các phase chưa đóng không được coi là đã xong.

Không có giá/KTV/booking/review giả trên production. Public catalog/providers đang trống; dữ liệu kinh doanh thật và quyết định pháp lý cần chủ cung cấp hoặc nhập admin. Chứng nhận nội bộ không phải giấy phép hành nghề nhà nước.

## Cách theo dõi và phối hợp
Bạn đọc file này để biết mốc. AI đọc 99 status + 13 ledger + 11_WORK_COORDINATION.md, nhận phạm vi trong 14_ACTIVE_WORK.json, dùng branch/worktree riêng và phối hợp API/schema/global CSS. Không reset/clean/force push hay stage toàn repo.
FE làm ở C:/Users/User/.codex/worktrees/moc-maria-platform/moc_maria_fe; checkout Desktop cũ được giữ. BE C:/Users/User/Desktop/Mộc maria/moc_maria_be có một writer. File15/16 là lịch sử.

Đang chờ: email admin chính thức, danh mục/giá/cơ sở/KTV thật, chính sách pháp lý từng dịch vụ, cấu hình email/SMS/media/chat khi cần. Tiếp tục code độc lập; không tự suy diễn hoặc công bố mẫu.
