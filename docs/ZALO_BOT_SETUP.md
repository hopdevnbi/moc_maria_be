# Bot Zalo Mộc Maria — audit và hướng dẫn vận hành

## Phát hiện ngày 14/10/2026

- Bot `Bot Mộc Maria` trả lời getMe thành công. VPS có Bot Token nhưng không có người nhận; getWebhookInfo trả về Not Found. Gửi dòng `Kết nối Mộc Maria` khi chưa có webhook không đăng ký người nhận.
- Luồng đang dùng trên trang chủ là yêu cầu hẹn trong `mocmaria.inquiry.*`, không phải lịch đã xác nhận. Có 11 yêu cầu, 9 hội thoại và 0 appointments tại thời điểm audit; không tạo dữ liệu khách để thử.
- Yêu cầu hẹn đã có durable Zalo outbox trong cùng transaction; không có người nhận nên chưa tạo thông báo. Chat đã có báo cáo theo ngày/giờ, không báo từng tin nhắn. Mặc định 09:00 giờ Việt Nam.
- Mốc báo cáo chung giữa email và Zalo làm kênh chưa kết nối bỏ lỡ báo cáo đã gửi qua kênh còn lại. Tách cursor Zalo; giữ cursor email cũ và retry identity.

## Cấu hình máy chủ

Chỉ thay namespace `moc-maria`. Giữ Bot Token hiện có. Tạo `ZALO_WEBHOOK_SECRET` riêng trong Secret của API, triển khai image từ main, sau đó gọi setWebhook với URL `https://api.mocmaria.com/api/v1/zalo/webhook` và secret đó. Xác nhận `verification.ok` và gọi testWebhook khi cần. Không reset Bot Token; không xóa webhook khác nếu có.

Webhook xác thực `X-Bot-Api-Secret-Token`. Xử lý cả event trực tiếp `event_name/message` và envelope `ok/result`; metadata `is_bot` thiếu không làm bỏ qua tin nhắn có mã hợp lệ. API testWebhook thực tế gửi event trực tiếp; đã kiểm thử thêm dạng này trên PostgreSQL cô lập. Verification probes được trả 200. Chỉ tin nhắn có mã kết nối đang hiệu lực mới đăng ký recipient. Mã ngẫu nhiên 16 ký tự hex, lưu hash, TTL 30 phút theo đồng hồ PostgreSQL, dùng một lần qua row lock/transaction. Người nhận lưu trong app_metadata, kết hợp cấu hình env cũ; worker tải lại khi gửi, không cần restart sau kết nối. Secret và mã kết nối không đưa vào Git hoặc log. Chẩn đoán webhook chỉ giữ tên field/event, thời gian và cờ nhận diện lệnh; không lưu nội dung tin nhắn.

`deploy/k8s/zalo-bot-env.json` là strategic merge patch, dùng với `kubectl -n moc-maria patch deployment moc-maria-api --type=strategic --patch-file=...`, không phải một manifest apply hoàn chỉnh. Patch giữ image và cấu hình email hiện tại. Bot Secret `moc-maria-zalo-admin` có key `token`, `chat-ids`, `webhook-secret`; không đưa giá trị vào repo. Image được xác minh từ main và release evidence lưu ở `deploy/zalo-bot-release.json`.

Tài liệu chính thức: [Webhook](https://docs.zaloplatforms.com/docs/BOT/webhook), [setWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook), [testWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/testWebhook). Polling và webhook loại trừ nhau; không chạy getUpdates khi webhook đang bật.

## Kết nối bằng điện thoại

1. Đăng nhập tài khoản admin ở https://mocmaria.com/quan-tri/zalo.
2. Bấm **Tạo mã kết nối**, sao chép nguyên dòng xuất hiện.
3. Mở Zalo, vào cuộc trò chuyện **Bot Mộc Maria**, dán dòng có mã và gửi. Bot trả lời **Đã kết nối thông báo thành công**.
4. Quay lại trang quản trị, bấm **Kiểm tra trạng thái**. Người nhận phải lớn hơn 0.
5. Bấm **Gửi thông báo kiểm tra**. Trong điều kiện dịch vụ bình thường Bot sẽ báo trong vài giây. Nếu chưa thấy, bấm kiểm tra trạng thái; có số lần gửi và mã lỗi Zalo, cùng trạng thái chờ/đã gửi/thất bại.

Muốn gửi vào nhóm quản trị: thêm Bot vào nhóm từ link chia sẻ của chính Bot, tạo mã mới, gửi dòng kết nối trong nhóm. Chỉ dùng nhóm dành cho người được phép nhận thông tin khách; Zalo hỗ trợ group ở trạng thái Beta. Mỗi mã đăng ký một nơi nhận; tạo mã tiếp theo để thêm nơi khác.

Không cần nhập thủ công Webhook URL/Secret Token trong Bot Manager nếu webhook đã được cấu hình và xác minh bởi API. Hai trường này không phải Bot Token. Không bấm Reset token.

## Test hai luồng thực tế

**Đặt lịch:** vào trang chủ, chọn KTV/dịch vụ, điền thông tin và gửi một yêu cầu hẹn thực sự cần kiểm tra. Bot phải nhận `Yêu cầu đặt lịch mới`, tên khách, KTV, dịch vụ và mã yêu cầu. Đối chiếu ở `/quan-tri/lich-hen`. Gửi lại cùng retry identity không tạo thông báo thứ hai. Những yêu cầu cũ trước kết nối không tự gửi lại hàng loạt.

**Chat:** gửi tin nhắn cho một KTV từ tài khoản khách. Ở `/quan-tri/zalo` bấm **Gửi báo cáo chat ngay** để kiểm tra ngay; báo cáo chỉ gồm tên và số tin mới, không nội dung cuộc trò chuyện. Có thể có báo cáo cho những hội thoại thực sự thay đổi trong kỳ. Bấm lại khi không có tin mới sẽ không lặp báo cáo. Nút này tuân thủ enabled và kênh đang bật, đồng thời đặt kỳ tiếp theo từ thời điểm chạy.

**Lịch tự động:** `/quan-tri/thong-bao` → Báo cáo chat Khách – KTV → bật báo cáo và Gửi qua Zalo → chọn Theo khoảng thời gian, 1 giờ, hoặc Theo ngày và giờ mong muốn → Lưu lịch báo cáo. Lưu lịch bắt đầu kỳ mới; không phải gửi ngay. Thread yên lặng được bỏ qua. Worker kiểm tra lịch mỗi 30 giây.

“Đã gửi” nghĩa là API Zalo chấp nhận tin, không xác nhận người nhận đã đọc. Khi Zalo lỗi, outbox lưu lại và thử tối đa 12 lần với backoff; mã lỗi số được giữ, không log URL chứa Bot Token. Failed rows giữ để vận hành kiểm tra. Worker ngoài giao dịch khách nên lỗi mạng không làm chậm việc lưu tin nhắn/hẹn.

## API quản trị

Các endpoint yêu cầu access token + quyền `roles.manage`: GET `/admin/zalo-bot`, POST `/admin/zalo-bot/pairing`, POST `/admin/zalo-bot/test`, POST `/admin/chat-digest/run`. Không tạo lịch hẹn/chat giả từ nút test. Trang FE có noindex và dùng auth client hiện tại.

## Ranh giới

Không thay Giang Xá, Queue/Chat dùng chung, MongoDB, SMTP hoặc email domain. Không migration. Luồng booking giao dịch `flow=verified` còn thuộc chặng E2 của dự án và chưa tạo appointment ở production; báo cáo này xác minh yêu cầu hẹn KTV đang chạy thực tế. Nếu mở luồng appointment giao dịch về sau, phải bổ sung notification hook tại sự kiện commit được chấp nhận.
