# AdenTech Apps Script: beginner test setup

This guide creates two separate test projects using the latest script versions in the GitHub main branch. It does not deploy a website endpoint, edit your existing production Apps Script project, or send email.

## What you need
- A Windows PC with internet access.
- Git installed (GitHub Desktop installs Git).
- Node.js LTS installed from https://nodejs.org/ (includes npm).
- Access to the Google account that should own the Apps Script test projects.
- Apps Script API enabled at https://script.google.com/home/usersettings.

## 1. Get the repository
If you already have a local clone, open PowerShell in that folder. Otherwise, install GitHub Desktop, clone https://github.com/Adentech-uk/adentech, then open the repository folder in PowerShell.

## 2. Run the setup script
From the repository root, run these commands:
    Set-ExecutionPolicy -Scope Process Bypass
    .\scripts\setup-apps-script-tests.ps1

When prompted, type TEST to continue. Sign in when the Google browser prompt appears.

The script fetches the latest versions of apps-script/Code.gs and apps-script/GmailFollowUpBot.gs from GitHub main, creates local test folders, creates two new standalone Apps Script test projects, and uploads the code. It does not deploy either project or create the Gmail trigger.

Generated test folders and project IDs are ignored by Git so they should not be committed.

## 3. Open the test projects
In each folder, run:
    cd .\apps-script-test\website
    clasp open
Then repeat for the gmail-bot folder. clasp open opens the project associated with that folder.

## 4. Test the website handler safely
- Open the Website Handler - TEST project.
- Do not deploy it publicly yet.
- The doPost handler expects a web request, so it is not a normal manual test.
- For a proper end-to-end test, first use a separate test HTML page and a test deployment with dummy details. Never replace the live website's existing Apps Script URL during testing.
- Verify the received notification, reference, location handling, and unknown device quantity. Check Apps Script Executions if anything fails.

## 5. Test the Gmail bot safely
- Open Gmail Draft Bot - TEST.
- Read the setup comments at the top of Code.gs.
- Start with a test Gmail account if possible. If you use your real Gmail, create a clearly labelled dummy thread and use dummy contact details only.
- Run processAdenTechInbox() manually first and review the resulting drafts.
- It should create drafts only. Review every recipient, subject, and body before sending anything yourself.
- Do not run setupAdenTechAutomation() until manual tests pass. That function installs a recurring 15-minute trigger. Remove the trigger from Apps Script Triggers if you no longer want it.
- This script has not been live-tested against your mailbox; check for duplicate drafts, incorrect thread matches, and unrelated messages before using it on real customer traffic.

## 6. When tests pass
Only then decide whether to update the existing production website project. The live endpoint is separate from these test projects. Updating or redeploying the production web app is a separate, deliberate step.

## Troubleshooting
- clasp not recognised: close and reopen PowerShell after installing Node.js/clasp; confirm npm and clasp are on PATH.
- Apps Script API disabled: visit https://script.google.com/home/usersettings and enable it, then rerun the script.
- Permission prompt: ensure you're signing into the intended Google account.
- A test folder already has .clasp.json: do not rerun blindly; it may already be linked to a project. Open it with clasp open and verify before changing anything.
- Upload fails: run clasp status from that project folder and read the full error before retrying.

## Safety notes
- Never share .clasp.json, OAuth tokens, or ~/.clasprc.json publicly.
- Do not commit customer data, Google credentials, or project IDs.
- No VAT is added by this setup; pricing logic remains in the source scripts.
