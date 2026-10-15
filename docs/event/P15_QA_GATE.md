# P15 – Quality gate tổng thể

## Test tự động (2026-10-15)

- Backend: 33 suites, 155 tests PASS; TypeScript và Nest build PASS.
- Frontend: 46 suites, 175 tests trước khi thêm test P15, TypeScript và Next production build PASS.
- Bao gồm unit về idempotency, quyền truy cập, hạng VIP, quà trùng, token QR, rate-limit và CSV formula injection.
- Không dùng dữ liệu thực, tài khoản thật hoặc làm thay đổi phần thưởng production.

## Chưa nghiệm thu – chặn go-live

- Chưa có E2E PostgreSQL cô lập: test yêu cầu NODE_ENV=test, DATABASE_URL ở localhost hoặc 127.0.0.1 và tên DB moc_maria_qa. Chưa thử 2 staff đổi quà đồng thời ở DB thật, migration rollback hay cleanup.
- Chưa kiểm thử tải nhiều người, DB lock contention và multi-pod. Unit mock không thể thay thế load test.
- Chưa test Chrome/Safari trên iOS/Android thật và kích thước 320/375/390/768/1024/1440 px, reduced motion/a11y.
- P10 POST mở hộp và hoạt ảnh đang KHÓA ở frontend. Backend P07 có endpoint nhưng chưa có luồng FE nghiệm thu. Chưa thể công bố sự kiện phát thưởng.
- Trang quầy /nhan-qua dùng đầu đọc QR dạng bàn phím; camera điện thoại chưa hoàn thiện/QA.
- P04/P12/P14 migrations chưa được release owner áp dụng ở production, GIFT_EVENTS_ENABLED phải OFF.
- Điều lệ, ngân sách, giải thưởng, thủ tục khuyến mại/thuế và người chịu trách nhiệm bàn giao cần được chủ hệ thống phê duyệt.

## Quy trình QA đề xuất trên môi trường cô lập

1. Backup DB QA; áp migration P04 rồi P12 rồi P14 đúng thứ tự, KHÔNG chạy production.
2. Seed sự kiện nháp và khách/nhân viên giả lập với các hạng THƯỜNG, VIP1, VIP2; nhân viên cấp quyền quầy theo branch.
3. Test PRD EC01–EC40 và AT01–AT40: hai lượt cùng user, hai quầy cùng token, retry cùng key và key mới, QR expired/renewed, sai branch, thay hạng VIP sát giao dịch.
4. Test load theo actor QA; kiểm tra 429, chờ lock, stock/budget nhất quán và log không chứa PII/QR token.
5. Đối chiếu issued theo entry, stock per prize, redeem history, snapshot liability và reserved budget. Không tự chỉnh số liệu lệch.
6. Test Chrome/Safari mobile thật trên event.mocmaria.com: login, refresh-cookie, logout, CORS, viewport, reduced-motion, QR không vào URL/storage.

**Gate: NOT READY FOR GO-LIVE.** Test tự động PASS không có nghĩa đã đủ điều kiện mở event thật.
