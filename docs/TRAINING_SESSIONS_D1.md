# Training sessions and attendance — D1 (2026-10-09)

D1 adds program modules, instructor-led sessions, enrollment rosters and attendance with append-only correction history. It is a foundation for Phase03 tasks P03-T28/T29/T30; detailed practical assessment, calculated course attendance and certificate renewal remain D2. Existing course assessment is still separate and must not be interpreted as derived from session records.

## Data and access
Migration13 TrainingSessionsAttendance1791638800000 adds five tables. No production fixtures or automatic pass/approval are inserted. Modules belong to one course; sessions belong to one module. Sessions use explicit timezone timestamps (UI Vietnam +07:00), last 1 minute to 8 hours, and transition from PLANNED once to COMPLETED or CANCELLED. Completed sessions require an actual internal completion reference and cannot end in the future.

Admin GET routes use staff.manage; mutations use roles.manage. Instructor candidates are active users with an existing eligible operational role; business staff must independently verify their teaching competence. Instructor IDs/branch IDs/completion references and attendance evidence stay in private admin responses. Own training-sessions returns only assigned active roster records, instructor display names, dates and current attendance, without evidence references, reviewer IDs or correction history. Private GET responses use private,no-store.

## Integrity
Course and instructor row locks serialize instructor scheduling across courses. A non-cancelled instructor session cannot overlap another session. Provider application locks plus course locks serialize roster and attendance changes; trainee overlaps are checked across courses. Wrong-course assignment, self-registration/assessment and self-attestation of a completed session are denied. Rosters are changed only before a session is closed. Attendance is accepted only for completed, ended, assigned sessions; minutes cannot exceed actual session length and ABSENT/EXCUSED must be zero. Explicit evidence confirmation and a reason are required. Each correction appends an immutable event and an audit record; previous attendance is preserved.

## Validation
BE quality/build/21 unit tests PASS; FE quality/build/4 tests/22 routes PASS. Disposable PostgreSQL: all13 migrations, latest rollback/reapply, 32 integration tests in5 suites PASS. Includes concurrent instructor collisions within/across courses, trainee collisions, role/ownership privacy, timezone/duration bounds, missing/false confirmations, self-attestation, attendance corrections and future-completion rejection.
Browser QA: created a Vietnamese module and a session using an actual QA instructor; updated attendance60→45 minutes, saw four history events and verified persistence after reload. Mobile390px document387px, no horizontal overflow. All data was isolated QA; its servers/database/credential file were removed after verification.

## Remaining
D2 needs owner-defined required training volume and practical criteria, assessment attempts/history, automatic attendance calculation, failure/reassessment/expiry rules and certificate issuance/renewal history. Full Phase03 acceptance, real business data and legal review remain open. Internal training certification is not a government professional licence. Booking/chat are not opened by this change.

