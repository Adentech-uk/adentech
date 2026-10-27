# Codex execution brief — finish, verify, and deploy AdenTech

## Objective
Take the current repository from its current state to a safe, tested, deployable AdenTech website and Gmail workflow. Work directly in this repository. Do not stop at a plan: inspect the whole repo, implement the fixes, run tests, update documentation, and prepare the deployment. Do not ask the owner to repeat information already in this brief.

## Working rules
- Start by reading `README.md`, `apps-script/Code.gs`, `apps-script/GmailFollowUpBot.gs`, all tests, website source, GitHub Actions workflows, and the open PR #3 diff. Check current branch/main before changing anything.
- Preserve existing user work. Do not delete unexplained files, nested repositories, or user data just because they look accidental.
- Use no paid AI API, no OpenAI API key, and no new paid service. Do not put credentials, tokens, customer details, or secrets in code, logs, commits, or docs.
- Do not run live Gmail automation, Apps Script functions, triggers, or email sending during tests. Use mocks/stubs and synthetic test data only.
- Do not merge directly to main or silently deploy. Make all code changes on this branch, run validation, summarize results, and open/update a draft PR. Deployment can proceed only through the documented, owner-authorized release path after the owner has reviewed the diff and explicitly approved deployment. Never claim a deployment happened unless verified.

## Business requirements
- AdenTech serves the local area only. Current code contains `SERVICE_AREA = "LOCAL_AREA_NOT_CONFIGURED"`; do not invent a geographic boundary. Make this a single clearly documented configuration value and fail safely / route coverage questions to owner review while it is unset. Do not advertise that service-area configuration is complete until a real area has been supplied.
- Services: computer and laptop setup; monitors; printers; workstation setup and testing.
- Website must say “Get a quote”; do not publish a public price list.
- Quote requests: collect the relevant details; create an owner-review quote draft; send the customer acknowledgement only. Never send a price or quote automatically to a customer. Final price confirmation requires owner approval.
- Enquiries: automatically answer only simple, low-risk, known service questions. Escalate pricing, coverage, availability, compatibility, urgency, missing/uncertain information, and anything outside the configured service scope to owner review.
- Quote pricing rules for owner-only draft estimates: £20/hour; £50 minimum visit/labour charge covering the first billable hour; additional labour £20/hour; mileage £0.45 per mile based on verified round-trip distance from NW8; business is not VAT registered, so do not add VAT. Do not invent a route or distance. Flag unknown hours, parts, travel, parking, or uncertain scope for owner review. Clearly mark estimates as estimates and keep them out of customer quote confirmations.
- Keep customer-facing wording honest: acknowledgement is not a quote, booking, availability confirmation, or guarantee.
- Validate submitted email, full service address and UK postcode consistently. A postcode alone is not a verified street address. Device count may remain unknown if the customer cannot yet provide it; do not silently convert unknown to zero or assume a quantity. Ask follow-up questions by email where needed. Show submitted details in the acknowledgement where appropriate, but do not expose internal notes or calculations.
- Avoid duplicate submissions/emails. If a send attempt has an uncertain result, do not blindly retry and risk duplicate email. Record/reconcile the uncertain state and make it visible to the owner through a durable, safe review mechanism.
- Rate-limit safely without permanently blocking legitimate customers. Make state expiry/pruning explicit and test concurrent/duplicate requests.
- Gmail labels have historically varied (`AdenTech/Quotes`, `AdenTech/Enquiries`, and `adentech-quotes`). Inspect current code and choose one canonical label convention; document it and handle legacy labels safely where practical.
- Follow-up bot should only process AdenTech-related quote threads, require a quote-related subject/reference before drafting, read the conversation context, ask concise follow-up questions for missing quote details, detect customer replies/order or quote reference only when grounded in the thread, and create owner-review drafts. Never auto-send quotes or place orders.

## Required implementation
1. Inspect the open PR #3 and current main; do not blindly duplicate changes already present. Integrate the useful recovery, duplicate-prevention, validation, and rate-limit improvements after reviewing their correctness.
2. Review both Apps Script files for syntax, runtime assumptions, authorization scopes, Gmail search limitations, idempotency, error handling, PII exposure, and partial-failure behavior.
3. Make website forms and customer messages consistent with the business requirements above. Remove any public pricing presentation and use “Get a quote”.
4. Make configuration explicit and safe. Never guess the service area, owner email, deployed endpoint URL, Script Properties, or secret values. Provide a checklist for values the owner must supply.
5. Add/extend automated tests using mocks for success, invalid email/address, postcode-only address, unknown device count, duplicate request, rate limiting, uncertain send result, owner-review escalation, customer acknowledgement, quote draft not sent, and follow-up thread restrictions.
6. Add a clear deployment runbook with exact beginner-friendly steps for GitHub Pages and Google Apps Script. Separate repository/site deployment from Apps Script deployment. Document required scopes/authorization, versioned deployment/update steps, and a rollback procedure. Do not require Cloud project admin changes unless truly necessary.
7. Ensure Apps Script files are copy/paste-ready and explain which file goes into which Apps Script project. Avoid setup functions that create triggers, send emails, or deploy without an explicit owner action.
8. Run all repo tests and checks available, including `node --check` on JavaScript files (using appropriate syntax checks for Apps Script), the project test command(s), and `git diff --check`. Report exact commands and pass/fail results. Add tests if missing.
9. Inspect generated diffs and ensure no secrets, customer data, accidental terminal artifacts, or unrelated files are included. Do not delete unexplained files without investigating their purpose.
10. Update README/docs to explain the safe operating model, canonical labels, configuration, manual approval gates, tests, deployment and rollback.

## Release gates
- No merge or deployment until tests pass and the owner has reviewed the final diff and explicitly approved release.
- Before release, the owner must confirm the actual service area, owner notification address, web-app endpoint URL, Gmail labels, and whether Apps Script authorization/deployment is already configured.
- Verify after owner-approved deployment with a non-customer test submission and confirm: owner notification is delivered once; customer receives acknowledgement only; quote remains a draft; correct label is applied; follow-up bot does not send customer quotes.
- If any of these checks cannot be completed safely, stop at a tested draft PR and explain the exact remaining blocker. Do not fake success.

## Final report format
Provide:
- files changed and purpose;
- test commands and exact results;
- security/privacy and duplicate-send review;
- any owner-only configuration still needed;
- draft PR URL;
- explicit statement whether anything was merged, deployed, or sent (normally: no).
