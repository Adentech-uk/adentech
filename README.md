# AdenTech

AdenTech provides practical IT setup and support for home users, remote workers and small businesses in the local service area.

## Services

- Desktop and laptop setup and troubleshooting
- Microsoft 365, Outlook and email help
- Wi-Fi and network troubleshooting
- Monitor, dock, printer and peripheral setup
- Workstation setup, testing and handover

Visit the website for service information and to request a quote.

## Website

The public website is a static site in `index.html`, with its privacy notice in `privacy.html`. It is intended for GitHub Pages. `config.js` contains the public URL of the enquiry API; it must be set to the deployed Cloudflare Worker URL ending in `/api/enquiries`.

## Contact and quotes

Use the website's contact form to submit a general enquiry or quote request. The form sends the submission to the Cloudflare Worker in the private `Adentech-uk/adentech-private` repository. Resend sends an owner notification to `adentech26@gmail.com` and, after the owner notification is accepted, attempts a separate receipt-only email to the customer's submitted address. The receipt is not a quote, price confirmation or booking. The customer receives a reference only after the owner notification is accepted by Resend. Google Apps Script and Google Sheets are not part of this intake route.

Do not send passwords, payment-card details or sensitive account information through the form.
