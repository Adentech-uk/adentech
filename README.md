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

Use the website's contact form to submit a general enquiry or quote request. The form sends the submission to the Cloudflare Worker in the private `Adentech-uk/adentech-private` repository, which validates it and uses Resend to email the owner at `adentech26@gmail.com`. The customer receives a reference only after the email provider confirms acceptance. The customer is not automatically sent a quote or acknowledgement email. Submissions are subject to owner review; work and price must be agreed before work starts. Google Apps Script and Google Sheets are not part of this intake route.

Do not send passwords, payment-card details or sensitive account information through the form.
