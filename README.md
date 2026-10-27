# AdenTech

AdenTech helps home users, remote workers and small teams set up computers and workstations. The website is a static, single-page site in `index.html` and is intended for GitHub Pages.

## Services

- Desktop and laptop setup
- Monitor, dock and peripheral setup
- Printer installation and connection
- Workstation setup, testing and handover
- Agreed equipment moves between desks

The site directs customers to **Get a quote**. It does not publish a price list or claim a service area. Do not send passwords or sensitive account information through the form.

## Quote and enquiry handling

- `apps-script/Code.gs` validates submissions, applies rolling rate limits, stores request state and prevents duplicate processing by request ID.
- Customers receive a receipt/reference acknowledgement only. They never receive an automatically generated quote or price.
- The owner receives a request notification. New quote requests create an owner-only quote draft; an existing quote reference is routed for owner review and does not create another quote draft.
- If processing becomes uncertain, the request is retained for review. `getPendingIntakeReviews()` lists persisted review cases. `recoverPendingIntakeReviews()` can send pending owner alerts without replaying customer messages. `setupIntakeRecoveryTrigger()` installs an optional hourly recovery trigger when deliberately run by the owner.
- `apps-script/GmailFollowUpBot.gs` is a separate Gmail-bound script. It creates marked drafts only for AdenTech quote conversations; it does not send email or place orders. `setupAdenTechAutomation()` creates Gmail labels and a 15-minute trigger, so run it only after explicit owner approval.
- `apps-script/TicketMonitor.gs` is an optional Gmail-to-Sheets ticket monitor. It reads the existing quote/enquiry labels, updates one ticket row per reference, and alerts the owner about verified customer replies. It does not send customer replies, quotes, prices or booking confirmations. Review [ticket monitor setup](apps-script/TICKET_MONITOR_SETUP.md) before configuring it.

Internal labour estimate rules are £50 for the first billable hour and £20 for each additional billable hour. Add £0.45 per verified round-trip mile from NW8. Do not estimate travel before checking the exact address and route; confirm parts separately. AdenTech is not VAT registered, so do not add VAT. These rules are for owner review and are not displayed as public prices.

## Configuration to confirm

- `index.html` currently contains an Apps Script `/exec` endpoint. Confirm in the owner's Google account that it is the intended web app before relying on it; replace it only with the exact URL supplied by the owner.
- The web app runs as the Google account selected at deployment. The owner notification recipient is taken from that account at runtime; there is no hard-coded owner email.
- No service area is configured. Do not add local coverage or service-area promises until the owner supplies the exact towns/postcodes.
- The repository does not contain the Apps Script project ID, Gmail account configuration or credentials. Keep those in the owner's Google account, never in this repository.

## Tests

Run the local Apps Script stubs with Node.js:

```sh
node apps-script/Code.test.js
node apps-script/GmailFollowUpBot.test.js
node --test apps-script/TicketMonitor.test.js
node --check < apps-script/TicketMonitor.gs
```

These tests do not connect to Google, access Gmail, deploy Apps Script or send real messages. See [DEPLOYMENT.md](DEPLOYMENT.md) for release and rollback steps.
