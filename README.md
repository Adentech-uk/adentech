# AdenTech

Website for AdenTech, independent home and small office IT setup.

## Website

- `index.html` is the single-page site; no build step is needed.
- Hosted with GitHub Pages.
- Fiverr remains available at [fiverr.com/mahad209](https://www.fiverr.com/mahad209).

## Quote and enquiry automation

The site has two separate forms:
- **Get a Quote** — captures contact details, location, equipment, requested work and preferred timing.
- **General Enquiry** — captures contact details, subject and message.

The forms are not live until the Google Apps Script endpoint is deployed and added to `FORM_ENDPOINT` in `index.html`.

### Connect the forms to Gmail

1. Sign into the Google account that should receive website leads, then open [Google Apps Script](https://script.google.com/).
2. Create a project and copy `apps-script/Code.gs` into its `Code.gs` editor.
3. Select **Deploy → New deployment → Web app**.
4. Set **Execute as** to **Me** and access to **Anyone** so website visitors can submit the form. Review the permissions, then authorize Gmail access.
5. Deploy and copy the web app URL ending in `/exec`.
6. In `index.html`, replace `PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE` in `FORM_ENDPOINT` with that URL, then commit the file.
7. Test both forms from the published site. Confirm the owner receives the notification and the test customer email receives an acknowledgement.

### Current bot rules

- Creates/reuses Gmail labels `AdenTech/Quotes` and `AdenTech/Enquiries`.
- Sends a lead notification to the Google account used to deploy the script and labels that notification.
- **Quote requests:** sends a receipt acknowledgement and creates a customer-reply draft for the owner to review. It never invents or sends a price automatically.
- **General enquiries:** auto-answers only a narrow, clear question about the types of services offered. Questions about prices, service area, availability, technical compatibility, urgent issues and anything uncertain are escalated for owner review.
- Uses the submitter's email as the reply-to address on the owner notification.

### Still required before going live

- Replace the form endpoint placeholder in `index.html` with the deployed Apps Script `/exec` URL.
- Set the exact towns/postcodes served in `SERVICE_AREA` in `apps-script/Code.gs` before adding any service-area auto-replies. Do not claim local coverage until this is configured.
- Submit test quote and enquiry forms and verify the labels, notification emails, acknowledgement emails and quote draft.
- Before allowing any customer-facing automatic quote, define written rules for labour rates, minimum charge, travel, parts, VAT/tax if applicable, remote vs on-site jobs, cancellations, and jobs that must always be manually reviewed. Keep owner approval enabled until the rules are tested.

Never let the bot invent prices or promise work outside the agreed scope. Avoid collecting passwords or other sensitive account details.
