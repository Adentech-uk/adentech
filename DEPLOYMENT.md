# AdenTech quote and enquiry automation

The website has two lead forms:
- **Get a Quote** — captures contact details, location, equipment, work requested and preferred timing.
- **General Enquiry** — captures contact details, subject and message.

The automation script is in [apps-script/Code.gs](apps-script/Code.gs). It creates/reuses Gmail labels named **AdenTech/Quotes** and **AdenTech/Enquiries**, sends a lead summary to the Google account that deploys the script, and sends a receipt acknowledgement to the customer.

## Setup required before forms can deliver

1. Sign into the Google account whose Gmail inbox should receive leads.
2. Open [Google Apps Script](https://script.google.com/) and create a new project.
3. Copy the contents of `apps-script/Code.gs` into `Code.gs`.
4. Choose **Deploy → New deployment → Web app**.
5. Set **Execute as** to **Me**. Set access to **Anyone** so visitors can submit the public website form. Review the Google permissions and deploy.
6. Copy the web-app URL ending in `/exec`.
7. In `index.html`, replace `PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE` in `FORM_ENDPOINT` with that URL, then commit the change.
8. Test both forms and verify the notification appears in Gmail with the correct label and that the customer receives an acknowledgement.

If Google Workspace policies block public web apps, use an approved form/backend service instead. Never put Google passwords, API keys, or private tokens in the website repository.

## Quote policy

The bot acknowledges quote requests and gathers the information needed to prepare a quote. It does **not** invent a price or promise availability. Review each request and send a confirmed quote after checking the work, travel/location, equipment, time required and any applicable minimum charge. Once AdenTech has an agreed pricing/rate card and approval rules, the workflow can be extended to prepare suggested quote replies for review.

## Important

The forms are not live until the Apps Script is deployed and the URL is added to `index.html`. The site is static GitHub Pages, so it cannot create Gmail labels or send emails by itself.
