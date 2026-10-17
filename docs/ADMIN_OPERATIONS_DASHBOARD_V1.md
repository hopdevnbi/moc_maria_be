# Mộc Maria - Admin Operations Dashboard V1 (17/10/2026)

## Audit - nguồn dữ liệu đúng nghiệp vụ

- `app_metadata` với key `mocmaria.inquiry.%` là nguồn cho **yêu cầu đặt lịch**. Mỗi yêu cầu được tính **một lần** theo `value.createdAt`, kể cả khi đã có `appointmentId`.
- `appointments.status` thắng `inquiry.status` khi yêu cầu đã chuyển thành lịch chính thức. Tái sử dụng `inquiryStateSql` hiện có; không cộng thêm toàn bộ bảng `appointments` và gây đếm trùng.
- `provider_applications`, `users` và `provider_reviews` cung cấp hồ sơ KTV, tình trạng kích hoạt, số công việc và feedback đã công bố. Phần đánh giá là thông tin công khai, không trả email hoặc số điện thoại khách.
- `services.is_published` là số dịch vụ công bố; không lấy số dịch vụ trong dữ liệu demo để giả số.
- Chưa có nguồn xác nhận doanh thu **đã thanh toán/đối soát**; dashboard không gọi số tiền bảng giá là doanh thu.
- Chưa có nguồn KTV Socket presence **được xác thực**; phân biệt trạng thái hồ sơ, lịch đang phục vụ với online/offline thật.

## API và quyền

`GET /api/v1/admin/dashboard/overview?period=day|month|year&date=YYYY-MM-DD`

`GET /api/v1/admin/dashboard/providers/:id?period=day|month|year&date=YYYY-MM-DD`

Chỉ ADMIN hoặc SUPER_ADMIN có **đồng thời** `customers.manage` và `staff.manage`, qua JWT và permissions guard. Response `private, no-store`; phân quyền được kiểm tra **trước** khi tra cache. Kỳ thống kê theo lịch `Asia/Ho_Chi_Minh` (UTC+7), `to` là exclusive.

## Hiệu năng

- Gộp các nhóm COUNT/GROUP BY trong SQL, không tải toàn bộ danh sách về frontend để đếm.
- Cache in-memory trên API pod 60s, 24 key tối đa, promise single-flight cho các request đồng thời cùng kỳ.
- Frontend React Query không tải provider feedback cho tới khi mở drawer; skeleton và retry có trạng thái riêng.
- Refetch 90s khi có quyền, Socket `catalog-changed` làm tín hiệu invalidation; sự kiện `appointments-changed` mới là hook dự phòng, **chưa có publisher**.
- Không dùng socket công khai để truyền số liệu KPI hoặc danh tính khách hàng.
- Với tập dữ liệu lớn hơn, cần index/rollup và benchmark EXPLAIN (ANALYZE,BUFFERS), tránh lạm dụng truy vấn JSONB trên mọi request.

## Những phần cần triển khai tiếp để đạt yêu cầu realtime/Queue đầy đủ

1. **Queue**: trong source `acutis_education_queue`, namespace `reports` đang không có job name/handler. Không gửi công việc giả vào Queue. Thiết kế job `reports.moc-maria.daily-rollup`, worker có quyền DB tối thiểu, bảng tổng hợp theo ngày/chi nhánh và idempotency; test retry, duplicate, worker restart, reconcile before rollout.
2. **Socket**: source `acutis_education_chat` hiện chỉ phát `moc-maria:catalog-changed` và các event chat khác. Cần một kênh thông báo lịch hẹn có backend auth (không cho client tự phát), truyền revision/counter không PII; FE invalidate có cooldown.
3. **KTV presence**: thiết kế heartbeat cho phiên đã xác thực tại service của Mộc Maria, TTL/expiring disconnected sockets, multi-node Redis adapter. Hiển thị `Online / Offline` chỉ khi presence có nguồn hợp lệ; hiện chỉ hiện `Đang phục vụ / Hồ sơ hoạt động / Tạm ngưng`.
4. **Thu tiền**: chỉ tạo KPI doanh thu sau khi nguồn POS/hoá đơn/thu tiền và hoàn tiền được đối soát.
5. **Chi tiết sâu hơn**: drill-down hiện chỉ trên tối đa 60 KTV trong bảng lãnh đạo, reviews trả tối đa 8 phản hồi công bố. Khi KTV > 60, cần phân trang/tra cứu API riêng.
6. **Production**: không có quyền SSH từ workspace trong lượt triển khai này. BE container đã build trên GitHub nhưng không khẳng định được K8s Mộc Maria đang chạy image đó. Kiểm tra deployment, backup DB, health và đường dẫn quản trị sau rollout, không đánh đồng push `main` với deploy.

## Kiểm thử source

Backend `npm run quality`: 188/188 unit tests PASS (bao gồm khung thời gian UTC+7, quyền, coalescing). FE `npm run quality`: 211/211 tests PASS; Next.js build PASS. Chưa có DB E2E production và browser smoke sau deploy.
