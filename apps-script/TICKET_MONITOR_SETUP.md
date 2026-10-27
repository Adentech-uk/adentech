# AdenTech ticket monitor setup

This optional Apps Script worker reads the existing `AdenTech/Quotes` and
`AdenTech/Enquiries` Gmail labels, records one row per request reference, and
alerts the owner about verified customer replies. It never sends or drafts a
customer response. The owner must still review and reply manually.

## Before enabling it

Do not add a public endpoint or a paid service. The worker uses standard
`GmailApp`, `SpreadsheetApp`, `PropertiesService`, `LockService`, and an
installable time trigger. It must be added to the same Apps Script project as
`apps-script/Code.gs` so it can see the labels created by website intake.

1. In Google Sheets, create a new spreadsheet or select a spreadsheet the
   owner has approved for customer ticket data. Copy its spreadsheet ID from
   the URL. Do not put the ID or customer data in Git.
2. In the owner-controlled Apps Script project, add `TicketMonitor.gs` and
   save. Do not run it against a live account during initial review.
3. Open **Project Settings → Script properties** and add:
   - `ADENTECH_TICKET_SPREADSHEET_ID`: the chosen spreadsheet ID.
   - `ADENTECH_TICKET_OWNER_EMAIL`: the exact owner address for reply alerts.
   - `ADENTECH_TICKET_MONITOR_INTERVAL_MINUTES`: `15` (recommended) or one of
     `1`, `5`, `10`, `30` if the owner deliberately chooses a different cadence.
4. The first controlled run creates `Tickets` and `Ticket Reviews` tabs and
   their headers. `Tickets` stores the reference, intake date, known customer
   details, type, subject, status, activity/reply dates, next action, Gmail
   permalink/thread ID, message cursor and owner notes. Existing owner notes
   are preserved on updates. A verified reply sets `Customer Responded` and
   highlights that ticket row. Unmatched or uncertain cases go to `Ticket
   Reviews` for manual handling.
5. First test in a separate Apps Script project/test Google account with a
   test spreadsheet, test owner address and synthetic labeled messages. Inspect
   both tabs and verify that repeated runs create no duplicate rows/alerts.
   This repository's mocked Node tests are not a live integration test.
6. Before authorizing against the real account, review the OAuth consent
   screen. Gmail access through `GmailApp` requests the broad
   `https://mail.google.com/` scope; Google Sheets access needs
   `https://www.googleapis.com/auth/spreadsheets`. Installing a time trigger
   also requires Apps Script trigger authorization. The trigger runs as the
   account that created it. Review the current Google consent prompt and
   account policy before approving; no authorization has been performed here.
7. Only after explicit owner approval, run `processAdenTechTickets()` once
   under the approved account and inspect the result. Then run
   `setupAdenTechTicketMonitorTrigger()` to install the configured polling
   trigger. The recommended schedule is every 15 minutes. Do not run the setup
   function before the owner authorizes the live account and trigger.

## Recovery and limitations

- The monitor scans only threads carrying the two existing intake labels.
  Existing label names and website intake behavior are unchanged.
- A request reference must occur in the notification as `Reference: ` followed
  by 8–16 hexadecimal characters. Missing or ambiguous references are put in
  `Ticket Reviews`; they are not guessed.
- A thread is associated with only one row. If a reference appears on multiple
  rows, or the row points to a different thread, the monitor stops and queues
  review rather than creating another ticket.
- Customer replies are verified against the email in the original owner
  notification. The configured owner and Apps Script effective-user addresses
  are ignored as customer senders. Other senders are flagged for review.
- Before notifying, the worker writes the ticket state and stores a stable
  message-specific attempt marker. On retry, it searches Sent for that marker.
  If delivery is found, it advances the row without sending again. If outcome
  remains uncertain, it stops retrying that alert and adds a review item. Check
  Sent and resolve that review manually; the system favors avoiding duplicate
  alerts over automatically resending an uncertain email.
- If Google Sheets is unavailable, a thread is retried on the next poll. If
  the notification was delivered but a later Sheets write failed, the stored
  marker and Sent search allow the next run to reconcile it. Script Properties
  and Sheets are separate services, so this is best-effort recovery, not a
  distributed exactly-once guarantee.
- The first received date is the date of the owner notification email, not an
  independently verified form submission timestamp. Existing thread message
  ordering is used for reply detection. A missing saved message ID is flagged
  for review rather than guessed.
- `setupAdenTechTicketMonitorTrigger()` does not delete existing triggers. If
  an old monitor trigger exists with another schedule, inspect it in the Apps
  Script Triggers page and have the owner decide whether to change it.

## Stop / rollback

In the Apps Script **Triggers** page, remove only the trigger whose handler is
`processAdenTechTickets`. This stops polling; it does not delete ticket rows,
labels, messages or drafts. To roll back code, restore the prior Apps Script
project version. Do not delete the spreadsheet as a rollback step; it contains
the ticket history and review queue.
