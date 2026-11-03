# Mộc Maria - Web Push chat hai chiều (khách hàng và KTV)

## Luồng

1. Cả khách hàng (CUSTOMER) và KTV (THERAPIST / DOCTOR_CONSULTANT)
   mở PWA đã cài, đăng nhập và chủ động nhấn **Bật thông báo tin nhắn**.
2. Trình duyệt xin quyền trong sự kiện click rồi tạo Web Push subscription.
   Backend xác thực access token, quyền chat và refresh session còn hiệu lực,
   lưu endpoint/keys riêng cho user + session trong
   `ktv_chat_push_subscriptions`. Có thể đăng ký nhiều thiết bị.
3. Khi tin nhắn mới được commit (không phải retry), Backend chọn đúng user đối
   diện trong `ktv_chat_threads`, rồi gửi sự kiện cho Chat Socket và Web Push.
   Tin khách -> KTV và tin KTV -> khách dùng chung luồng, không gửi lại cho người
   vừa gửi.
4. Socket namespace `/moc-maria-chat` xác thực token qua API Mộc Maria.
   Người nhận chỉ tham gia room của chính user đó; dịch vụ relay dùng secret
   server-to-server và chỉ cho phép UUID, không chứa body tin nhắn.
5. Service Worker nhận Push, hiển thị câu chung theo chiều tin nhắn và mở đúng
   `/tin-nhan?thread=<thread-uuid>` khi chạm. API chat vẫn kiểm tra tư cách
   thành viên và khóa hội thoại, không tin vào đường dẫn Push.

## Quyền riêng tư và chống trùng

- Push **không chứa nội dung tin nhắn, tên, số điện thoại hoặc mật khẩu chat**.
- Chỉ gửi tới subscription gắn với user đang hoạt động và session chưa bị
  revoke/expire; truy vấn gửi còn xác minh user thuộc thread được thông báo.
- Thay đổi tài khoản trên cùng thiết bị yêu cầu opt-in riêng. Logout/thu hồi
  session vô hiệu hóa quyền nhận qua backend.
- Tin gửi retry với cùng `clientMessageId` không tạo Push lần thứ hai.
- Khi ứng dụng đang mở, Socket hiển thị thông báo trong ứng dụng. Trên iOS,
  Service Worker vẫn phải hiển thị notification cho Web Push theo yêu cầu Apple.
- Hệ thống gửi best-effort; mất kết nối Push không rollback tin nhắn. Không
  đổi luồng Queue và Zalo.

## Cấu hình bắt buộc trước khi bật production

1. Backup database, kiểm tra migration
   `1793700000000-KtvChatWebPush` đã apply; không chạy lại thủ công nếu bảng
   và migration đã tồn tại.
2. Backend Secret: `WEB_PUSH_VAPID_PUBLIC_KEY`,
   `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`,
   `MOC_MARIA_CHAT_RELAY_KEY`.
3. Chat Socket Secret: **cùng giá trị**
   `MOC_MARIA_CHAT_RELAY_KEY`; ConfigMap
   `MOC_MARIA_API_BASE_URL=https://api.mocmaria.com/api/v1`.
4. Backend `CHAT_SERVICE_URL` phải kết nối được internal Chat Socket.
   Dùng cùng bộ VAPID keys ổn định ở mọi Backend replica; không tạo lại mỗi
   lần deploy vì sẽ làm hỏng subscription thiết bị cũ.
5. Triển khai Chat Socket, Backend, cuối cùng Frontend; xác nhận
   `GET /api/v1/ktv-chat/push/config` có access token customer/KTV trả
   public key khác null. Không để VAPID private key hoặc relay key trong FE,
   Git, CDN hoặc log.

## Kiểm thử thiết bị thật

- Android Chrome và PWA: màn hình mở, chạy nền, khóa màn hình.
- iOS/iPadOS 16.4+: cài từ Home Screen, mở biểu tượng PWA rồi nhấn bật Push
  trực tiếp. Safari tab thông thường không được coi là PWA background Push.
- Khách -> KTV và KTV -> khách; nhiều cuộc hội thoại, nhiều thiết bị, chạm
  notification vào đúng thread, đóng/mở app, refresh token, logout, đổi account,
  tắt quyền, chat được đặt mật khẩu, retry gửi trùng.
- Dùng hai tài khoản test riêng biệt. Không gửi nội dung riêng tư vào log test.

## Giới hạn

Web Push tuân theo quyền thông báo, Focus/Do Not Disturb, tiết kiệm pin, mạng và
trạng thái session; không thể cam kết phân phối tức thời 100% như dịch vụ native.
