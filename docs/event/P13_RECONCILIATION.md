# P13 — Dashboard và đối soát

GET /admin/gift-events/:eventId/report và GET /admin/gift-events/:eventId/report/csv
chỉ cho Super Admin đang hoạt động. Response private/no-store; CSV download
chống formula injection và có BOM UTF-8 hỗ trợ tiếng Việt.

Số liệu được chụp trong transaction REPEATABLE READ: số lượt duy nhất,
quà đã phát, đã nhận, hết hạn, bị hủy, chưa sử dụng, tồn kho từng loại,
giá trị dự phòng, giá trị liability theo snapshot và số nhận quà tại từng cơ sở.
Ngày được nhóm theo Asia/Ho_Chi_Minh.

Các sai lệch đều được gắn mã và hiển thị cảnh báo, **không sửa dữ liệu tự động**:
ENTRY_REWARD_MISMATCH, REWARD_STATUS_MISMATCH, PRIZE_STOCK_MISMATCH,
REDEEM_HISTORY_MISMATCH, LIABILITY_BUDGET_MISMATCH.

Giao diện Super Admin: /quan-tri/su-kien/bao-cao. Không có số điện thoại,
email hay token QR trong báo cáo. Không được xem đối soát là chứng nhận
khuyến mại hoặc quyết toán thuế. Chưa chạy dữ liệu live hoặc migration production.
