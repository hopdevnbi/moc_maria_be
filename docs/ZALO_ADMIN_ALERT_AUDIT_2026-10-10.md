# Audit thông báo chat KTV → Zalo admin

Ngày: 10/10/2026. Phạm vi: đọc code, nhánh AI trước, hợp đồng Queue, cấu hình production và tài liệu Zalo chính thức. Chưa gửi thông báo thật, chưa tạo bot, chưa sửa chức năng chat/booking hoặc triển khai code cảnh báo.

## Kết quả xác minh

| Hạng mục | Trạng thái thực tế |
| --- | --- |
| Email đặt lịch do AI trước làm | Commit `7b8d651c0378794b4aef769ffa8428854344197e`, nhánh `origin/codex/production-integration`; chưa vào main |
| API quản lý email nhận | Commit `bb68696250fe80e591b13da064b2ba6ab9fe3600`, cùng nhánh; chưa vào main |
| Bắt tin nhắn khách gửi KTV | Chưa có ở main hoặc nhánh email; `KtvChatService.send` chỉ lưu message và cập nhật thread |
| Bắt yêu cầu đặt lịch hiện tại | Chưa có. `AppointmentRequest` POST `/appointment-inquiries`; code email cũ chỉ nối vào `BookingTransactionsService.requestOnSite` |
| Zalo adapter/worker | Chưa có trong backend và Queue đã audit |
| Queue notification handler | `JOB_CATALOG.notifications` rỗng; không thể chỉ enqueue một job Zalo rồi kỳ vọng chạy |
| Production backend | Image `ghcr.io/hopdevnbi/moc_maria_be@sha256:fba61122bf79d31da44e10f1447fd86f4575359214832ec7efb006b926116782`, tương ứng release main `8bbc2c20809acbd0ccc470f992b1a939abe23304` |
| Production cấu hình | Deployment chỉ có `QUEUE_SOURCE` trong nhóm tên biến được kiểm tra; Secret `moc-maria-api-secrets` không có tên key chứa QUEUE, ZALO hoặc ADMIN_ALERT. Không đọc/in nội dung secret trong báo cáo |
| Production API email settings | GET `/api/v1/admin/notification-emails` trả 404 khi audit; chưa chứng minh tính năng gửi email hoạt động |
| Zalo trong ảnh chủ dự án gửi | App Zalo cá nhân. Ảnh không chứng minh có bot token, OA access token hoặc người nhận API |

Giữ nguyên nhánh AI trước. Không merge cả nhánh `production-integration` chỉ để lấy cảnh báo: nó còn chứa phần E2a booking thuộc phạm vi người khác. Tách phần email có ích và thích nghi với main hiện tại sau khi phối hợp chủ scope.

## Điểm cần sửa trong thiết kế cũ

1. **P1 — Mất thông báo khi Queue chưa nhận job.** HTTP enqueue lỗi chỉ được log rồi bỏ qua. `attempts: 5` chỉ có tác dụng sau khi Queue đã nhận job. Cần durable outbox ghi cùng transaction với tin nhắn/yêu cầu đặt lịch, worker gửi lại có backoff và trạng thái lỗi để admin thấy.
2. **P1 — Sai luồng hiện tại.** Phải bắt cả message khách gửi thành công và inquiry mới. Chỉ tạo thread, retry cùng `clientMessageId`, tin nhắn KTV trả lời, gửi bị chặn hoặc bị từ chối không tạo thêm cảnh báo khách mới.
3. **P2 — Bảo vệ cảm giác chat nhanh.** Không gọi Zalo hoặc chờ HTTP 5 giây trong request gửi chat. Việc giao thông báo phải chạy nền sau khi transaction commit.
4. **P2 — Chống trùng có giới hạn.** Job ID giúp dedupe khi job còn tồn tại, không bảo đảm mãi mãi; Queue hiện giữ 1000 job hoàn tất. Outbox cần khóa idempotency theo event + channel + recipient và ghi trạng thái gửi.
5. **P2 — Hợp đồng email nhận.** Queue giới hạn 50 email trong một request. Settings hiện có thể tích lũy nhiều email hơn; cần validation hoặc chia lô. `ADMIN_ALERT_EMAIL` vẫn có trong `.env.example` nhưng bản service mới lấy từ database, không dùng fallback đó.
6. **P2 — Quyền riêng tư.** Giao diện đang hứa chat riêng giữa hai người và có password ẩn lịch sử. Mặc định nên gửi cảnh báo ngắn (KTV, thời điểm, mã sự kiện), không tự sao chép toàn bộ lịch sử/password/địa chỉ/GPS vào Zalo. Nếu chủ muốn admin xem nội dung, cần đặc tả quyền truy cập và thông báo rõ trong sản phẩm trước khi bật; không mở quyền đọc lịch sử chỉ qua URL trong tin Zalo.
7. **P2 — Zalo lỗi nghiệp vụ.** Phải kiểm tra cả HTTP status lẫn JSON `ok`/mã lỗi; phân biệt lỗi token/người nhận với lỗi tạm thời. Không log URL chứa token.

## Hướng kết nối đề xuất

Chủ dự án xác nhận chưa có bot và muốn được hướng dẫn tạo. Dùng **Zalo Bot Platform** để gửi cảnh báo riêng cho admin. Không tự động điều khiển tài khoản Zalo cá nhân để gửi tin.

Luồng cần triển khai:

`Chat customer/inquiry commit → outbox riêng MOC_MARIA → worker → Zalo Bot + email → trạng thái giao nhận`

- Token giữ server-side trong Kubernetes Secret; tên biến cấu hình sẽ được định nghĩa khi triển khai adapter, hiện chưa có adapter dùng biến này.
- Người nhận được xác minh qua chat riêng với bot; không suy ra `chat_id` từ số điện thoại, UID OA hoặc nhóm đang hiện trong ảnh.
- Cảnh báo gộp theo hội thoại khi khách gửi liên tiếp, không bỏ mất sự kiện trong outbox.
- Có trang admin xem kết nối, trạng thái lỗi, cấu hình người nhận và gửi thông báo thử.
- Chỉ dùng Queue dùng chung sau khi có source contract/handler/giới hạn phù hợp, tránh thay đổi worker Acutis đang chạy chỉ để thử Zalo.

## Chủ dự án thực hiện ngay trên điện thoại

1. Mở Zalo, tìm OA **Zalo Bot Manager**.
2. Chọn menu **Tạo bot** để mở **Zalo Bot Creator**.
3. Đặt tên **Bot Mộc Maria Admin** (tên phải bắt đầu bằng `Bot`), điền thông tin mà Zalo yêu cầu và tự xác nhận các điều khoản nếu có.
4. Khi tạo thành công, Zalo gửi **Bot Token** qua tin nhắn cho chủ tài khoản. Giữ token riêng; không đưa vào Git, ảnh chụp hoặc chat công khai.
5. Mở chat riêng với bot vừa tạo và gửi `Kích hoạt cảnh báo Mộc Maria` từ đúng tài khoản admin muốn nhận.
6. Sau đó kết nối phía server: xác minh token bằng `getMe`, lấy đúng `chat_id` từ sự kiện của tin kích hoạt, lưu token trong Secret, cấu hình recipient rồi gửi cảnh báo thử không chứa dữ liệu khách thật.

Đối với bot mới chưa có webhook, có thể dùng `getUpdates` trong bước setup; không xóa webhook của bot đang dùng. Khi cần nhận sự kiện lâu dài trên production, dùng webhook có xác minh theo tài liệu. Gửi cảnh báo outbound cần `sendMessage`; webhook không thay thế việc bắt sự kiện chat trên website.

**Điểm dừng hiện tại:** chưa có Bot Token/người nhận được xác minh, vì vậy chưa thể cấu hình hay chứng minh gửi Zalo thành công. Zalo Web mở từ trình duyệt vẫn ở trạng thái “Đang đăng nhập...” khi kiểm tra; hướng dẫn trên điện thoại là bước người dùng đang thực hiện. Không tuyên bố đã bật thông báo.

## Kiểm thử bắt buộc trước khi bật

- Khách gửi một tin mới → một outbox event, giao đúng admin.
- Retry cùng message key, rollback transaction, bị block hoặc không có quyền → không có thông báo mới.
- Inquiry mới đúng luồng mobile/desktop → cảnh báo; retry không trùng.
- Queue/Zalo mất mạng, token sai, JSON `ok:false`, 429 → trạng thái lỗi rõ; retry không chặn gửi chat.
- Restart worker vẫn xử lý event chờ; dedupe qua restart.
- Cấu hình/recipient chỉ super admin, token không trả về frontend/log.
- Email và Zalo được theo dõi độc lập; lỗi một kênh không làm mất kênh kia.
- Test thực tế với bot và tài khoản admin được chủ xác nhận trước khi báo RELEASED.

## Nguồn chính thức

- [Tạo Bot](https://bot.zapps.me/docs/create-bot/)
- [Giới thiệu Zalo Bot Platform](https://bot.zapps.me/docs/)
- [sendMessage: chat_id và giới hạn 1–2000 ký tự](https://bot.zapps.me/docs/apis/sendMessage/)
- [getUpdates và webhook loại trừ nhau](https://bot.zapps.me/docs/apis/getUpdates/)
- [Zalo OA: khởi tạo ứng dụng và cấp quyền](https://oa.zalo.me/home/documents/guides/Khoi-tao-ung-dung-va-cap-quyen_117071366476220195)

CODE: audit/documentation only. TEST: source/contract/production metadata inspection, no end-to-end Zalo delivery. COMMIT: see branch/PR. DEPLOY: no runtime changes. BUSINESS_DATA: no production chat, booking, bot or notification created.
