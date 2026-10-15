# AUDIT_EVENT_MOC_MARIA.md

**Dự án:** Mộc Maria – Event Mở Hộp Quà / Nhận Voucher  
**Chặng:** P00 (01/18), đánh giá mã nguồn và phạm vi trước phát triển  
**Ngày:** 2026-10-15 | **Loại thay đổi:** chỉ tài liệu  
**Nguồn:** GitHub main BE `2305a3db214cbc3a32552bc3af252dbc6eeb7e13` và FE `9b0edce2c68387dd9aed76d3717135c11ebc72e8`.  
**Giới hạn:** GitHub đã xác minh; KHÔNG truy cập được tunnel/worktree Windows, secrets, cấu hình DNS thực tế, Supabase production hoặc trạng thái triển khai runtime. Không giả định production đồng nhất với main. Không chạy test, migration hoặc chỉnh dữ liệu.

## 1. Tóm tắt quyết định kiến trúc

- **Nên làm module độc lập:** backend `src/modules/gift-events/`, frontend `src/features/gift-events/` và `src/app/su-kien/`; admin route `/quan-tri/su-kien`. Giữ riêng ngân sách, tồn, phát thưởng và đổi quà; không nhúng vào engine bookings hay customer-management.
- **MVP:** 1 event LIVE trên landing ở một thời điểm; 1 lượt/tài khoản/event; 6 hộp cùng pool giải; mặc định chỉ hạng THƯỜNG (backend hiện gọi `STANDARD`); đúng hạng mới được tham gia; guaranteed prize; giới hạn tồn thực; phát hành voucher/đồ uống/vật phẩm; quà tiền mặt mặc định **TẮT** chờ rà soát pháp lý/chứng từ.
- **Không coi là đã có voucher:** theo danh mục `src/modules` BE hiện hành KHÔNG có gift-events, voucher, promotions, reward-wallet hoặc beverage-inventory module chuyên biệt. Quote booking đã có trường discount, nhưng đó KHÔNG chứng minh engine voucher/checkout có khả năng áp voucher.
- **Không sửa domain/auth trước khi test:** FE hiện gọi API ở `api.mocmaria.com`, có access token trên client + refresh-cookie từ API; thêm `event.mocmaria.com` phải nghiệm thu login/refresh/CORS/session trên trình duyệt thật. Chỉ bật DNS/SSL ở P16 sau phê duyệt.

## 2. Inventory có dẫn chứng theo source

| Lĩnh vực | Đã có trong main | Tái sử dụng / thiếu hụt |
|---|---|---|
| Identity/RBAC | Các vai trò SUPER_ADMIN, ADMIN, BRANCH_MANAGER, RECEPTIONIST, THERAPIST, DOCTOR_CONSULTANT, CUSTOMER; các permission admin/customer/staff tồn tại ([BE identity.constants:1-24](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/identity/identity.constants.ts#L1-L24)). | Cần quyền event riêng: event.manage, event.prizes.manage, event.redeem, event.audit.read; không mặc định dùng staff.manage cho nhân viên quầy. |
| Người dùng | users có UUID, is_active và quan hệ customer ([user.entity:15-54](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/identity/entities/user.entity.ts#L15-L54)); bảng customers có avatar ([customer.entity:12-37](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/identity/entities/customer.entity.ts#L12-L37)). | Xác thực server-side và khoá tài khoản khi mở quà. |
| Hạng hội viên | VIP lưu app_metadata theo key `mocmaria.customer.vip.<uuid>`, có isVip, expiresAt, level ([customer-management.service:81-115](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/customer-management/customer-management.service.ts#L81-L115)); level 1..99, fallback 1 ([vip-level.ts:1-5](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/shared/membership/vip-level.ts#L1-L5)). Customer API trả tier STANDARD hoặc VIP và level ([profiles.service:193-220](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/profiles/profiles.service.ts#L193-L220)). | Adapter server-side: STANDARD→THƯỜNG; VIP + level→VIP1…VIP99; hết hạn→THƯỜNG; không dùng badge client làm quyền. Default `['STANDARD']` và exact-match. |
| Quản trị VIP | Admin có endpoint danh sách và cấp VIP, có lý do + hạn sử dụng ([customer-management.controller:26-74](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/customer-management/customer-management.controller.ts#L26-L74)); DTO level 1–99 ([DTO:49-67](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/customer-management/customer-management.dto.ts#L49-L67)). | Event tuyệt đối không tự nâng VIP hoặc thay đổi hồ sơ hội viên. |
| Auth | API auth register/login/refresh/logout, change-password ([auth.controller:27-125](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/auth/auth.controller.ts#L27-L125)). Cookie refresh tên `moc_maria_refresh`, scope `/api/v1/auth`, domain cấu hình ([auth.controller:140-164](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/auth/auth.controller.ts#L140-L164)). | Phải kiểm tra SameSite, cookie Domain, CORS và redirect ở subdomain khác; FE bearer access token cần khôi phục bằng refresh. |
| FE API | `apiRequest` gửi bearer và `credentials:'include'` ([auth-api:14-28](https://github.com/hopdevnbi/moc_maria_fe/blob/9b0edce2c68387dd9aed76d3717135c11ebc72e8/src/features/auth/auth-api.ts#L14-L28)); `AuthProvider` refresh khi mount ([AuthProvider:22-63](https://github.com/hopdevnbi/moc_maria_fe/blob/9b0edce2c68387dd9aed76d3717135c11ebc72e8/src/features/auth/context/AuthProvider.tsx#L22-L63)). | Tái sử dụng context hiện có trong cùng app; không tạo hệ thống login thứ hai. |
| CORS | Nest dùng allowlist cấu hình và chặn origin không hợp lệ cho request có cookie auth ([configure-application:13-39](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/bootstrap/configure-application.ts#L13-L39)). `CORS_ORIGINS` và `AUTH_COOKIE_DOMAIN` là env ([validation:3-25](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/config/environment.validation.ts#L3-L25)). | Yêu cầu thêm `https://event.mocmaria.com` vào allowlist khi domain sẵn sàng; thử request preflight và refresh-cookie trên Chrome/Safari. |
| Catalog | `services`, `service_variants` có priceVnd/duration/isActive ([service.entity](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/catalog/entities/service.entity.ts), [variant.entity](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/catalog/entities/service-variant.entity.ts)); API catalog công khai/quản trị sẵn ([catalog.controller](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/catalog/catalog.controller.ts)). | Liên kết voucher với service/variant/branch ID thật; không gắn giá từ tên chuỗi. Chưa chứng minh có SKU/tồn kho đồ uống. |
| Chi nhánh | API branches/hours và quyền staff manage ([branches.controller:26-100](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/branches/branches.controller.ts#L26-L100)). | Đổi quà tại quầy gắn branchId và user đổi quà; bắt buộc kiểm tra chi nhánh hoạt động. |
| Booking | appointments có status, idempotencyKey, fingerprint và version ([appointment.entity:9-49](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/bookings/entities/appointment.entity.ts#L9-L49)); appointment_quotes có discountVnd, totalVnd, snapshot ([appointment-details.entity:27-42](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/bookings/entities/appointment-details.entity.ts#L27-L42)). | Booking đang được AI khác chỉnh; KHÔNG chèn voucher trực tiếp vào lifecycle ở P00–P08. Đổi voucher online chỉ sau khi audit checkout giao dịch hoàn chỉnh ở chặng phù hợp. |
| CDN/media | `StaffAvatarStorage` dùng Sharp và Bunny Storage ([staff-avatar-storage:8-80](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/profiles/staff-avatar-storage.ts#L8-L80)); endpoint customer avatar chỉ cho VIP và staff upload có guard ([profiles.controller:49-70](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/profiles/profiles.controller.ts#L49-L70)). | Tái sử dụng thuật toán tối ưu WebP và hạ tầng Bunny nhưng cần **endpoint/đường dẫn media Event riêng**, guard permission, size, mime và lifecycle; tuyệt đối không tái sử dụng endpoint avatar VIP cho quà. |
| DB/migration | PostgreSQL TypeORM; `synchronize:false`, `migrationsRun:false`, default UTC ([database-options:18-42](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/database/database-options.ts#L18-L42)); migrations hiện trong `src/database/migrations`. | Cần migration bổ sung, rollback và test DB cô lập; **đơn vị khác đang giữ quyền migration release**. |
| Nhật ký | Bảng audit_logs với event/actor/target/metadata/timestamp ([audit-log.entity:3-22](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/src/modules/identity/entities/audit-log.entity.ts#L3-L22)). | Có thể dùng audit service hiện tại, nhưng event ledger/quyền lợi là bảng riêng, không coi audit_log là tồn kho. |
| FE/admin | Next.js app router đã có `src/app/quan-tri`; navbar phân quyền theo roles và permission ([admin-shell:38-145](https://github.com/hopdevnbi/moc_maria_fe/blob/9b0edce2c68387dd9aed76d3717135c11ebc72e8/src/features/marketplace/admin-shell.tsx#L38-L145)). `next.config.ts` hiện chỉ khai báo headers/turbopack, chưa thấy host routing/rewrite ([next.config.ts:1-47](https://github.com/hopdevnbi/moc_maria_fe/blob/9b0edce2c68387dd9aed76d3717135c11ebc72e8/next.config.ts#L1-L47)). | Tránh sửa marketplace CSS/layout chung. P09 thêm route /su-kien với CSS module riêng, host rewrite/DNS chỉ P16. |
| FE/data | Hook private API dùng query theo user.id và invalidate sau mutation ([private-api:1-42](https://github.com/hopdevnbi/moc_maria_fe/blob/9b0edce2c68387dd9aed76d3717135c11ebc72e8/src/features/marketplace/private-api.ts#L1-L42)). | Event dùng key `event` riêng, không cache công khai thông tin lượt/quà/ví khách. |

## 3. Độ sẵn sàng & rủi ro

1. **BLOCKER: chủ sở hữu vùng code khác đang hoạt động.** GitHub main ở snapshot kể trên; registry `.project/plan/14_ACTIVE_WORK.json` vẫn có claim ACTIVE cho E2a booking/catalog/branches/profiles/migrations và FE marketplace/app; Zalo và KTV workspace cũng có claim ACTIVE. Chưa kiểm tra được worktree trên Windows. Tham chiếu: [registry BE](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/.project/plan/14_ACTIVE_WORK.json), [registry FE](https://github.com/hopdevnbi/moc_maria_fe/blob/9b0edce2c68387dd9aed76d3717135c11ebc72e8/.project/plan/14_ACTIVE_WORK.json), [quy tắc phối hợp](https://github.com/hopdevnbi/moc_maria_be/blob/2305a3db214cbc3a32552bc3af252dbc6eeb7e13/docs/WORK_COORDINATION.md#L3-L22). Không được tự suy ra claim đã giải phóng từ timestamp.
2. **HIGH: nghiệp vụ thưởng có giá trị.** Cấp quà phải transaction PostgreSQL, unique(eventId,customerId,turn), quota + stock + budget khóa atomically; idempotency key độc lập từ booking và unique redemption; server quyết định giải, client chỉ trình diễn.
3. **HIGH: quyền & gian lận.** Không dựa vào cookie/front-end VIP badge/đồng hồ client. Gọi actor user từ auth guard; kiểm tra is_active, tier tại thời điểm giao thưởng, hạn mức theo server, captcha/rate-limit nếu lạm dụng, server QR token hash + TTL + single-redeem.
4. **HIGH: pháp lý & chi phí.** Event có cơ chế chọn ngẫu nhiên và phần thưởng tiền mặt; rà soát điều lệ, công bố, thủ tục khuyến mại, thuế/chứng từ trước kích hoạt. Tiền mặt mặc định disabled, không thiết kế như trò cá cược/trả tiền lấy lượt. Phần trăm trọng số thực và xác suất công bố phải không đánh lừa.
5. **HIGH: cross-domain auth.** Đăng nhập qua event.mocmaria.com cần test trên iOS/Safari và Chrome, HTTPS, SameSite, cookie Domain, CSRF/origin checks, callback returnTo, đăng xuất đồng bộ. Không thay đổi CORS/Domain env khi chưa thử staging.
6. **MEDIUM: SKU/đồ uống & voucher.** Backend catalog hiện phục vụ services/variants, chưa chứng minh tồn kho hoặc checkout hoàn chỉnh cho đồ uống, gift card, cash. MVP quà counter-only dùng cấu hình item độc lập + branch inventory, không giả là hàng tồn POS.
7. **MEDIUM: animation & asset.** WebP/AVIF responsive, CSS nhẹ, prefers-reduced-motion, 360–1440 px; hộp quà cùng pool xác suất, không tạo ảo giác từng hộp có thưởng khác nhau nếu không có rules.

## 4. Dependency map đề xuất

    Identity/Auth + Customer/VIP         Catalog + Branches
                |                               |
                v                               v
        Event eligibility adapter      Reward definitions / scopes
                \                         /
                 v                       v
                Gift Event Engine (transaction, rate limits)
                 |              |              |
            Event turns    Prize stock      Audit/ledger
                 \              |             /
                  v             v            v
                  Issued Rewards + Customer Wallet
                                |
                    Redeem service (one-time)
                       |                  |
              Counter scan           Booking integration
               (MVP)                (AFTER audit checkout)

- Dùng bảng đề xuất: `gift_events`, `gift_event_eligible_tiers`, `gift_prizes`, `gift_prize_stock`, `gift_opens`, `gift_issued_rewards`, `gift_redemptions`, `gift_event_audit`. Cấu trúc cuối P03/P04 quyết định, không migrate ở P00.
- Các trạng thái event: DRAFT, SCHEDULED, LIVE, PAUSED, ENDED, ARCHIVED. Thời gian lưu UTC, hiển thị Asia/Ho_Chi_Minh; sự kiện LIVE phải phụ thuộc thời gian server.
- Quà snapshot bất biến tại lúc trao; tách issued khỏi redeemed. Không thu hồi retroactively khi Admin đổi cơ cấu giải.

## 5. Khoanh vùng ownership các chặng sau

| Prompt | Phạm vi thay đổi đề xuất | Tránh chạm vào |
|---|---|---|
| P01 PRD, P02 UI concept, P03 asset | Chỉ thêm `docs/event-*`, asset mới ở `public/event/` sau duyệt | Không sửa homepage/marketplace CSS/layout/auth |
| P04 migration | Chỉ thêm migration `GiftEvent*` + entities trong gift-events/; **phải xác nhận single migration owner trước** | Migrations booking của E2a |
| P05–P08 BE | `src/modules/gift-events/**` + tối thiểu một dòng import app.module.ts khi owner tích hợp rảnh; tests gift-events | bookings/**, providers/**, customer-management/**, Zalo/notifications |
| P09–P11 FE | `src/features/gift-events/**`, `src/app/su-kien/**`; auth context hiện tại, CSS cục bộ | Không sửa src/features/marketplace/** trừ khi có claim riêng |
| P12 quầy | Route và controller gift-events/redeem riêng, permission mới; branchId được tham chiếu chỉ đọc | Không coi quét QR là đã thanh toán đơn |
| P13–P15 | Dashboard/reconciliation trong vùng event + tests bảo mật/QA | Không thay global rate-limit/CORS chưa review |
| P16–P17 | Cấu hình event host staging, DNS/SSL/CI, runbook rollback | Chỉ triển khai khi đã duyệt; không tự sửa secrets của dịch vụ khác |

Cần xin **claim độc lập** cho event và coordinate với E2a trước chạm `src/database/migrations`, `src/app.module.ts`, admin sidebar, `next.config.ts`, `src/app/layout.tsx` hay `src/app/**`.

## 6. Danh sách API dự kiến (để P03 chốt contract)

- Public: GET `/gift-events/current` (thông tin/thể lệ/tier công khai, serverNow).
- Khách đăng nhập: GET `/gift-events/me` (đủ hạng/lượt); POST `/gift-events/:id/open` (idempotencyKey, selectedBoxId); GET `/gift-events/me/rewards`; GET `/gift-events/opens/:id` (khôi phục mất mạng).
- Admin: GET/POST/PATCH `/admin/gift-events`; actions publish/pause/resume/end; quản lý giải và tồn; simulate distribution read-only; exports.
- Quầy: POST `/staff/gift-redemptions/verify` và `/redeem`; recheck actor/branch/QR, transaction one-time, nhật ký người giao/nhận.
- Thiết lập `Cache-Control: private, no-store` cho API nhạy cảm; trả error code ổn định cho UI, không tiết lộ token/điện thoại/email trong QR.

## 7. Câu hỏi/chốt rule chuyển P01

- Mặc định THƯỜNG là STANDARD: chốt hạng chính xác theo thời điểm mở. VIP1–VIP99 chỉ được tham gia nếu admin chọn, không tự bao gồm.
- Chốt MVP 1 lượt/người/event, mỗi lượt có quà; khi hết tồn/budget phải tạm dừng, không phát vé trống.
- Hạng VIP có lượt bổ sung hay không? P00 khuyến nghị **không**, để giữ công bằng và đơn giản.
- 6 hộp khác màu là trải nghiệm giao diện, **chung bảng xác suất server**.
- Voucher giá trị tiền và %: ở MVP cấp vào ví và đổi/quét xác nhận thủ công; áp tự động checkout phụ thuộc audit booking/POS.
- Quà tiền mặt: giữ disabled chờ phê duyệt pháp lý, tài chính, chứng từ.
- Cho phép một hay nhiều sự kiện cùng LIVE? P00 khuyến nghị 1 sự kiện live mỗi landing; lịch có thể chuẩn bị nhiều.
- Có yêu cầu nhận quà ở chi nhánh cụ thể? Khuyến nghị có list allowedBranchIds cho từng giải.

## 8. Kết quả nghiệm thu P00

**CODE:** không thay đổi FE/BE; chỉ thêm tài liệu này.  
**TEST:** không chạy test runtime; đối chiếu source mã nguồn GitHub và registry, kiểm tra quyền repo và HEAD hai repo.  
**COMMIT:** commit chỉ chứa tài liệu; hash ghi trong báo cáo bàn giao sau push.  
**DEPLOY:** không deploy, không thay đổi DNS/CORS/DB/secrets/production.  
**BUSINESS_DATA:** không tạo khách/event/voucher/lượt mở/quà thực.  
**CHƯA XÁC MINH:** trạng thái worktree cục bộ, registry đã cập nhật bên ngoài GitHub, env/Vercel/Cloudflare runtime và số lượng quà thực. Kiểm tra lại các điểm này bắt buộc trước P04/P16.

**Cổng duyệt:** Chờ chủ dự án nói OK mới bắt đầu P01 (PRD, rules và Given-When-Then); không tự code tiếp.
