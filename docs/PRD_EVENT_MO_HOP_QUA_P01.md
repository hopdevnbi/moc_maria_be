# PRD P01 — MỘC MARIA: MỞ HỘP QUÀ, ĐÓN NIỀM VUI

**Trạng thái:** BẢN P01 CHỜ CHỦ DỰ ÁN DUYỆT (chưa triển khai code)  
**Ngày:** 15/10/2026  
**Chặng:** 02/18 (P01); sau chặng này còn 16 chặng P02–P17.  
**Landing dự kiến:** `https://event.mocmaria.com` (chưa cấu hình DNS/SSL)  
**Nguồn kỹ thuật:** [Audit P00](./AUDIT_EVENT_MOC_MARIA.md), BE main `5c9f99b0cc8880fc6c70f5d056ff4ab5de646d78`, FE main `9b0edce2c68387dd9aed76d3717135c11ebc72e8` tại thời điểm đối chiếu.  
**Chủ trương:** Triển khai từng chặng, có commit/push độc lập và chờ phê duyệt. Không tự chuyển P02.  
**Thuật ngữ:** THƯỜNG = `STANDARD`; VIP1..VIP99 = `VIP` đang hiệu lực + `level` thực trên máy chủ. "Lượt mở" không đồng nghĩa "phiếu trúng đã đổi".

---

## 1. Tóm tắt sản phẩm và mục tiêu

**Tên chiến dịch (đề xuất):** MỞ HỘP QUÀ — NHẬN YÊU THƯƠNG.  
**Thông điệp:** “Một món quà nhỏ, một lời cảm ơn thật lòng.”  
**Mục tiêu người dùng:** Sau khi đăng nhập, khách đủ điều kiện được chọn 1 trong 6 hộp, xem hoạt ảnh mở quà, biết ngay kết quả và tìm thấy phần thưởng trong "Ví quà của tôi"; nếu cần nhận tại quầy, nhân viên xác thực mã trước khi giao.  
**Mục tiêu quản trị:** Super Admin/nhân sự được phân quyền tự tạo chiến dịch, định ngày giờ, chọn hạng khách, cấu hình cơ cấu giải/tồn/giới hạn ngân sách, tạm dừng, xem lượt phát, kiểm tra và đối soát lượt đổi.  
**Mục tiêu an toàn:** Không phát quá tồn/quỹ; không dùng quay random trên client; không tạo giải giả; không đếm hai lượt do refresh/mất mạng; không cho dùng QR hai lần; không tiết lộ dữ liệu khách hàng.
**Không phải:** trò chơi thu phí/lấy tiền để mở; chương trình dùng cơ chế “mua lượt”; hoạt động chuyển tiền tự động; hệ thống đặt lịch hay checkout mới.

### 1.1 Phạm vi MVP được đề xuất

- 01 event hiển thị LIVE trên `event.mocmaria.com` tại một thời điểm; có thể quản lý nhiều bản nháp và sự kiện lên lịch.
- 06 hộp có thiết kế khác nhau, **cùng một pool phần thưởng/xác suất**; chọn hộp chỉ ảnh hưởng hiệu ứng, không giúp tăng xác suất.
- **01 lượt mở / khách / event**, bất kể hạng; Admin có thể chọn nhiều hạng tham gia, mặc định chỉ THƯỜNG.
- **100% lượt được ghi nhận thành công nhận một phần thưởng**, với điều kiện có quà khả dụng. Hết quà/quỹ thì ngừng phát và không trừ lượt.
- Hỗ trợ giải voucher giảm số tiền, voucher giảm %, thẻ quà tặng định danh, đồ uống và vật phẩm đổi tại quầy. Quà tiền mặt có thể cấu hình dạng bản nháp nhưng **không được kích hoạt trong MVP cho đến khi thủ tục pháp lý/kế toán được duyệt**.
- Khu vực quản trị, báo cáo, nhật ký; ví quà và phiếu nhận quà; quầy xác minh/đổi quà.
- Chưa tự động áp voucher vào booking/checkout/POS nếu chưa có contract và thử nghiệm riêng.

### 1.2 Các vai trò

| Vai trò | Được làm | Giới hạn |
|---|---|---|
| Người xem chưa đăng nhập | Xem landing, thời gian, quà có thể có, điều lệ, nút đăng nhập | Không được mở/nhận/tra ví cá nhân |
| Khách THƯỜNG | Tham gia khi event chọn `STANDARD`; xem ví của mình | Không được quyền VIP nếu chưa có VIP còn hạn |
| Hội viên VIP1, VIP2, ... | Tham gia **chỉ khi hạng chính xác nằm trong danh sách cho phép** | VIP1 không tự được tham gia event chỉ dành VIP2 |
| Nhân viên quầy | Kiểm tra phiếu, đổi quà tại chi nhánh được giao, xem lịch sử giao của mình | Không sửa xác suất/giải/ngân sách/hạng |
| Quản lý chi nhánh | Theo dõi đổi quà ở chi nhánh có quyền | Không tự công bố sự kiện hoặc chỉnh quỹ tổng |
| Admin event | Soạn cấu hình, xem báo cáo và cơ cấu quà trong phạm vi permission | Không thể sửa giao dịch trao thưởng đã phát; Super Admin có quyền công bố |
| Super Admin | Toàn bộ cấu hình, thời gian, xuất báo cáo, tạm dừng và kiểm soát phân quyền | **Không được xoá dấu vết/quà đã phát**, không vượt invariant giao dịch |

Gợi ý quyền backend: `event.manage`, `event.prizes.manage`, `event.publish`, `event.redeem`, `event.audit.read`. Mọi endpoint bắt buộc guard phía backend; UI ẩn nút chỉ tăng tiện ích, không thay thế phân quyền.

---

## 2. Hành trình khách hàng (journey)

### 2.1 Chưa đăng nhập

1. Mở landing: Hero sang trọng, đồng hồ đếm giờ bắt đầu/kết thúc theo giờ Hà Nội, thể lệ ngắn, 6 hộp minh hoạ, CTA.
2. Nếu chưa đến giờ: CTA “Nhắc tôi khi bắt đầu” chỉ xuất hiện nếu thông báo đã được cấu hình; mặc định “Xem thể lệ”. Không hiển thị nút mở hoạt động.
3. Nếu LIVE: CTA “Đăng nhập để nhận quà”. Chuyển qua login hiện có với returnTo hợp lệ `/su-kien`, sau login quay lại đúng landing.
4. Nếu hết hạn/tạm dừng: hiển thị nội dung thực tế, không tạo cảm giác còn có thể trúng.

### 2.2 Đã đăng nhập

1. FE tải `GET /gift-events/current` (public) và `GET /gift-events/me` (private, không cache) để hiển thị trạng thái.
2. Nếu tài khoản chưa active/không đúng hạng/đã chơi/hết thời gian: thông báo giải thích + CTA thích hợp; **không hiện animation mở có vẻ thành công**.
3. Nếu đủ điều kiện: khách đọc/tích đồng ý thể lệ, chọn hộp (1..6); nút “Mở quà của tôi”.
4. FE tạo idempotency key cho ý định này và POST. Server kiểm tra toàn bộ điều kiện, khoá/quyết định giải, ghi phát thưởng atomically, trả `openId` và phần thưởng.
5. **Chỉ sau khi server xác nhận phát thành công mới chơi animation kết quả**. Mất mạng sau commit: frontend tra `GET /gift-events/me` / `GET /gift-events/opens/:id` để khôi phục đúng giải cũ.
6. Hộp mở → màn kết quả gồm tên quà, giá trị/đơn vị, hạn dùng, điều kiện, “Xem ví quà” và “Nhận tại quầy” nếu áp dụng.
7. Khách xem ví, đưa mã QR tại quầy, nhận xác nhận giao. QR không chứa email/SĐT/token truy cập.

### 2.3 Hành trình quầy

1. Nhân viên đăng nhập role/permission quầy, chọn chi nhánh được phân quyền.
2. Quét mã/nhập mã ngắn → backend chỉ trả thông tin tối thiểu: quà, trạng thái, hạn, chi nhánh được áp dụng, các điều kiện cần kiểm tra; không trả dữ liệu cá nhân không cần thiết.
3. Nhân viên xác minh đúng người theo quy định điểm nhận và xác nhận đã giao thực tế.
4. Backend redeem transaction một lần; phát hành phiếu biên nhận/nội dung lịch sử (ai, chi nhánh, thời gian).
5. Nếu đã đổi/hết hạn/hủy/quét trùng: báo lý do rõ, **không** giao quà lần hai và không tính lại tồn.

### 2.4 Hành trình Admin

Tạo bản nháp → thông tin chiến dịch → thời gian → hạng tham gia → cơ cấu quà → quỹ và kiểm tra → giao diện/nội dung → xem trước/giả lập → công bố → theo dõi live → đóng chiến dịch → đối soát/quà chưa đổi.

---

## 3. Luật hạng và lượt chơi

**R01 — Chính xác hạng:** `STANDARD` là nhóm THƯỜNG. Bản ghi VIP phải `isVip=true`, chưa hết hạn, level là số nguyên 1–99; VIP lịch sử thiếu level hợp lệ được hệ thống hiện hành coi là VIP1; cần thống nhất với adapter có sẵn. Danh sách được phép là **tập hợp hạng rõ ràng**, không có phép so sánh `>= VIP1`.

**R02 — Mặc định:** Khi tạo event, `eligibleTiers=['STANDARD']`. Khi Admin chọn “VIP2” thì không tự động bỏ THƯỜNG hoặc cho phép VIP1/VIP3. UI có checkbox theo hạng, cho xem trước số nhóm được áp dụng nhưng không lộ danh sách khách.

**R03 — Thời điểm kiểm tra:** Kiểm tra account active + role CUSTOMER + tier hợp lệ **trong transaction mở hộp** bằng nguồn tin cậy server. Tình trạng VIP thay đổi sau khi đã cấp quà **không thu hồi giải đã cấp**, trừ trường hợp gian lận được xử lý theo quy trình có audit/điều lệ.

**R04 — 1 lượt:** Tối đa 01 lượt mở thành công/event/userId trong MVP. Có unique constraint và khoá thích hợp. Không cấp thêm lượt VIP mặc định; không dựa vào IP/thiết bị để giới hạn chính.

**R05 — Đồng ý điều lệ:** Lưu version điều lệ tại lúc mở cùng timestamp; từ chối không trừ lượt. Nếu điều lệ đổi trong event LIVE, áp dụng version mới cho lượt kế tiếp và có versioned snapshot.

**R06 — Hạn tuổi/đủ điều kiện khác:** Chưa thiết lập giới hạn tuổi tự động; nếu pháp luật/điều lệ yêu cầu thêm, phải duyệt rule và dữ liệu chứng minh trước mở chương trình, không ngầm dùng ngày sinh tùy chọn.

---

## 4. Trạng thái và thời gian sự kiện

### 4.1 Status event

| Trạng thái | Ý nghĩa | Hiển thị công khai | Có thể mở? |
|---|---|---|---|
| DRAFT | Chưa công bố; chỉnh toàn bộ | Không | Không |
| SCHEDULED | Đã công bố lịch hợp lệ, chưa bắt đầu | Countdown đến giờ | Không |
| LIVE | Đã đến giờ, chưa hết hạn, không bị tạm dừng | Hộp và CTA | Có nếu đủ điều kiện/quỹ |
| PAUSED | Admin tạm dừng hoặc hệ thống dừng vì cạn tồn/quỹ | “Tạm dừng”, giải thích trung tính | Không |
| ENDED | Hết thời gian hoặc kết thúc sớm | “Sự kiện đã kết thúc” | Không |
| ARCHIVED | Lưu trữ sau đối soát | Chỉ lịch sử/landing kết thúc theo lựa chọn | Không |

**Chỉ cho phép:** DRAFT→SCHEDULED/LIVE theo thời gian; SCHEDULED→LIVE tự động bởi serverClock; LIVE→PAUSED/ENDED; PAUSED→LIVE nếu còn hạn, tồn và quỹ; PAUSED→ENDED; ENDED→ARCHIVED. Không cho ENDED→LIVE bằng chỉnh ngày ngầm; muốn tổ chức lại phải clone thành event mới. DRAFT→DRAFT và SCHEDULED→DRAFT chỉ khi chưa có lượt/quà phát và phải được ghi audit. LIVE chỉ có thể cập nhật trường không ảnh hưởng quyền lợi đã cấp (nội dung/ảnh/CTA); chỉnh giải/hạng/ngân sách/tồn phải qua quy trình version và kiểm soát, không xoá bản ghi giải đã cấp.

### 4.2 Thời gian

- Lưu `startAt/endAt` chuẩn UTC, biểu diễn/nhập theo timezone `Asia/Ho_Chi_Minh`, bắt đầu inclusive, kết thúc exclusive: `startAt <= serverNow < endAt`.
- Từ chối `endAt <= startAt`. Không cho publish sự kiện bắt đầu trong quá khứ nếu chưa nêu rõ lý do/chính sách mở bù.
- Landing countdown chỉ tham khảo với serverNow offset, không quyết định tính đủ điều kiện.
- Cho phép nhiều event DRAFT/SCHEDULED; **tối đa một LIVE hiển thị trên landing chính**, xung đột lịch không được publish trùng cửa sổ nếu chế độ single-event.
- Với PAUSED, đồng hồ hết hạn vẫn chạy; không tự gia hạn thời gian. Super Admin có thể gia hạn theo quy tắc công bố và audit trước hạn, không gây mất quyền lợi đã cấp.

---

## 5. Các loại giải & điều kiện

| Loại | Cấu hình tối thiểu | Trao/đổi ở MVP | Lưu ý |
|---|---|---|---|
| VOUCHER_FIXED | Giá trị giảm VND, mức đơn tối thiểu, dịch vụ/chi nhánh áp dụng, thời hạn, maxDiscount không cần | Cấp vào ví; quầy kiểm tra và đánh dấu đổi | Không giảm âm giá; không cho đổi thành tiền mặt |
| VOUCHER_PERCENT | Tỷ lệ 1..100%, giảm tối đa VND, mức đơn tối thiểu, áp dụng theo catalog/branch | Ví + xử lý tại quầy thủ công sau khi kiểm tra hóa đơn | Giảm thực tế `min(rate * eligibleAmount, cap, eligibleAmount)`; quy tắc làm tròn phải chốt P03 |
| GIFT_CARD | Mệnh giá và quy tắc dùng một lần hoặc số dư | MVP đề xuất **phiếu mệnh giá đổi một lần**, không quản lý số dư chia nhỏ | Nếu cần thanh toán nhiều lần, phải có ledger ví tiền/thẻ riêng (Phase 2) |
| PHYSICAL_ITEM | Tên vật phẩm, SKU nội bộ event, ảnh, chi nhánh, tồn | Nhận quầy; ký/đánh dấu đã giao | Không giả đồng bộ tồn kho POS hiện chưa được xác minh |
| TAKEAWAY_DRINK | Tên đồ uống, lựa chọn cố định hoặc quyền đổi trong danh mục, chi nhánh, tồn | Đổi tại quầy | Không giả định drinks đã có catalog độc lập |
| CASH_COUNTER | Số tiền VND, danh tính người duyệt, chính sách KYC/biên nhận/chứng từ, chi nhánh | **TẮT trong MVP** | Chỉ cho bật sau legal/finance gate; không tự chuyển khoản |

Mỗi giải có: `name,description,termsVersion,kind,weight,quantityLimit,enabled,startAt?,endAt?,allowedBranchIds?,redeemBefore?,validityDays?,perUserLimit?,financialExposureVnd,coverAsset`. Mọi quà cấp cần **snapshot dữ liệu/quy tắc** lúc trúng để việc sửa giải về sau không thay đổi quyền đã nhận.

**Hạn dùng:** Nếu admin không đặt rõ, gợi ý mặc định 30 ngày từ lúc cấp cho voucher; vật phẩm/đồ uống phải có lịch nhận cụ thể. Hạn nhận = mốc server, không dùng đồng hồ client; quà hết hạn không tự hoàn trả lượt hoặc tồn trừ khi chính sách/điều lệ được định nghĩa công khai.

**Nội dung cần rõ:** Địa điểm nhận, thời gian hoạt động chi nhánh, dịch vụ/đồ uống áp dụng, có/không kết hợp ưu đãi, phí phát sinh, không quy đổi tiền mặt, ai có quyền sử dụng, cách xử lý hết hàng ở quầy. Trường nào chưa đủ không cho publish.

---

## 6. Phân phối giải, ngân sách, tồn và minh bạch

**R07 — Backend chọn giải:** `selectedBoxId` dùng để trình diễn/kiểm toán UX, không chứa loại giải. Cả sáu hộp chung pool; FE không tự gọi random/quay chọn giải trước khi server commit.

**R08 — Weighted draw:** Admin đặt trọng số số nguyên dương cho từng giải. Tại thời điểm transaction, bỏ các giải disabled, hết thời gian, không đủ stock/quỹ/branch phù hợp. Chọn ngẫu nhiên có trọng số chỉ trong nhóm **đang đủ điều kiện**. Công bố quy tắc theo điều lệ, không mô tả sai “mỗi hộp có phần quà riêng”. Cần có bảng preview xác suất dự kiến và cảnh báo rằng xác suất hữu hiệu thay đổi khi hết giải.

**R09 — Không phát quá số lượng:** `issuedCount <= stockLimit`, `redeemedCount <= issuedCount` và `budgetReserved <= budgetCap`. Giao dịch mở phải giữ khoá concurrency trên event + quota/tồn và user; unique user/event. Không trừ lượt hoặc ngân sách nếu fail trước commit. Phải tính **mức phơi nhiễm tối đa** (liability cap) cho voucher % theo maxDiscount; voucher không cap bị chặn publish nếu có ngân sách hữu hạn.

**R10 — Budget:** Admin đặt tổng quỹ sự kiện, quỹ theo ngày (tùy chọn), quỹ theo giải, cùng `financialExposureVnd` theo đơn vị quà. Khi mở, kiểm tra cả event budget và prize budget. Không ghi chi tiêu thực khi người dùng chỉ được cấp phiếu; phân biệt `reservedLiability`, `redeemedActual`, `expiredUnredeemed` trên dashboard.

**R11 — Guarantee:** Mọi lần mở *thành công* được một giải thật. Nếu không có bất kỳ giải nào còn đủ quỹ/tồn, transaction trả mã `EVENT_OUT_OF_STOCK`, giữ nguyên quyền mở và auto-pause event theo chính sách. Tuyệt đối không tạo giải “Chúc may mắn” giả trúng khi cam kết 100%.

**R12 — Tăng/giảm:** Chỉ cho tăng tồn/quỹ theo audit nếu hợp lệ. Không cho giảm thấp hơn số quà đã giữ hoặc phát. Thay đổi trọng số/quà trong event LIVE cần version, audit người sửa/lý do/thời điểm, và công bố nếu điều lệ yêu cầu.

**R13 — Công bằng:** Không điều chỉnh giải riêng theo người dùng, điện thoại, thiết bị hoặc VIP khi chưa công bố rule. Nếu về sau muốn pool VIP khác, phải có PRD/điều lệ riêng được duyệt.

**Ví dụ giả lập (CHỈ MINH HỌA, KHÔNG SEED/PROD):** 50 voucher, 20 đồ uống, 10 vật phẩm; tổng 80 phần; 6 hộp cùng pool. Admin thấy dự kiến phát tối đa 80 lượt nếu không tăng quà. Trọng số không phải cam kết tỷ lệ giải cuối cùng. Khi còn 0 giải, nút mở bị khoá trên server.

---

## 7. Phiếu quà, ví và luồng redeem

### 7.1 Trạng thái phiếu

`ISSUED` (đã cấp) → `REDEEMED` (đổi thành công) hoặc `EXPIRED` (hết hạn theo server) hoặc `REVOKED` (thu hồi theo thủ tục được duyệt, audit + lý do). Không chuyển REDEEMED về ISSUED bằng thao tác UI. Có thể tách `RESERVED_FOR_PICKUP` trong Phase 2 nếu cần kiểm kê quầy.

### 7.2 Đổi tại quầy

1. Khách mở ví và hiển thị mã QR/token đổi; QR **opaque, ngắn hạn hoặc có nonce + signature**, không chứa dữ liệu cá nhân/mệnh giá có thể bị giả.
2. `verify` chỉ đọc, bắt buộc người quét có quyền, branch phù hợp, hiển thị trạng thái thực.
3. `redeem` xác nhận server-side trong transaction khoá phiếu + actor/branch + thời gian; dùng idempotencyKey theo thao tác quầy; tạo audit một lần.
4. Hai nhân viên quét đồng thời: duy nhất một redeem thành công, người còn lại nhận `ALREADY_REDEEMED`.
5. Nếu quầy offline: không xác nhận đổi offline trong MVP. Hiển thị rõ “Chưa thể xác minh, vui lòng thử lại” và không tự giao quà.
6. Nhân viên giao quà thật trước/sau khi ghi? **Quy trình đề xuất:** chuẩn bị hàng → xác thực phiếu → bấm xác nhận giao tại thời điểm thực giao; mất mạng lúc trả lời phải tra lại trạng thái, không bấm tạo giao mới.
7. Không có tính năng tiền mặt nhận tại quầy cho đến khi qua cổng pháp lý/kế toán, dù Admin tạo loại giải CASH_COUNTER.

### 7.3 Liên kết đơn dịch vụ

MVP phát voucher và đánh dấu đổi tại quầy, **không tự sửa `appointment_quotes.discountVnd`**. Khi hệ thống booking/POS hỗ trợ transaction, phát triển áp voucher theo chính sách stacking/max cap và tương tác hoàn tiền ở Phase 2.

---

## 8. Admin Wizard — yêu cầu chức năng chi tiết

**Bước A – Thông tin:** tên event, slug, nội dung giới thiệu, ảnh bìa, điều lệ versioned, chi nhánh tham gia, trạng thái DRAFT. Preview desktop/mobile.  
**Bước B – Lịch:** ngày/giờ bắt đầu–kết thúc theo Asia/Ho_Chi_Minh; đồng hồ server; cảnh báo trùng event LIVE/scheduled; lưu UTC.  
**Bước C – Người tham gia:** checkbox `THƯỜNG` (đã tích mặc định), VIP1..VIP99; 1 lượt/user/event (không cho sửa ở MVP); màn preview “ai đủ điều kiện” theo test scenarios, không hiển thị PII.  
**Bước D – Giải thưởng:** Add/Edit/Disable các loại trong §5, ảnh, mô tả, đơn vị, trọng số, số lượng, hạn và chi nhánh; drag-drop thứ tự hiển thị giải **không** quyết định xác suất; chọn 6 thiết kế hộp.  
**Bước E – Ngân sách & an toàn:** tổng quỹ/daily cap, giá trị rủi ro tối đa, validate `budget >= reserved`, số quà, cost breakdown, cảnh báo giải chưa có điều kiện/hết hàng. CASH_COUNTER luôn khoá nếu thiếu legal flag.  
**Bước F – Kiểm tra & công bố:** tóm tắt, simulation không ghi DB, danh sách lỗi/cảnh báo, xác nhận nội dung và chính sách; Super Admin mới được publish.  
**Bước G – Vận hành:** Dashboard số người đủ điều kiện (nếu ước tính tin cậy), lượt thành công, giải đã phát, quà đã nhận, liability, tồn, lỗi, tình trạng quầy; pause/resume/end; export CSV giới hạn quyền.  
**Bước H – Tra soát:** tìm phiếu bằng mã, lịch sử phát/đổi/thu hồi, lý do can thiệp, trạng thái claim; không xoá cứng giao dịch.

### 8.1 Quyền sửa theo trạng thái

- DRAFT: cấu hình đầy đủ, xoá bản nháp chưa có thưởng.
- SCHEDULED: chỉ điều chỉnh trước khi start, cần audit; thay đổi hạng/giải sau công bố cần cập nhật điều lệ/version.
- LIVE: sửa content không làm thay đổi quyền hiện hữu; điều chỉnh inventory/cost qua action ghi audit và validate; muốn thay rule hạng/trọng số phải PAUSED và phiên bản mới được duyệt trước khi RESUME.
- PAUSED: có thể chuẩn bị bổ sung tồn, cấu hình mới theo phiên bản và resume nếu trong cửa sổ thời gian.
- ENDED/ARCHIVED: chỉ đọc/đối soát; không phát lại lượt/khôi phục bằng nút tắt mở.
- Mọi export hạn chế PII, có người thao tác, timestamp, phạm vi.

---

## 9. API contract mức sản phẩm (P03 mới cố định schema)

**Public:** `GET /gift-events/current` → eventId, title, hero, allowedTierLabels, startAt,endAt,serverNow,status,termsVersion,prizePreview. Không bao giờ tiết lộ cấu hình bảo mật, số lượng giải nhạy cảm nếu Admin không công bố.

**Authenticated customer:** `GET /gift-events/me` → eligibility, eligibilityReason, attemptsRemaining, openId?, issuedRewards?; `POST /gift-events/:id/open` → yêu cầu `idempotencyKey`, `boxId`, `termsVersion`; response phải gồm `openId`, snapshot quà, server time, không tiết lộ khoá RNG; `GET /gift-events/opens/:id` recovery (chỉ owner); `GET /gift-events/me/rewards` và chi tiết phiếu (chỉ owner).

**Admin:** `GET/POST/PATCH /admin/gift-events`, `/prizes`, action `publish,pause,resume,end`, `simulate` (không phát quà), dashboard, export, audit; request ghi `expectedVersion` để chống ghi đè bản cấu hình stale.

**Staff:** `POST /staff/gift-redemptions/verify` và `/redeem`; `branchId`, `redemptionToken`, `idempotencyKey`, audit actor; không truyền userId do người quét tự khai.

**Mã lỗi nghiệp vụ ổn định:** `AUTH_REQUIRED, USER_INACTIVE, INELIGIBLE_TIER, EVENT_NOT_STARTED, EVENT_PAUSED, EVENT_ENDED, EVENT_OUT_OF_STOCK, BUDGET_EXHAUSTED, ALREADY_PLAYED, TERMS_VERSION_CHANGED, INVALID_BOX, REQUEST_CONFLICT, RATE_LIMITED, REWARD_EXPIRED, REWARD_REVOKED, ALREADY_REDEEMED, BRANCH_NOT_ALLOWED, NOT_AUTHORIZED, TEMPORARY_UNAVAILABLE`. Response lỗi không lộ email/SĐT hay key nội bộ.

**Caching:** Dữ liệu private `Cache-Control: private, no-store`; public current có TTL ngắn và serverNow để tránh countdown stale; thao tác open/redeem POST no-cache, CSRF/origin check hợp lý ở subdomain.

---

## 10. Chống gian lận, bảo mật, quyền riêng tư và vận hành

1. Chỉ xác nhận danh tính bằng access token/refresh flow hiện có; session revoked/logout không được mở tiếp.
2. `idempotencyKey` 1 ý định 1 lần, request fingerprint (userId,eventId,boxId,termsVersion) không được đổi nội dung cùng key; unique constraint + DB transaction.
3. Lock trên user/event và inventory/quỹ; retry request lỗi mạng phải trả cùng quà. Không trừ lượt trước khi ghi issued reward atomically.
4. Server cryptographically secure RNG; test tính công bằng và tái lập phân phối trong simulation giả lập (không hứa mọi tỷ lệ trong mẫu nhỏ).
5. Rate-limit đăng nhập, open, verify, redeem theo account + tín hiệu IP; không dùng IP thay account uniqueness; phát hiện thiết bị bất thường/acc mới đăng ký hàng loạt, không tự chặn khách thật không có bằng chứng.
6. Mã QR bảo vệ bằng token opaque, TTL, key rotation; revoke nếu nghi lộ. Không chứa PII, không gửi voucher token vào analytics/referrer.
7. Dữ liệu khách chỉ hiển thị cho đúng chủ sở hữu; admin theo quyền; log không chứa password, refresh token, mã đổi quà đầy đủ hoặc dữ liệu y tế.
8. Cập nhật quà/giải/tiền mặt luôn audit: actor, before/after, lý do, thời gian, event version. Không sửa nhật ký bất biến.
9. Nhân viên quầy phải thuộc chi nhánh; mọi đổi quà có branch audit; thu hồi quyền staff làm mất quyền verify/redeem ngay phiên kế.
10. Monitoring: tốc độ mở, double submit, conflict, oversubscription, lỗi CDN, thời gian đáp ứng, tỷ lệ giao quà, lệch đối soát; alert khi đạt 80/95/100% tồn/quỹ.
11. Không hiển thị “đã nhận tiền”, “đã áp voucher thành công” khi chưa có bằng chứng giao/giảm thực tế.
12. Tuân thủ điều lệ và pháp luật khuyến mại hiện hành tại Việt Nam; có bước xác định thủ tục thông báo/đăng ký, nội dung và thuế; **chưa xác nhận pháp lý** ở P01.

---

## 11. UI/UX & microcopy dùng làm input P02

**Giao diện:** phong cách wellness cao cấp, nền ivory/cream, xanh lá botanical và ánh vàng champagne; cảm giác tri ân hơn là sòng bạc. Tránh dùng text đếm ngược gây thao túng tâm lý, casino confetti quá mức hoặc gợi ý “hộp hiếm” không có thật.

**Khối landing:** hero thương hiệu → event status/countdown → điều kiện & quyền lợi theo hạng → bộ 6 hộp → thể lệ ngắn → FAQs → đường dẫn ví quà. Mobile-first, hình tối ưu, loading skeleton, error recovery.

**Trạng thái nút:**
- Không đăng nhập: “Đăng nhập để mở hộp quà”.
- Không đúng hạng: “Sự kiện dành cho: THƯỜNG” (hoặc tập hạng đã chọn); “Xem điều lệ”.
- Đã chơi: “Bạn đã nhận quà” + “Xem quà của tôi”.
- Đang phát: “Đang chuẩn bị món quà cho bạn…” (khóa double-submit).
- Hết tồn/tạm dừng: “Sự kiện đang tạm dừng. Lượt của bạn được giữ nguyên.”
- Hết hạn: “Sự kiện đã kết thúc. Cảm ơn bạn đã đồng hành.”
- Mất mạng sau mở: “Đang kiểm tra món quà của bạn…” + nút “Kiểm tra kết quả”, **không cho rút thăm mới**.
- Đổi thành công: “Đã nhận quà tại [chi nhánh] vào [thời gian]”.
- Hết hạn: “Phiếu này đã hết hạn sử dụng”, không xóa khỏi lịch sử.

**A11y/performance:** hỗ trợ bàn phím, focus visible, screen reader announces kết quả, `prefers-reduced-motion`, độ tương phản, không flash nhanh, hoạt ảnh < vài giây và skip được, ưu tiên ảnh WebP/AVIF responsive + lazy loading; nghiệm thu 320/375/390/768/1024/1440 px và Chrome/Safari mobile. Số liệu KPI cụ thể sẽ đo ở P15, không cam kết tốc độ trước QA.

---

## 12. Các tình huống bất thường (edge cases) bắt buộc

| Mã | Tình huống | Hành vi đúng |
|---|---|---|
| EC01 | Chưa login bấm hộp | Redirect auth rồi quay lại; không trừ lượt |
| EC02 | Account bị khoá giữa màn chờ và POST | 403/USER_INACTIVE, không cấp |
| EC03 | Khách THƯỜNG, chỉ VIP2 được chọn | Không cho mở, thông báo hạng chính xác |
| EC04 | VIP1 muốn vào event chỉ VIP2 | Không cho mở |
| EC05 | VIP hết hạn ngay trước transaction | Kiểm tra là THƯỜNG tại lúc mở |
| EC06 | VIP gia hạn ngay sau khi đã chơi | Không có lượt thứ 2 |
| EC07 | Hai tab bấm cùng lúc | 1 open + 1 quà, không 2 lượt |
| EC08 | Hai request cùng idempotencyKey | Trả cùng result |
| EC09 | Cùng key nhưng boxId khác | REQUEST_CONFLICT, không phát mới |
| EC10 | Browser đóng sau server commit | Tải lại trả đúng quà cũ |
| EC11 | Mạng ngắt trước commit | Không mất lượt; thử lại hợp lệ |
| EC12 | Hai khách tranh giải cuối | Chỉ một claim thắng, không oversell |
| EC13 | Cạn hết prize inventory | Ngừng event/OUT_OF_STOCK, không trừ lượt |
| EC14 | Cạn ngân sách nhưng còn stock | BUDGET_EXHAUSTED, giữ lượt |
| EC15 | Admin giảm stock nhỏ hơn số issued | Từ chối |
| EC16 | Admin sửa weight giữa khi khách mở | Dùng version/transaction nhất quán |
| EC17 | Admin pause ngay khi bấm mở | Nếu transaction chưa chốt thì chặn; nếu đã commit thì giữ quà |
| EC18 | Server 23:59:59 sát endAt | Phụ thuộc timestamp server, end exclusive |
| EC19 | Đồng hồ thiết bị sai | Không ảnh hưởng eligibility |
| EC20 | Trang cũ cached sau event ended | Server POST từ chối, UI cập nhật |
| EC21 | Điều lệ thay đổi giữa modal và POST | TERMS_VERSION_CHANGED, yêu cầu đọc lại |
| EC22 | Trọng số=0/hết quà khả dụng | Không chọn giải đó; validate pool trước publish |
| EC23 | Voucher 100% và không có cap nhưng tổng quỹ thấp | Không cho publish giải |
| EC24 | QR bị chụp và dùng lại | Token bảo vệ, 1 redeem và kiểm tra quầy |
| EC25 | Hai quầy quét một QR | 1 redeem, quầy còn lại ALREADY_REDEEMED |
| EC26 | Redeem qua chi nhánh không được chọn | BRANCH_NOT_ALLOWED |
| EC27 | Phiếu hết hạn đúng giây quét | Server đối chiếu, từ chối sau expiry |
| EC28 | Nhân viên mất quyền sau verify trước redeem | Redeem bị từ chối |
| EC29 | Mất mạng ngay sau redeem thành công | Retry/requery trả redeem đã ghi; không phát lại |
| EC30 | Voucher đã đổi nhưng booking bị huỷ | Không tự hoàn voucher; xử lý theo chính sách riêng/audit |
| EC31 | Admin cố bật giải CASH khi chưa duyệt | Publish chặn |
| EC32 | Có 2 event cùng lịch LIVE | Publish chặn hoặc chính sách chọn landing rõ |
| EC33 | Quà hết hạn nhưng còn trong ví | Lưu history EXP/không xoá |
| EC34 | Máy quét offline | Không đánh dấu đổi offline |
| EC35 | User đổi số điện thoại/email | UserId ổn định, không phát thêm |
| EC36 | User logout ở tab khác | Mutation cần token hợp lệ, 401 thì reauth |
| EC37 | Admin muốn thu hồi giải đã đổi | Không đảo ngược lịch sử; case xử lý audit riêng |
| EC38 | CDN ảnh lỗi | Hiển thị fallback, không ảnh hưởng transaction |
| EC39 | Refresh-cookie không hoạt động trên event subdomain | Thông báo reauth, chặn mở, không thử bằng anonymous |
| EC40 | Thiếu chi nhánh nhận/quy định hạn dùng | Chặn publish |

---

## 13. Acceptance scenarios Given–When–Then (đưa thẳng vào P05–P15 test)

| ID | Given | When | Then |
|---|---|---|---|
| AT01 | Admin tạo event mới | Mở bước chọn hạng | Chỉ THƯỜNG đã chọn |
| AT02 | Event chỉ THƯỜNG | Khách THƯỜNG đang active mở | Đủ điều kiện nếu còn lượt/quà |
| AT03 | Event chỉ THƯỜNG | VIP2 còn hiệu lực mở | INELIGIBLE_TIER |
| AT04 | Event chọn THƯỜNG + VIP2 | VIP1 mở | INELIGIBLE_TIER |
| AT05 | Event chỉ VIP1 | VIP legacy thiếu level nhưng còn hiệu lực mở | Được tính VIP1 theo adapter hiện hành |
| AT06 | VIP vừa hết hạn trước server POST | Đánh giá tier | Quy về THƯỜNG; quyết định theo allowedTiers |
| AT07 | User bị inactive | POST open | Không phát quà, không trừ lượt |
| AT08 | Chưa login | Bấm mở | Redirect login đúng returnTo |
| AT09 | Event DRAFT | Truy cập landing | Không lộ event dưới dạng LIVE |
| AT10 | Event SCHEDULED | Đến trước startAt | Countdown, không cho open |
| AT11 | Event LIVE | POST tại startAt chính xác | Có thể mở nếu đủ điều kiện |
| AT12 | Event LIVE | POST tại endAt chính xác | EVENT_ENDED |
| AT13 | Event PAUSED | POST open | EVENT_PAUSED, giữ lượt |
| AT14 | 6 hộp cùng pool | Chọn hộp khác nhau | Cùng quy tắc weights, không có xác suất hộp riêng |
| AT15 | Có giải khả dụng & ngân sách | POST valid | Server ghi 1 open, 1 issuedReward, trả kết quả thật |
| AT16 | Hai POST cùng user/event đồng thời | Transaction xử lý | Chỉ 1 issued reward, 1 lượt |
| AT17 | Request đã commit nhưng HTTP timeout | Retry cùng key hoặc GET me | Trả đúng quà cũ |
| AT18 | Cùng key request khác payload | POST lại | REQUEST_CONFLICT |
| AT19 | 1 quà cuối, hai khách | Mở cùng lúc | Không vượt stock; khách không được giải sẽ không bị trừ lượt nếu hết pool |
| AT20 | Không còn giải đủ stock/quỹ | POST open | Không tạo lượt; auto-pause/cạn quỹ |
| AT21 | Quà có cap và liability | Admin giảm budget dưới reserved | Validation từ chối |
| AT22 | Voucher % không có max cap | Admin publish ngân sách hữu hạn | Validation từ chối |
| AT23 | Quà được phát với snapshot | Admin sửa tên/điều kiện quà | Quà đã phát giữ snapshot cũ |
| AT24 | Voucher chưa đổi còn hạn | Khách mở ví | Hiện mã phiếu, điều kiện, hạn |
| AT25 | Hết hạn lúc verify | Nhân viên quét QR | REWARD_EXPIRED; không thể redeem |
| AT26 | Branch không thuộc allowedBranchIds | Nhân viên redeem | BRANCH_NOT_ALLOWED |
| AT27 | Hai staff đồng thời redeem | Submit | 1 success, 1 ALREADY_REDEEMED |
| AT28 | Staff không có event.redeem | Gọi redeem trực tiếp | 403; không ghi lịch sử giao |
| AT29 | Nhân viên redeem thành công | Khách mở ví | Hiện REDEEMED + thời gian/chi nhánh |
| AT30 | Giải cash chưa legal clearance | Admin thử publish | Không publish |
| AT31 | Hai SCHEDULED overlap landing single-event | Admin publish lịch thứ 2 | Conflict, giải thích rõ |
| AT32 | FE bị mất mạng ngay lúc animation | Reload | Quà từ API vẫn đúng, không quay mới |
| AT33 | Sai termsVersion | POST open | TERMS_VERSION_CHANGED, không mất lượt |
| AT34 | Event đã ENDED | Admin bấm resume | Từ chối, phải clone event |
| AT35 | Phân quyền cashier chỉ branch A | Xem giao quà branch B | Không được thấy giao dịch ngoài phạm vi |
| AT36 | Export báo cáo | Người không có event.audit.read gọi | 403 |
| AT37 | Cấu hình thay đổi khi LIVE | Audit log đọc | Có actor, before/after, reason, timestamp |
| AT38 | Server đúng timezone Việt Nam | Hiển thị start/end | Chỉ đổi UI timezone, quyết định POST dùng UTC |
| AT39 | Truy cập 320px và reduced motion | Mở hộp | Không overflow, có thể skip animation, kết quả đọc được |
| AT40 | Bot gửi POST hàng loạt | Vượt rate limit | RATE_LIMITED, không phát thừa |

### 13.1 Gate nghiệm thu trước khi mở sự kiện thật

- P01 này chỉ chốt nghiệp vụ, **chưa chạy test**. P03 thiết kế schema/API chuẩn; P04+ implement; P05–P15 hiện thực automated integration/E2E và load test.
- Bắt buộc test: transaction concurrent, idempotency, stock/budget, time boundary, tier snapshot, quầy redeem one-time, JWT/session/CORS cross-origin, không lộ PII.
- Chỉ mở production khi legal/finance/ops và người duyệt campaign xác nhận; có backup/rollback/migration rehearsal, monitor và support quầy.

---

## 14. Chỉ số vận hành & đối soát

- `eligibleUniqueCustomers` (ước tính/quyền truy cập chỉ admin), `openedUniqueCustomers`, `issuedByPrize`, `remainingStockByPrize`, `reservedLiabilityVnd`, `redeemedByBranch`, `actualBenefitRedeemedVnd`, `expiredUnredeemed`.
- Lỗi vận hành: `openConflict`, `idempotencyRetry`, `budgetDenied`, `redeemConflict`, `authRefreshFailure`, `cdnErrorRate`.
- Đối soát: tổng issued = tổng phiếu theo trạng thái (issued chưa đổi + redeemed + expired + revoked) theo event/prize, không đếm QR verify thành redeem; số lượt mở thành công = số issued reward khi guaranteed prize.
- Báo cáo ngày sử dụng timezone Asia/Ho_Chi_Minh, không đổi nghĩa timestamp UTC trong DB.

---

## 15. Các quyết định cần chủ hệ thống xác nhận trong cổng P01

| ID | Nội dung | Mặc định P01 đề xuất | Tình trạng |
|---|---|---|---|
| D01 | Tên & chủ đề chiến dịch | “Mở Hộp Quà – Nhận Yêu Thương” / botanical green, ivory, champagne | CHỜ DUYỆT |
| D02 | Landing | event.mocmaria.com (route /su-kien chung Next.js + domain mapping sau) | CHỜ DUYỆT |
| D03 | Hạng mặc định | Chỉ THƯỜNG; exact tier matching VIP1...VIP99 | ĐỀ XUẤT CHỐT |
| D04 | Số lượt | 1/user/event cho mọi hạng, không lượt tăng theo VIP | ĐỀ XUẤT CHỐT |
| D05 | Đảm bảo có quà | Có; hết quà thì pause và giữ lượt | ĐỀ XUẤT CHỐT |
| D06 | Cơ cấu hộp | 6 hộp khác visual, chung pool giải | ĐỀ XUẤT CHỐT |
| D07 | Loại quà MVP | Voucher tiền/% (manual counter redemption), phiếu mệnh giá dùng 1 lần, đồ uống, vật phẩm | CHỜ DUYỆT |
| D08 | Quà tiền mặt | Cấu hình dạng disabled; **không bật** khi chưa kiểm tra thủ tục khuyến mại/thuế/chứng từ | CẦN PHÊ DUYỆT PHÁP LÝ |
| D09 | Voucher 30 ngày | Mặc định 30 ngày từ cấp; có thể per prize | CHỜ DUYỆT |
| D10 | Voucher trong booking | Chỉ đổi thủ công tại quầy giai đoạn đầu, không tự discount online | CHỜ DUYỆT |
| D11 | Chi nhánh đổi quà | Admin chọn allowedBranchIds per prize; nhân viên thuộc branch | CHỜ DUYỆT |
| D12 | Giới hạn quỹ | Tổng quỹ + theo giải (daily cap tùy chọn), bắt buộc trước publish | CHỜ CON SỐ THỰC |
| D13 | Một event LIVE | Đúng, không chồng lịch LIVE trên landing | ĐỀ XUẤT CHỐT |
| D14 | QR đổi quà | QR opaque, online verify/redeem, one-time, không phát quà offline | ĐỀ XUẤT CHỐT |
| D15 | Điều lệ/pháp lý | Rà soát thông báo/đăng ký khuyến mại, giải tiền mặt, thuế và PII trước release | CHƯA HOÀN THÀNH |
| D16 | Quà đồ uống/vật phẩm | Chưa có tồn POS chắc chắn; vận hành tồn event riêng cho MVP | CHỜ DUYỆT |

**Những điều không được tự phê duyệt:** số lượng quà thật, ngân sách, thời gian event thực, các chi nhánh có quyền đổi, điều lệ cuối cùng và mọi thủ tục pháp lý. Admin sẽ điền khi chuẩn bị live; PRD không tự suy đoán con số.

---

## 16. Không thuộc P01, giao cho các chặng sau

- **P02:** UI/UX concept mobile/desktop, storyboard ba trạng thái landing–mở–kết quả + wallet/admin, màu sắc/asset/motion; ưu tiên giao diện đẹp, responsive, và reduced motion. P02 được triển khai **chỉ sau khi chủ hệ thống duyệt PRD này**.
- **P03:** Schema/event domain, OpenAPI contract, threat model, diagram transaction/idempotency, event host strategy và xác nhận owner migration.
- **P04–P08:** DB riêng event, backend admin, draw/stock/budget, customer open, redeem, admin settings. Không sửa booking core đang có owner.
- **P09–P12:** landing/animation/ ví quà/ quầy/notification.
- **P13–P15:** báo cáo đối soát, chống gian lận, test E2E/load/UX.
- **P16–P17:** staging/domain/DNS/SSL, kiểm tra cookie cross-subdomain, legal + go-live signoff, rollback. Không tự deploy hay thay đổi kinh doanh trước duyệt.

### 16.1 Danh sách file dự kiến để tránh AI khác (chưa tạo)

BE mới: `src/modules/gift-events/**` và migration riêng khi được release owner duyệt; FE mới: `src/features/gift-events/**`, `src/app/su-kien/**`, `src/app/quan-tri/su-kien/**`; docs: `docs/event-*`. Các file chung (`app.module.ts`, `identity.constants.ts`, `admin-shell.tsx`, `next.config.ts`, auth/cors) chỉ sửa ở prompt tương ứng, sau khi kiểm tra claim và duyệt diff tối thiểu.

---

## 17. Bàn giao P01

- **CODE:** không thay đổi mã FE/BE; chỉ thêm PRD này.
- **TEST:** không chạy unit/integration/build bởi P01 chỉ thiết kế nghiệp vụ; kiểm tra nhất quán PRD với audit P00 và đặt kịch bản nghiệm thu để test sau.
- **COMMIT:** commit mới chỉ chứa `docs/PRD_EVENT_MO_HOP_QUA_P01.md`, xem lịch sử Git.
- **DEPLOY:** không deploy, không sửa DNS, CORS, Kubernetes, Vercel, secrets hoặc production.
- **BUSINESS_DATA:** không tạo event, hộp, khách, quà, voucher, ngân sách, phiên nhận hoặc QR thật.
- **BLOCKER CẦN THEO DÕI:** Chưa kiểm tra được worktree cục bộ / registry ngoài GitHub, quyền migration đang có claim ACTIVE; phải phối hợp owner và xác nhận trạng thái runtime ở các chặng code/release.
- **STOP GATE:** Chờ người dùng phê duyệt bằng “OK, tiếp tục P02”; không tự viết code/thiết kế giao diện khi chưa có duyệt.
