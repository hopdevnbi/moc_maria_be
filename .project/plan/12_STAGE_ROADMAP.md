# Chặng triển khai từ Phase 03 tới Phase 08

| Chặng | Phạm vi | Mốc báo cáo/nghiệm thu |
|---|---|---|
| A — Chốt nền hiện có | QA fixes còn treo; sync checklist/ownership | Test PASS, commit/push, FE production verified; không reset checkout khác |
| B — Hồ sơ và eligibility | P03-T26/27/32; consent, xác minh liên hệ có bằng chứng, điều kiện phục vụ fail-closed | User không tự xác minh/duyệt; dữ liệu private; gate server và UI thực |
| C — Skills và lịch | P03-T09..15/18..20/25/31/33 | Skill/service/branch mapping, shift/override/time-off, legal/territory gate; kiểm tra overlap |
| D — Đào tạo chi tiết | P03-T28..30 | Sessions/instructor/attendance, assessments/renewal/history, cert revoke tức thì |
| E — Booking và quote | Phase 04 + booking FE Phase 05 | Request→provider accept→customer quote accept; concurrency/idempotency/PII; đổi/hủy/complete |
| F — Portal/chat/trust | Phase 06 + quality Phases 03/04/07 | Chat MOC_MARIA tenant isolation; review chỉ booking hoàn tất; moderation/appeals audit |
| G — Operations | Phase 07 | Booking command center, profile/RBAC/audit UI, CMS/media/report theo dữ liệu thật |
| H — Production hoàn chỉnh | Phần còn lại Phase 05/08 | Bunny riêng, SEO/performance, notification/queue, backup restore/monitoring, full E2E/rollback |

Mỗi chặng báo cáo kết quả thực tế rồi tiếp tục tự chủ. Chặng có thể tách nhỏ để mỗi commit/deploy review được. Không đóng phase khi critical gate chưa PASS. Owner data/access cần hỏi chỉ khi thực sự phụ thuộc; tiếp tục phần độc lập.

Verified release: A/B/C1/C2/D1 done and deployed. Current D2 ACTIVE; D1 does not close P03-T28/T29/T30 until computed training completion/practical assessment/renewal acceptance. E/F/G/H still open.
