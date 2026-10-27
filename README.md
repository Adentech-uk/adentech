# AdenTech

AdenTech provides computer and laptop setup, monitor and printer setup, and workstation setup/testing. The customer website is a static page in `index.html`; its forms use a separately deployed Google Apps Script web app.

The site uses **Get a quote** and does not display a public price list or claim a service area. The owner must confirm the local service area before coverage can be promised. Do not include passwords or sensitive account information in a form submission.

## Repository map

- `index.html` — customer site and browser-side form handling.
- `apps-script/Code.gs` — form intake, validation, duplicate/rate-limit handling, Gmail acknowledgement, owner notification and review-draft workflow.
- `apps-script/GmailFollowUpBot.gs` — separate Gmail-bound follow-up workflow; creates owner-review drafts only.
- `apps-script/Code.test.js` and `apps-script/GmailFollowUpBot.test.js` — local Node.js tests with mocked Google services and synthetic addresses.
- `AGENTS.md` — permanent instructions for Codex and contributors.
- `CODEX_EXECUTION_BRIEF.md` — detailed implementation and release requirements.
- `DEPLOYMENT.md` — owner-operated publication, Apps Script update, safety and rollback instructions.

There is no package manifest or checked-in GitHub Actions workflow. The website has no build step. GitHub Pages settings and Apps Script project/deployment settings are managed outside this repository.

## What automation does

- A quote request is validated and saved for duplicate-safe processing. The owner receives a notification and an owner-only quote draft. The customer receives a receipt/reference acknowledgement only.
- Enquiries receive a receipt acknowledgement. Substantive questions and uncertain cases require an owner response.
- The follow-up bot requires an AdenTech quote conversation and recognizable quote reference. It creates drafts for review and never sends customer messages or places orders.
- Incomplete or uncertain work is retained for owner review. The optional recovery trigger and Gmail draft trigger are not installed by running tests.

Internal estimates must use the owner's rules: the minimum visit charge includes the first billable hour, additional time is charged by the hour, travel uses only verified round-trip mileage from NW8, parts are confirmed separately, and VAT is not added. Do not calculate or publish a customer price until the owner confirms the scope and inputs.

## Configuration to confirm

Before relying on the live workflow, the owner must confirm:

1. The exact local service area to serve. Until supplied and configured, coverage questions stay with the owner.
2. The Google account that owns the web app and should receive owner notifications.
3. That the existing Apps Script endpoint configured in `index.html` belongs to the intended owner-controlled deployment.
4. Whether the Apps Script projects, deployment, Gmail labels, scopes and triggers already exist.

Do not guess or commit endpoint URLs, account addresses, project IDs, credentials or service-area details. See [DEPLOYMENT.md](DEPLOYMENT.md) for release and rollback steps.

## Run the local checks

Install a supported Node.js release if Node is not already available, then run these commands from the repository root:

```sh
node apps-script/Code.test.js
node apps-script/GmailFollowUpBot.test.js
node --check < apps-script/Code.gs
node --check < apps-script/GmailFollowUpBot.gs
node -e 'const fs=require("node:fs"); const vm=require("node:vm"); const h=fs.readFileSync("index.html","utf8"); const m=h.match(/<script>([\s\S]*?)<\/script>/); if(!m) throw Error("inline script missing"); new vm.Script(m[1]); console.log("inline JavaScript syntax OK")'
git diff --check
```

The tests use local stubs; they do not access Gmail, Apps Script, the configured form endpoint, customer accounts, or real email. Passing syntax/tests does not prove that a live form or deployment works. Do not run the Apps Script setup functions as a test.

## Safe contribution workflow

1. Read `AGENTS.md` and `CODEX_EXECUTION_BRIEF.md` before changing code.
2. Inspect the current branch, working-tree status, latest `origin/main`, and relevant open pull requests. Preserve untracked or unexplained files.
3. Make a focused change on a separate branch, update tests/docs, and run the relevant local checks.
4. Review the full diff for secrets, customer data, unrelated files, broken links, accessibility and mobile layout.
5. Open or update a reviewable pull request. Do not merge, deploy, authorize Google access, run live Gmail, create triggers, or send email without the owner's explicit approval.

At handover, report the branch and PR, changed files, exact test results, configuration still needed, and whether anything was merged or deployed.
