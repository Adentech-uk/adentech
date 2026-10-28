# AdenTech release and rollback guide

The website and Apps Script are separate systems. Updating GitHub Pages does not update Google Apps Script, and updating Apps Script does not publish the website. This guide describes owner-run release steps; no deployment, Gmail authorization, live form submission, or trigger creation has been performed as part of this code change.

## Before release: confirm the values owned by you

1. Confirm which Google account should own the web app and receive owner notifications. The script uses the effective account at deployment; it does not contain an owner email address.
2. Confirm that the `/exec` URL already configured as `FORM_ENDPOINT` in `index.html` is the intended web app. If it is not, supply and enter the exact URL from the owner-controlled Apps Script deployment. Do not guess or copy a test URL into the production site.
3. No service area is set in this repository. Do not claim coverage or enable location-based replies until you provide exact towns/postcodes.
4. Review the draft PR and run the local tests below. The automated tests use stubs and do not prove behavior in the owner's Google account.

```sh
node apps-script/Code.test.js
node apps-script/GmailFollowUpBot.test.js
node --check < apps-script/Code.gs
node --check < apps-script/GmailFollowUpBot.gs
```

## Publish the website with GitHub Pages

There is no checked-in GitHub Actions Pages workflow. The expected setup is GitHub Pages deployed from the `main` branch root.

1. Review and merge the release PR when you approve it. Do not merge a draft PR before its review is complete.
2. In the GitHub repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/(root)`**, then select **Save**. If GitHub Pages is already configured differently, confirm the intended source before changing it.
5. Wait for the Pages deployment shown in the repository's **Deployments** or **Actions** view to complete.
6. Open the published site and check the first screen, service descriptions, mobile layout and form endpoint configuration. Do not submit a real customer form as a release smoke test: a live submission sends an owner notification and customer acknowledgement and may create a Gmail draft.

### Roll back GitHub Pages

1. Find the merge commit for the bad website release in the repository history.
2. Use GitHub's **Revert** action on the merged pull request, or create a branch and run `git revert <merge-commit-sha>`.
3. Open and merge the revert PR. Do not force-push or reset `main`.
4. Wait for the new Pages deployment, then confirm the previous website is live.

## Update the Apps Script web app

Use the existing owner-controlled Apps Script project and deployment if one exists. The project ID and live deployment URL are not stored here.

1. Sign into the Google account confirmed above and open the existing Apps Script project for the website handler.
2. Save a copy of the current `Code.gs` outside the project as a rollback copy.
3. Replace the editor contents with `apps-script/Code.gs` and save.
4. In **Deploy → Manage deployments**, edit the existing web app deployment. Select **New version**, keep **Execute as: Me** and the currently approved public access setting, then deploy the new version. Editing the existing deployment preserves its `/exec` URL.
5. If no web app deployment exists, create one only after confirming the owner account and access policy. Set **Execute as: Me** and access to **Anyone** for a public website form. Copy the exact `/exec` URL shown by Apps Script into `FORM_ENDPOINT`; do not invent one.
6. Use a separate test deployment and dummy contact details for end-to-end checks. The handler sends an owner notification and a customer receipt and can create an owner-only quote draft. Obtain explicit approval before using a live customer form or real Gmail account for testing.

The customer email is a receipt/reference acknowledgement only. Quote drafts are owner-only. The intake recovery queue is stored in Script Properties; run `getPendingIntakeReviews()` in the owner project to inspect unresolved items. `recoverPendingIntakeReviews()` sends alerts for pending items and checks marked sent mail after interruption.

### Roll back the Apps Script web app

1. Open **Deploy → Manage deployments** in the same project.
2. Edit the existing web app deployment and select the last known-good deployed version.
3. Deploy that version and confirm the deployment still uses the intended `/exec` URL.
4. If the old version is unavailable, restore the saved `Code.gs` copy, save it, and deploy it as a new version.

## Gmail follow-up bot and recovery trigger

`apps-script/GmailFollowUpBot.gs` belongs in a separate Gmail-bound Apps Script project. It creates drafts only and is restricted to AdenTech quote conversations with a recognized reference. The helper `setupAdenTechAutomation()` creates labels and a 15-minute trigger. Do not run it until the owner approves Gmail access and trigger creation.

The intake recovery trigger is separate. `setupIntakeRecoveryTrigger()` creates one hourly trigger for `recoverPendingIntakeReviews()` and is idempotent. It has not been run. The owner can first inspect the queue manually, then decide whether to authorize this trigger.

## Optional Gmail-to-Sheets ticket monitor

`apps-script/TicketMonitor.gs` reads the existing `AdenTech/Quotes` and
`AdenTech/Enquiries` labels and maintains a Google Sheets ticket log. It is
not enabled by this repository change. Read
[`apps-script/TICKET_MONITOR_SETUP.md`](apps-script/TICKET_MONITOR_SETUP.md)
for the spreadsheet properties, required Google scopes, controlled test,
recommended 15-minute schedule, recovery behavior and rollback. Do not run
`processAdenTechTickets()` or `setupAdenTechTicketMonitorTrigger()` against a
live account until the owner has reviewed and explicitly approved access and
trigger creation. Mock tests do not verify live Gmail or Sheets behavior.

### Remove triggers during rollback

In the relevant Apps Script project, open **Triggers** (clock icon), delete the trigger whose handler is `processAdenTechInbox` to stop the Gmail draft bot, or delete `recoverPendingIntakeReviews` to stop periodic intake recovery. Removing a trigger does not delete existing email or drafts. Do not run either setup function again unless the owner wants to reinstall that automation.

## Safe operating rules

- Never paste Google credentials, OAuth tokens, project IDs, or customer data into this repository.
- Do not run Apps Script test setup against a production project.
- Do not execute `setupAdenTechAutomation()` or `setupIntakeRecoveryTrigger()` without explicit approval for the resulting trigger and account access.
- Never let automation send a quote, price or order. Review and send any customer-facing quote manually after confirming scope, billable duration, exact address, verified round-trip mileage and parts.
