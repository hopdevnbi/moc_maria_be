# KTV public content and editable ages — 2026-10-13

Owner requests production copy without demo/illustration/example labels and publication/deployment from main. Public directory and named profiles now require an existing backend account and use its persisted name/area. Removed the parenthetical skills label, obsolete profile explanation and illustration wording from admin image alt text. Existing IDs, pricing/menu content, account identity, chat history and booking/review gates remain compatible.

Owner explicitly requested random provisional ages 18–25 until they enter precise ages later. Generated ten fixed values once, backed up previous age records privately, and initialized dedicated app_metadata records for the existing ten accounts atomically. Initialization does not overwrite existing admin edits and records OWNER_PROVISIONAL_20261013 provenance; no birth dates are invented. Frontend fallback ages use the same fixed assignment. Administrative edits override those values in the public directory/profile.

Admin: /quan-tri/ktv → open a KTV → Thông tin công khai → Tuổi KTV → Lưu tuổi. Server requires roles.manage, validates integer ages 18–100 to allow later accurate corrections, checks the provider exists and records an audit event. Public endpoint /provider-presentation/profiles exposes only providerId/age; private GET/PATCH /admin/provider-public-profile/:id reads/updates the field. No migration required.

Validation: 100 complete PostgreSQL integration cases passed, including anonymous/unauthorized rejection, age bounds, persisted reread/public read, later correction and unchanged APPLIED status. Frontend baseline 88 tests passed; two new directory cases passed after moving the server-only adapter test to its pure reconciliation helper. Typecheck/build passed; final CI/release evidence follows.

Business data: ten owner-authorized provisional ages are stored. Age initialization does not verify age or change provider status, qualifications, ratings, appointments or passwords. Years of experience and service assignments retain existing owner presentation until factual corrections are supplied. Release code to main, backend before frontend.
