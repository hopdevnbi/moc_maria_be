# Mộc Maria - Noel 2026 Voucher Preparation

Status: DRAFT preparation only. This script does not publish an event or issue vouchers.

## Scope
- Separate campaign code: moc-maria-noel-2026.
- Scheduled window (only if later published): 1–25 December 2026, Vietnam local time.
- Visitors open a box before booking/using the service, as stated on the poster.
- Each customer account may open once per campaign; redemption is verified at the business.
- Voucher expires 30 days after issuance.

| Reward | Quota | Relative draw weight | Maximum discount | Max exposure |
|---|---:|---:|---:|---:|
| 10% | 75 | 75 | 150,000 VND | 11,250,000 VND |
| 20% | 23 | 23 | 200,000 VND | 4,600,000 VND |
| 50% | 2 | 2 | 300,000 VND | 600,000 VND |
| Total | 100 | 100 | | 16,450,000 VND |

Weights are relative among prizes remaining eligible and within budget; they are NOT fixed chances over time. 50% starts near 2% selection weight, and only two 50% vouchers can be issued.

The quota of 100 means 100 available reward slots, not 100 voucher records assigned to fictional customers. Each voucher is created by an actual customer's completed gift-opening transaction.

## Separate cash award (poster)
The 5,000,000 VND cash award is NOT implemented by this script. The backend disallows activation of CASH_COUNTER until its separate legal/accounting/award process is approved. Do not claim this cash award is already automatically redeemable through the digital boxes.

## Compliance and publishing
Check applicable rules for promotional games of chance, approvals/registration, and publish clear terms (maximum savings, eligible service, validity, customer qualification, quota, prizes). The campaign remains DRAFT until those checks and event publication are explicitly completed.

## Operator instructions
Script: scripts/prepare-noel-2026-vouchers.cjs

- Normal invocation: node scripts/prepare-noel-2026-vouchers.cjs (dry run).
- Reviewed setup invocation: node scripts/prepare-noel-2026-vouchers.cjs --apply --production-ack.
- Run only from an authorized environment with a pg client library and existing DATABASE_URL, with a backup/review before applying.
- The script creates one DRAFT campaign and three reward types transactionally. It is idempotent when the DRAFT configuration matches and refuses unexpected state.
- It must not run automatically in CI/CD, and never modifies the existing November reward history.
