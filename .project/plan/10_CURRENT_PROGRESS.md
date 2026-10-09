# Mộc Maria — Mốc tiến độ đã audit ngày 09/10/2026

**Đang ở Phase 03. Đã có website và API chạy thật; chưa có nền tảng nhận booking hoàn chỉnh.**

Đây là bản đối chiếu Plan, source FE/BE, GitHub main và kiểm tra production. Không dùng số checkbox cũ hay số trang đã tạo để suy ra phần trăm hoàn thành.

## 1. Tám phase đang ở đâu?

| Phase | Trạng thái thực tế | Đã có | Còn thiếu trước khi đóng phase |
|---|---|---|---|
| 01 — Nền móng | Đã đóng mốc nền tảng | Hai repo, NestJS/Next.js, database, migration, CI, health, tracking | Các công việc vận hành dài hạn nằm Phase 08 |
| 02 — Tài khoản/phân quyền | Đã đóng mốc nền tảng | Đăng ký khách, đăng nhập, refresh, logout, RBAC, identity, audit nền tảng | Gửi email/SMS reset/xác minh thực tế chưa tích hợp; giao diện quản lý user/role đầy đủ còn thiếu |
| 03 — Dịch vụ/cơ sở/KTV/lịch | **ĐANG LÀM** | Catalog và giá, cơ sở/giờ mở cửa/tài nguyên, ứng tuyển, xét duyệt, khóa học/đánh giá/chứng nhận nội bộ | Xác minh liên hệ/consent, kỹ năng theo dịch vụ, lịch ca/nghỉ, vùng phục vụ, điều kiện pháp lý/chất lượng, buổi học/điểm danh và gia hạn chứng nhận |
| 04 — Booking | **Chưa triển khai** | Chưa có module/migration booking | Availability, transaction chống trùng, yêu cầu KTV, xác nhận báo giá, đổi/hủy/hoàn tất lịch |
| 05 — Web public/SEO | Làm một phần sớm | Trang chủ mới, dịch vụ/chi tiết/bảng giá, chuyên viên/chi tiết, ứng tuyển | Luồng đặt lịch, dữ liệu hồ sơ đầy đủ, trang cơ sở/chuyên gia, sitemap/robots/OG/SEO động, đo hiệu năng |
| 06 — Portal/chat | Làm một phần sớm | Tài khoản, hồ sơ ứng tuyển và đào tạo của chính KTV | Lịch khách/KTV, chat tenant MOC_MARIA, reconnect/report/block, review và khiếu nại |
| 07 — Admin/CMS | Làm một phần sớm | Admin dịch vụ/giá, cơ sở/tài nguyên/lịch mở cửa, ứng tuyển/đào tạo/chứng nhận | Lịch làm việc, booking command center, CMS/media, CRM/report, quản lý quyền/audit đầy đủ, moderation |
| 08 — Production/queue/hardening | Hạ tầng cơ bản đã chạy | DNS API, Kubernetes riêng, image cố định digest, HTTPS, DB TLS, probes, Vercel | Queue/reminder, Bunny riêng, backup/restore drill, monitoring và kiểm thử vận hành toàn bộ MVP |

**Có 2/8 mốc phase được ghi nhận đã đóng; điều này không có nghĩa sản phẩm đã hoàn thành 25%.** Các phase có độ lớn khác nhau, và yêu cầu KTV/booking/trust bổ sung vẫn còn nhiều.

## 2. Các phần đã kiểm chứng

- Production: https://mocmaria.com trả HTTP 200; https://api.mocmaria.com/api/v1/health/ready trả HTTP 200 và database up.
- Kubernetes: deployment moc-maria-api có 1 replica ready; certificate moc-maria-api-tls READY. Không còn pod QA.
- Public services và providers trả HTTP 200 nhưng danh sách hiện rỗng. Website chưa có gói giá/KTV thật được công bố; không dùng mẫu kiểm thử làm dữ liệu kinh doanh.
- BE: lần kiểm thử gần nhất 17 unit + 20 integration PASS; database kiểm thử tạm, riêng biệt, không seed/reset production. Chín migration đã áp dụng production; nhóm tích hợp gần nhất không thêm migration mới.
- FE: lần kiểm thử gần nhất format/lint/typecheck, 4 unit và build 22 routes PASS. Đây không phải 22 nghiệp vụ hoàn chỉnh.
- Browser QA riêng: tạo/sửa dịch vụ và giá; cơ sở, giờ mở cửa lưu qua reload, tài nguyên/mapping; khóa học, ghi danh, đánh giá, cấp chứng nhận, duyệt hồ sơ; ứng viên nộp đơn, xem riêng hồ sơ/đào tạo; chặn customer vào admin; logout-all. Mẫu và tài khoản QA đã bị xóa cùng database tạm.
- Production auth/session đã kiểm thử trước đó. GiangXa.com kiểm tra lại trả HTTP 200; audit không sửa namespace Giang Xá.
- Chưa có kiểm thử booking concurrency/chat/review/media vì các module đó chưa tồn tại. Không thể coi MVP vận hành đã PASS.

## 3. Vì sao các file và màn hình trông không khớp?

1. Các cập nhật trước đây được nối ở cuối file; phần đầu còn ghi DNS chưa xong, admin chưa có, hoặc Phase 05–08 bị khóa. Các ghi chú đó mô tả thời điểm cũ.
2. Theo yêu cầu ưu tiên deployment/giao diện, một số việc ở Phase 05/07/08 đã làm sớm. Phase hiện tại vẫn là 03 vì chưa qua gate về KTV/kỹ năng/lịch.
3. FE có hai checkout. Thư mục Desktop còn ở commit d27c1c0; code tích hợp nằm trong worktree riêng để giữ thay đổi của AI khác. GitHub main đã ở 99612d5. Không mất code; chưa đồng bộ checkout Desktop.
4. Có sửa lỗi QA chưa commit/deploy: sáu file FE (thông báo lưu lịch, layout tablet, nhãn trạng thái, heading/form mật khẩu) và một helper QA BE. Các thay đổi này đã được kiểm thử nhưng không tính là bản production.
5. Trang có tên “Đặt lịch chăm sóc” hiện dẫn tới danh mục dịch vụ. Chưa phải luồng đặt lịch thành công. Trang quản trị “Tổng quan” chưa phải dashboard doanh số/booking.

## 4. Mốc source và release tại đầu lần audit (trước commit tài liệu này)

- BE GitHub main và branch codex/production-integration: 67cfdd5da0b043ebea7904c9f065665e6cc49bc6.
- Source BE đang chạy: ffc89b39ddaa2b37b70c337160c90778227d0ffd; commit sau đó chỉ ghi thông tin release.
- FE GitHub main và branch codex/platform-integration: 99612d598d8996c81124605ece0c644853aa5aba.
- FE đang chạy: Vercel dpl_743MiiREwFh3gvt6U8RmTdN7eM1d, alias mocmaria.com.
- BE image: sha256:4ec1e00d8521e01f52980cfe3a3fa85602f6482da817939bfb42a49d9d1e17b9.
- Worktree FE: C:/Users/User/.codex/worktrees/moc-maria-platform/moc_maria_fe.

## 5. Thứ tự tiếp theo để dễ theo dõi

1. **Chốt nhóm hiện có:** commit/deploy các sửa lỗi QA còn treo; cập nhật tracker với bằng chứng, giữ nguyên UI tốt của AI khác.
2. **Hoàn thành Phase 03:** hồ sơ/consent/xác minh, kỹ năng và điều kiện dịch vụ; đào tạo chi tiết; ca làm/nghỉ/cơ sở/vùng phục vụ. Mốc nghiệm thu: admin cấu hình một KTV thật và hệ thống quyết định đúng người đó có đủ điều kiện cho dịch vụ/thời gian/khu vực hay không.
3. **Phase 04 + booking FE:** gói → KTV → ngày/giờ/địa chỉ → KTV nhận → khách duyệt giá → lịch xác nhận. Hai khách tranh một slot phải chỉ một người thành công.
4. **Portal/chat/review/admin vận hành:** chỉ review booking hoàn thành; chat cô lập tenant; moderation công bằng và có audit.
5. **Media/SEO/queue/backup/security:** nghiệm thu end-to-end production rồi mới đánh dấu MVP DONE.

Cần dữ liệu từ chủ dự án để mở vận hành thật: email chủ tài khoản admin; danh mục/gói/thời lượng/giá/cơ sở/KTV được phép công bố; chính sách/phê duyệt chuyên ngành khi dịch vụ yêu cầu. Việc thiếu dữ liệu không ngăn tiếp tục phát triển độc lập.

## 6. Cách đọc tiến độ từ nay

Đọc bản tổng quan đầu Plan/99_PROJECT_STATUS.txt. Bản audit này là ảnh chụp trạng thái ngày 09/10/2026. Các checklist phase là yêu cầu nghiệm thu; dấu chưa cập nhật không chứng minh code chưa có, và code đã có không tự chứng minh task DONE. Mỗi nhóm sau cần ghi riêng: source/test/production/dữ liệu vận hành.
