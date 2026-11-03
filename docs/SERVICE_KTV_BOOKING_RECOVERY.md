# Official service → KTV inquiry recovery

The service menu links to published catalog UUIDs, while the seven persisted KTV accounts still expose legacy service IDs. Their public directory is correct. The frontend filtered every KTV out and the inquiry endpoint would reject the catalog UUID even if a KTV could be selected.

The inquiry endpoint now accepts a published service from the ten official care-menu slugs for any currently visible KTV in its existing directory. SQL verifies the service, its category and an active variant. Unknown providers, unknown service IDs, unpublished records, hidden categories, inactive variants and drinks remain rejected. Legacy assigned service IDs retain compatibility.

This is an advisory inquiry, saved as PENDING with the exact catalog ID and name. The selected KTV confirms suitability and timing. It creates no appointment, qualification, slot reservation or provider-service eligibility. Existing customer permission, identity, blocks, rate limits, time/address validation, idempotency, audit and notification paths are retained.

Validation uses the configured Nest HTTP application with disposable PostgreSQL. New regressions send the canonical service to all seven directory KTV, all ten official care services to one KTV, verify retry identity and customer reads, and exercise invalid/inactive records. All production verification is read-only; no QA customers, inquiries or messages are created in production.

Deploy backend before the frontend picker. No schema migration, configuration or Secret change is needed.
