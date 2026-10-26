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

### What the automation does

- Creates/reuses Gmail labels `AdenTech/Quotes` and `AdenTech/Enquiries`.
- Labels the matching notification email and sends the details to the Google account used to deploy the script.
- Sends the customer a receipt acknowledgement.
- Uses the submitter's email as the reply-to address on the owner notification.

**Important:** this initial version routes requests and sends acknowledgements; it does not calculate or promise a final quote automatically. Before enabling automated quote offers, define approved service rates or quote rules, service area, travel/parts treatment, and which jobs require manual review. Never let the bot invent prices or promise work outside the agreed scope. Avoid collecting passwords or other sensitive account details.
