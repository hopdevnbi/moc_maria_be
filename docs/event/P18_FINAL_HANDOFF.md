# P18 – Bàn giao cuối: Event mở hộp quà Mộc Maria

Ngày tổng hợp: 15/10/2026. P18 là chặng bàn giao bổ sung theo yêu cầu mới; kế hoạch được duyệt ban đầu có P00–P17 (18 chặng).

## 1. Những phần đã hoàn thành, có commit trên main

| Chặng | Nghiệm thu source | Git commit |
| --- | --- | --- |
| P13 | Báo cáo/đối soát Super Admin, CSV an toàn, không lộ PII | BE 1249299, FE 8c9486a |
| P14 | DB-backed rate limit cho mở hộp, cấp QR, verify, redeem | BE 8dab8aa |
| P15 | Full regression và tài liệu QA gate, test ẩn dashboard với Admin thường | BE 04d5d99, FE 9a7e916 |
| P16 | Host riêng event.mocmaria.com trỏ vào trang mở hộp; sửa rewrite bằng Next 16 Proxy | FE b6d32c1, 03a9499 |
| P17 | Runbook deployment/migration/rollback và script smoke chỉ đọc | BE 6bc405f, FE f8c6e29, e4d932a |
| P18 | Biên bản nghiệm thu, trạng thái production, danh sách blocker, điểm bàn giao | Tài liệu này |

## 2. Kết quả test

- Backend: **33/33 suites, 155/155 tests**; TypeScript, ESLint vùng Event và Nest production build PASS.
- Frontend: **48/48 suites, 180/180 tests**; TypeScript, lint vùng Event và Next production build PASS.
- Bổ sung unit mới: các test về phân quyền báo cáo, rate limiting, CSV formula injection, idempotency/redeem, và host routing.
- **Chưa có** kiểm thử đồng thời trên PostgreSQL QA cô lập, đo tải nhiều người hay Safari/iOS/Android thực tế. Các con số PASS trên không bao gồm các bước đó.

## 3. Trạng thái triển khai production đã đọc/đối chiếu

- event.mocmaria.com đã gắn trên Vercel và chứng chỉ HTTPS hoạt động. GET / và GET /event đều HTTP 200 với title landing Mở hộp quà – Nhận yêu thương, sau fix P16.
- GET mocmaria.com/ vẫn là trang chủ thông thường. Release FE được quan sát chạy SHA f8c6e29 sau fix; bản sửa ASCII-only smoke e4d932a được push tiếp theo và không thay giao diện.
- Smoke GET/OPTIONS cuối: Event host root, Event /event, Event /api/release và website chính **PASS**. GET API api.mocmaria.com/api/v1/gift-events/current trả **404**; credentialed CORS preflight từ Event origin **chưa PASS**.
- Vì API Event chưa có trên production, không xác thực được chức năng voucher thật. Không có lần mở hộp hay đổi quà production nào được thực hiện trong phiên này.

## 4. Các BLOCKER bắt buộc xử lý trước mở sự kiện

1. **P10 chưa thực hiện**: FE vẫn khóa nút mở hộp thật, dù backend P07 có engine. Phải nối POST, hiển thị kết quả chỉ sau commit, retry/idempotency và UX a11y.
2. Backend production cần release image chứa GiftEventsModule và kiểm tra /api/v1/gift-events/current; deploy với flag GIFT_EVENTS_ENABLED=false ban đầu.
3. DBA/release owner phải rehearsal tại DB QA cô lập rồi chỉ áp migration production khi được duyệt: P04 1791900000000, P12 1791900100000, P14 1791900200000.
4. Phải cấu hình credentialed CORS cho https://event.mocmaria.com trong khi giữ toàn bộ origin cũ. Kiểm tra lại CSRF, refresh-cookie, login/logout thực tế trên Chrome/Safari.
5. Quầy hiện nhập QR qua đầu đọc kiểu bàn phím. Camera điện thoại chưa được phát triển/nghiệm thu; không nên quảng cáo tính năng đó.
6. Hoàn thành các test PRD EC01–EC40 và AT01–AT40 trên QA cô lập, gồm đổi quà đồng thời, mất mạng, hết hạn, sai chi nhánh và thử tải cao.
7. Phê duyệt pháp lý/chương trình khuyến mại/thuế, giá trị quà, ngân sách, thể lệ, nhân viên chịu trách nhiệm nhận quà và phương án xử lý sự cố.

## 5. Bảo vệ hệ thống hiện hữu và lệnh chạy lại

- P11–P17 thay đổi riêng Event, tạo migration additive. Không có force push, thay DNS khác, thay lịch hẹn, KTV, chat, tiền khách, hay phát voucher production.
- Source BE: hopdevnbi/moc_maria_be trên main. Source FE: hopdevnbi/moc_maria_fe trên main.
- QA tự động: backend npm test -- --runInBand, npm run typecheck, npm run build. Frontend npx vitest run, npm run typecheck, npm run build.
- HTTP smoke chỉ đọc: chạy scripts/event-release-smoke.ps1 trong repo FE bằng PowerShell Windows. Script cố tình trả exit 1 nếu Event API/CORS hoặc host chưa đạt; **không** dùng bất kỳ thủ thuật bỏ qua lỗi để bật event.
- Tài liệu chuyên biệt: docs/event/P12_COUNTER.md, P13_RECONCILIATION.md, P14_ABUSE_PREVENTION.md, P15_QA_GATE.md, P17_RELEASE_RUNBOOK.md; bên FE có docs/event/P16_EVENT_HOST.md.

## 6. Kết luận và điểm dừng

P13–P18 đã hoàn thiện phần code, QA tự động và gói bàn giao trong phạm vi đã nêu. **GO-LIVE = NO-GO** tới khi tất cả blockers mục 4 được xử lý và chủ hệ thống duyệt bước phát thưởng thật. Dừng, không tự triển khai P10, không chạy migration hoặc bật campaign bằng dữ liệu kinh doanh.
