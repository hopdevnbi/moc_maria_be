# P04 – Cơ sở dữ liệu Event Mộc Maria

**Chặng 05/18, migration additive.** Không chạy lên production, không seed event thật. Tham chiếu [PRD P01](../PRD_EVENT_MO_HOP_QUA_P01.md).

## Các bảng riêng

```text
users ──────┬──────── gift_event_campaigns ── gift_event_tiers
            │                    │
            │                    ├──── gift_event_prizes ── gift_event_prize_branches ── branches
            │                    │         │
            └── gift_event_entries│         │ (chosen by backend)
                     │            │         │
                     └──── gift_event_rewards ── gift_event_qr_tokens
                                │
                                └── gift_event_redemption_history

gift_event_campaigns ── gift_event_admin_audit
```

Database guards: UNIQUE(event_id,customer_user_id) đảm bảo 1 lượt; UNIQUE(idempotency key) và reward UNIQUE(entry_id) đảm bảo không nhân đôi. CHECK giữ tồn issued <= stock, liability reserved <= budget, tỷ lệ/VIP tier hợp lệ. Reward là snapshot độc lập với cấu hình hiện tại.

## Lệnh kiểm thử an toàn

`npm run typecheck`
`npm test -- --runInBand gift-event-foundation.spec.ts`
`npm run build`

Migration class: `GiftEventFoundation1791900000000`. **Chỉ release owner có quyền chạy migration** trong môi trường được duyệt. Down sẽ từ chối rollback nếu có bất kỳ campaign nào: không được làm mất quyền lợi đã cấp. Không có `synchronize` hoặc `migrationsRun` tự động.

Ở P05–P08 sẽ thêm API/transaction theo schema này, không chỉnh bảng booking và catalog.
