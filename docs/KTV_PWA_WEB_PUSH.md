# Mộc Maria - thông báo tin nhắn Khách → KTV (2026-11-03)

## Kiến trúc

- Chat riêng vẫn lưu trong PostgreSQL và dùng REST API hiện tại của Mộc Maria.
- Khi **khách hàng gửi tin nhắn mới** (không phải retry/duplicate), Backend gửi
  một sự kiện **chỉ có các UUID** tới Chat Socket dùng chung:
  `POST /internal/moc-maria-chat-events`.
- Chat Socket có namespace độc lập `/moc-maria-chat`. KTV đăng nhập bằng token
  Mộc Maria, Socket xác thực qua Mộc Maria `GET /auth/me` và chỉ kết nối tài
  khoản còn hiệu lực với role `THERAPIST`. Không tham gia các Acutis rooms.
- Backend gửi Web Push trực tiếp qua các nhà cung cấp Push được cho phép; bảng
  `ktv_chat_push_subscriptions` ràng buộc KTV với một phiên đăng nhập còn hiệu lực.
  Refresh rotation tự chuyển subscription sang session mới; logout/revoke ngừng
  gửi Push. Không phát tin đến KTV đã bị thu hồi role.
- Nội dung Push luôn dùng câu chung “Bạn có tin nhắn mới từ khách hàng”.
  Không gửi tên khách hàng, nội dung riêng tư hoặc password-protected chat ra
  bên ngoài.
- Frontend dùng lại service worker và manifest PWA chính thức; giữ nguyên
  cache trang offline/icon, không cache chat, lịch hẹn, API hay HTML cá nhân.
- Người dùng phải tự nhấn “Bật thông báo tin nhắn” một lần trên mỗi thiết bị.
- Gửi Push/Socket hiện là **best effort**; nếu hệ thống Push gặp lỗi, tin nhắn
  đã được lưu vẫn thành công. Queue chung không có worker Push cho Mộc Maria,
  nên không thay đổi Queue trong phiên này.

## API mới (đều yêu cầu access token KTV)

| HTTP | Endpoint | Dữ liệu |
| --- | --- | --- |
| GET | `/api/v1/ktv-chat/push/config` | `{publicKey: string \| null}` |
| POST | `/api/v1/ktv-chat/push/subscriptions` | `{endpoint, keys: {p256dh, auth}}`, 204 |
| DELETE | `/api/v1/ktv-chat/push/subscriptions` | `{endpoint}`, 204 |

## Trình tự cấu hình/triển khai production (chưa thực hiện)

1. Kiểm tra, backup database và chạy migration
   `src/database/migrations/1793700000000-KtvChatWebPush.ts` trước khi đưa
   Backend mới lên. **Bắt buộc migrate trước** vì auth refresh rotation dùng
   bảng Push mới. Không rollback migration này nếu đã có subscription thật.
2. Tại Backend, tạo bộ VAPID key ổn định (ví dụ:
   `npx web-push generate-vapid-keys --json`), lưu trong secret manager,
   không commit giá trị thật. Cài:
   `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`,
   `WEB_PUSH_SUBJECT=mailto:<email-quản-trị>`.
3. Tạo secret mới ít nhất 32 ký tự, dùng cùng giá trị
   `MOC_MARIA_CHAT_RELAY_KEY` trong Backend và Chat Socket. Backend đặt thêm
   `CHAT_SERVICE_URL=https://chat.giangxa.com` (hoặc internal service URL).
   Không dùng NEXT_PUBLIC_ cho bí mật.
4. Chat Socket: cấu hình
   `MOC_MARIA_API_BASE_URL=https://api.mocmaria.com/api/v1`,
   `MOC_MARIA_CHAT_RELAY_KEY`, thêm host Mộc Maria trong CORS allowlist.
5. Sau migration/secrets, deploy Chat Socket rồi Backend, cuối cùng Frontend.
   Kiểm tra `/sw.js` và `/manifest.webmanifest` trả HTTP 200.
6. Test với tài khoản KTV thật trên desktop, Android PWA và iPhone:
   KTV đăng nhập → `/tin-nhan` → bật quyền thông báo; từ tài khoản khách
   gửi tin → thử khi ứng dụng đang mở/ẩn/khóa màn hình, bấm notification mở
   đúng hội thoại. Kiểm tra không Push khi KTV tự trả lời, retry trùng,
   logout, tắt Push, thu hồi quyền KTV và hội thoại có mật khẩu.

## iPhone

iOS/iPadOS 16.4+ hỗ trợ Web Push cho web app đã thêm vào Home Screen:
Safari → Chia sẻ → Thêm vào Màn hình chính → mở biểu tượng Mộc Maria →
đăng nhập KTV → `/tin-nhan` → “Bật thông báo tin nhắn”.
Trong Safari tab thông thường không thể bảo đảm nhận background Push.
Hệ điều hành/mạng/chế độ tiết kiệm pin có thể làm chậm thông báo.

## Trạng thái

Đã áp dụng thay đổi trên source local máy mới theo nhánh `main` (BE/FE) và
`master` (Chat/Queue). Chưa thực hiện migration production, cấu hình bí mật,
commit, push hoặc deploy; chưa xác minh Web Push trên thiết bị thật.
