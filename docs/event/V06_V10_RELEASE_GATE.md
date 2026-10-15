# V06–V10: Event voucher operations — handoff and release gates

## Code delivered

- **V06**: `GiftNotificationsService` writes *two* durable `app_metadata` outbox rows in the same transaction that issues a reward; repeated opens return the existing reward and do not enqueue twice. Background worker batches and retries, using existing `ZaloAlertsService.enqueueText` and Acutis Queue `email.send` with stable `jobId`. Only configured admin recipients receive notice. Messages contain event, customer display name, reward name, time and an admin link — **no six-digit PIN, QR token, customer email or phone**.
- **V07**: Super Admin `GET /api/v1/admin/gift-event-operations` with optional `eventId`, ISO `from`/`to` (maximum 366 days, default trailing 30 days). Group by event/day, show issued/redeemed/expired/voided/outstanding plus recorded discounts and notification delivery states. `GET .../csv` is Excel formula-escaped.
- **V08**: Low-stock indicators from existing prizes, `GET /api/v1/admin/gift-event-operations/notifications/failed`, and `POST .../notifications/:rewardId/:channel/retry`, requiring failure state and reason in immutable admin audit. Reuses existing reward CRUD (V03) rather than issuing arbitrary manual rewards. A `queued` notification means accepted by the next queue/outbox; it does **not** prove it was read.
- **V09**: `scripts/november-2026-qa-event.cjs` builds a November draft with 5 reward classes (10/15/20/25/30%), stock 20 each, capped at 150,000 VND per award (15 million VND maximum reserve), 30-day validity. Dry-run is default; `--apply --qa-only` requires an **explicit non-production QA API**, an authenticated QA Super Admin, verified branch UUIDs and published catalog service UUIDs. Script is repeatable and will only edit/create *DRAFT* objects. It deliberately never publishes a campaign or issues customer rewards.
- **V10**: source QA, read-only API smoke, database rehearsal and release gate below. The outbox does not alter booking/payment or automatically deduct money. Voucher redemption still requires cashier evidence; production issuance stays disabled until end-to-end approval.

## Operator configuration and sample usage

```
node scripts/november-2026-qa-event.cjs
```

The dry run prints the intended draft without reading or writing any database. For a supervised QA-only dry-run followed by create, set `MOC_EVENT_QA_API`, `MOC_EVENT_QA_TOKEN`, `MOC_EVENT_QA_BRANCH_IDS`, `MOC_EVENT_QA_SERVICE_IDS` securely in the process environment and execute `node scripts/november-2026-qa-event.cjs --apply --qa-only`. Never pass bearer tokens on a command line or into CI logs. QA requires migrations 1791900000000 through 1791900400000, correct branch service variants and `GIFT_COUNTER_PIN_SECRET` configured by secret management.

## Non-negotiable checks before public operation

1. Isolated PostgreSQL QA database with migrations, test-user accounts and documented backup/rollback. Verify one hundred concurrent opens, retry-after-timeout, two-cashier code redemption, invalid/expired/wrong-branch codes, receipt reuse, low stock and budget exhaustion.
2. Actual admin Zalo recipient configured plus email recipients and Queue service connection; test message delivery and retry without leaking claim codes. Verify the retry endpoint never duplicates an already queued notification.
3. Check active service variants for massage, herbal teas and drinks; the frontend menu alone is **not** proof of an eligible backend SKU.
4. Test Safari/iOS, Android/Chrome, cookie login across `event.mocmaria.com`, mobile layout, disabled permissions, logout, 429 throttling and screen-reader operation.
5. Financial/promotion sign-off on 100% winning probabilities, 100-piece stock ceiling, 15-million reserve limit, voucher stacking, paid receipt verification, refund and cancellation policies.
6. Validate smoke endpoints (`scripts/event-release-smoke.ps1` in FE), normal booking, catalog, customer registration, chat and queue before applying a new immutable BE image to Mộc Maria's **own** Kubernetes VPS. Do not use unrelated EKS kubeconfig; do not apply migrations to customer DB during source QA.

**GO/NO-GO:** passing TypeScript/CI tests and merging to main alone never authorizes going live. Keep `GIFT_EVENTS_ENABLED=false` in production until DBA and operator verify the items above. V09 campaign is a QA draft, **not** a live published event.
