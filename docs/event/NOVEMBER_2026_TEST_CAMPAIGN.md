# November 2026 — Mộc Maria voucher campaign (controlled QA draft)

**Status: configuration proposal only; not deployed, published or issued.**

Campaign title: **Tháng 11 Tri Ân Mộc Maria — Mở Hộp Nhận Yêu Thương**.
Campaign code/slug: `moc-maria-tri-an-thang-11-2026`.
Time (Asia/Ho_Chi_Minh): 2026-11-01 00:00 through 2026-11-30 23:59 (UTC: 2026-10-31T17:00:00Z to 2026-11-30T16:59:00Z).

Policy for a controlled rehearsal: only `STANDARD` by default, one opening per verified active customer, all six visual boxes use the same prize pool, guaranteed voucher if stock/budget remains, 100 total issuance cap. When stock/budget is exhausted, pause rather than issue empty boxes. The real event must not be published without operator approval.

## Candidate prize pool

All **VOUCHER_PERCENT** (no cash, no gift-card balance, no physical goods):

| Discount | Weight | Stock | Max discount per voucher | Validity |
| --- | ---: | ---: | ---: | ---: |
| 10% | 20 | 20 | 150,000 VND | 30 days from award |
| 15% | 20 | 20 | 150,000 VND | 30 days from award |
| 20% | 20 | 20 | 150,000 VND | 30 days from award |
| 25% | 20 | 20 | 150,000 VND | 30 days from award |
| 30% | 20 | 20 | 150,000 VND | 30 days from award |

Suggested upper bound of campaign liability: **15,000,000 VND** (100 × 150,000 VND maximum). This is a test ceiling, **not a financial approval**. Weighted choice varies with stock and does not guarantee exactly 20 awards at each percentage.

Eligible catalog families to reconcile with active DB IDs before publishing: therapeutic massage services, Trà Dưỡng Nhan, herbal teas, fresh juices and currently active drinks. Do not infer product IDs or availability from screenshots. No voucher may promise an automatically discounted booking/checkout unless the real order integration enforces it. Current Gift Event redeem endpoint records QR receipt **only**; it does not calculate order totals, validate service/SKU eligibility or apply a percent at checkout. Counter staff must check actual eligible purchase and maximum discount under a separately approved process; do not mark the reward redeemed before delivering the authorized benefit.

## Exact release prerequisites

1. Fix production `GET /api/v1/gift-events/current` (currently 404) and credentialed Event-origin CORS; deploy backend with `GIFT_EVENTS_ENABLED=false` initially.
2. Migrate isolated PostgreSQL QA and test draw/QR/branch concurrency and rollback. Do not auto-run migrations on customer DB.
3. Reconcile the active massage + drink catalog records, physical branch IDs and operator permissions; define how a completed sale is evidenced at the counter.
4. Product/Finance/Legal approve the benefit, budget, eligibility, time window and promotion terms (including any legal formalities).
5. Create this as DRAFT in admin, attach five enabled prize types only after validation, and perform rehearsals with dedicated QA accounts. Do not treat scheduled November event as open to test users in October; use a separate hidden QA campaign/staging for immediate rehearsal.

## Prize payload shape to enter after reconciliation

```json
{
  "kind": "VOUCHER_PERCENT",
  "config": { "percent": 20, "maxDiscountVnd": 150000, "minSpendVnd": 0, "validityDays": 30 },
  "weight": 20,
  "stockTotal": 20,
  "enabled": true,
  "branchIds": ["REPLACE_WITH_VERIFIED_ACTIVE_BRANCH_UUID"]
}
```

Create analogous records for 10, 15, 25 and 30; set meaningful individual names/descriptions and preserve immutable reward snapshots. The placeholder UUID is intentionally invalid and prevents accidental issuance until active branch data is supplied. This is **not** a live campaign.
