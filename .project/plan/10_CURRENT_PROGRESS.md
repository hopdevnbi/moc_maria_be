# Mộc Maria — Tiến độ hiện tại (09/10/2026)

**Đang làm Phase 03. Website/API đã chạy; chưa mở nền tảng booking hoàn chỉnh.**

## Mốc đã hoàn thành

- Phase01: nền repo, database, migration, CI, health.
- Phase02: tài khoản, login/refresh/logout, phân quyền và audit nền tảng. Gửi email/SMS thực tế theo Phase08.
- Chặng A: sửa QA còn treo, đối chiếu checklist, tạo ledger và quy tắc nhận việc.
- Chặng B: hồ sơ ứng tuyển riêng có thể bổ sung, consent lưu server theo phiên bản, xác minh liên hệ hiện tại bởi người có quyền và có bằng chứng; chặn tự xác minh/tự duyệt. Lý do xét duyệt bắt buộc, có audit. Đổi liên hệ hoặc rút consent vô hiệu hóa điều kiện tương ứng.
- Production chặng B: BE cd51766; FE fcb2b66; schema10; Vercel dpl_HaZaKDoqbpQ3ZhmGrofGgXfePmJs. Chi tiết và rollback trong 99_PROJECT_STATUS.txt.
- Kiểm chứng B: 17 unit BE + 21 integration PostgreSQL cô lập; FE quality/4 test/build; browser consent/reload/thu hồi/xác minh/mobile; API HTTPS khỏe. Backup public schema và khôi phục vào DB tạm PASS.

## Tám phase

| Phase | Trạng thái | Còn thiếu |
|---|---|---|
| 01 Nền móng | DONE phạm vi nền tảng | Vận hành lâu dài nằm Phase08 |
| 02 Tài khoản/phân quyền | DONE phạm vi nền tảng | Email/SMS delivery và UI quản lý đầy đủ thuộc nhóm sau |
| 03 Catalog/KTV/lịch | IN_PROGRESS | Kỹ năng, ca/nghỉ/phân công, legal/territory/quality, buổi đào tạo và gia hạn |
| 04 Booking | TODO | Availability, quote snapshot, concurrency, request/accept/confirm/change/cancel/complete |
| 05 Web public/SEO | PARTIAL | Booking UX, dữ liệu hồ sơ đủ, SEO động/trang còn thiếu/performance |
| 06 Portal/chat | PARTIAL | Lịch khách/KTV, chat tenant riêng, review/khiếu nại |
| 07 Admin/CMS | PARTIAL | Booking command center, CMS/media, CRM/report, audit/quyền/moderation |
| 08 Production | PARTIAL | Queue/reminder, Bunny riêng, backup tự động/retention, monitoring/full acceptance |

## Chặng đang làm và chặng tiếp theo

C đang triển khai skills + phân công + ca tuần/ca riêng/nghỉ phép trước; sau đó profile/legal/territory/quality. D hoàn thiện đào tạo. E làm booking. F portal/chat/reviews. G vận hành/CMS. H hardening/SEO/media/queue và nghiệm thu production.

Không đánh dấu DONE chỉ vì có code. 99_PROJECT_STATUS.txt ghi release đang chạy; 13_TASK_LEDGER.json ghi từng task. Chặng C mới có code/test thì vẫn ghi chưa deploy. Hệ thống chưa có giá/KTV giả; dữ liệu kinh doanh thật do chủ cung cấp hoặc nhập admin.

## AI khác tham gia như thế nào?

Đọc 99 status + task ledger + 11_WORK_COORDINATION.md, rồi nhận phạm vi trong 14_ACTIVE_WORK.json. Dùng branch/worktree riêng, không viết chung checkout đang có người sửa. API/schema/global CSS phải phối hợp. Trước push main cần fetch và kiểm tra commit mới; không reset/clean/force push, không stage toàn bộ.

FE hiện làm tại C:/Users/User/.codex/worktrees/moc-maria-platform/moc_maria_fe. Checkout Desktop cũ được giữ để không ghi đè AI khác. BE tại C:/Users/User/Desktop/Mộc maria/moc_maria_be, có một writer theo claim.

Lịch sử audit trước B được giữ ở 16_AUDIT_SNAPSHOT_BEFORE_STAGE_B_2026-10-09.md; không dùng lịch sử đó làm trạng thái hiện tại.

## Cần dữ liệu từ chủ khi đến phần phụ thuộc

Email admin chính thức; danh mục/giá/cơ sở/KTV thật; chính sách pháp lý tương ứng dịch vụ; cấu hình nhà cung cấp email/SMS/media/chat nếu chưa có. Tiếp tục phần code độc lập trong khi chờ, không tự suy diễn hay công bố dữ liệu mẫu.
