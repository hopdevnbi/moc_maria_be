# Assistive contact menu and attendance audit — 2026-11-05

The global contact entry now opens three labelled shortcuts: Support, Facebook and Check-in. Check-in remains discoverable for every visitor; the server controls attendance eligibility. Existing customer/provider support routing stays intact. The launcher is available on chat and event pages, respects mobile navigation and booking CTA spacing, closes outside/on Escape/navigation/account changes, and supports keyboard focus restoration and reduced motion.

`/check-in` is a separate authenticated attendance entry. Guests keep `/check-in` as their login/registration return destination. Authentication pages suspend their URL-data reads so Next.js 16.4 can prefetch/navigation without URL-data errors. Customer-only/inactive staff responses are explained; active staff profiles are accepted by the server even without one of the usual operational roles.

Attendance remains once per Vietnam calendar day, 200m and five coins from the server. Manual GPS is requested only after a click; automatic GPS requires explicit opt-in and stops in the background/unmount. Readings must have valid coordinates, finite nonnegative accuracy <=100m, and a timestamp no more than 30s old or 5s ahead. Leaving the page, changing accounts or crossing Vietnamese midnight while waiting for GPS prevents a delayed write. Buttons are locked while acquiring location/mutating/refreshing. A response updates the query cache immediately; an ambiguous failure requires a successful status reload before retrying. No-GPS/outside/unconfigured zero-coin attendance requires explicit confirmation that it consumes the daily turn. Selfie processing does not proceed to upload after leaving the page.

## Verification

- Browser fixture (removed before build): mobile 390/320 and desktop 1440 menu bounds; all three actions; Support guest login route; accurate check-in -> one request/five coins; coarse and denied GPS -> zero requests; explicit no-GPS confirmation -> one request/zero coins.
- Unit/client regressions cover duplicate taps, unmount/account changes, midnight, foreground automatic watch, lost response reconciliation, permissions, controlled support focus and menu lifecycle.
- Backend: 319 unit tests and 13 real Nest HTTP/PostgreSQL integration tests pass. Concurrent daily inserts produce one check-in/one coin ledger row/wallet +5, retries preserve that record, and zero-coin attendance cannot be upgraded. Invalid accuracy is rejected before consuming a daily turn. All integration data lives in a disposable database; its pod, Secret and tunnel were removed.
- Frontend final quality/build, CI and production evidence are recorded with the release in Plan/99_PROJECT_STATUS.txt and Plan/14_ACTIVE_WORK.json.

## Production boundaries

No production attendance, coins, customer bookings, messages, GPS readings or selfies were created during QA. No migration or credential/configuration change is required. Browser GPS is a device reading, not tamper-proof proof of physical presence. Existing attendance rows and business policy are preserved.

## Production verification

Frontend main 8a3c8cf, Vercel dpl_HoGCo2uvP8FrMjfbStCzPTyJyiwZ READY. Main/event release endpoints match the exact source SHA. Actual signed-in KTV opened /check-in: saved branch location configured, radius 200m, wallet loaded, no browser errors; no GPS request, check-in, upload or coin write was performed. Backend source d2353a4, image b733b7796e84, one ready replica; live/ready 200 and anonymous attendance 401. Environment and Secret references compare identical before/after. Both backend source CI jobs succeeded. Frontend full local quality 389 tests/83 files and final production build pass; initial GitHub CI passed those tests but failed in next/font Google font parsing; failed job rerun is tracked in Plan release evidence.
