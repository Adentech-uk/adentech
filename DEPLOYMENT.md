# Website deployment

AdenTech's public website is hosted using GitHub Pages from this repository.

## Website files

- `index.html` — the public website and contact form.
- `privacy.html` — the website privacy policy.

## Publishing changes

1. Make and review website changes on a working branch.
2. Check both website files, including links, form behaviour and privacy wording.
3. Before release, confirm the privacy policy identifies the correct legal data controller (not just the trading name) and states the retention period or clear retention criteria approved by the owner. Do not invent these details.
4. Commit and push only approved changes to the configured GitHub Pages branch.
5. After publishing, check the live website, privacy-policy link and contact form.
6. Remember that the contact form uses a Google Apps Script endpoint. The page cannot read a confirmation from that endpoint, so a browser-side success message must not be treated as proof that a request was received or processed.

Do not put credentials, customer information, private automation code, or internal operating procedures in this public repository. Do not publish a working branch unless it has been explicitly approved for release.
