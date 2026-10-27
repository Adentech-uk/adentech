# AdenTech Repository-to-Apps-Script Bot

A browser-only, no-AI-API workflow that copies approved source files from the public AdenTech GitHub repository into new Google Apps Script projects.

## What it does

- Fetches only two allowlisted source files from Adentech-uk/adentech on main.
- Checks that expected function markers exist.
- Can create a separate standalone Apps Script project for the website handler or Gmail follow-up bot.
- Does not require an OpenAI API key or GitHub token.
- Does not execute code, install triggers, deploy, or send email.

## Setup in the browser

1. Open https://script.google.com/ and create a standalone project named AdenTech Repository-to-Apps-Script Bot.
2. Replace Code.gs with the contents of apps-script/RepositoryToAppsScriptBot.gs from this repository.
3. In Project Settings, enable showing appsscript.json in the editor.
4. Use this manifest:

    {
      "timeZone": "Europe/London",
      "dependencies": {},
      "exceptionLogging": "STACKDRIVER",
      "runtimeVersion": "V8",
      "oauthScopes": [
        "https://www.googleapis.com/auth/script.projects",
        "https://www.googleapis.com/auth/script.external_request"
      ]
    }

5. Save the project.
6. In the Google Cloud project associated with this Apps Script project, enable the Google Apps Script API.
7. Run testRepositoryConnection and inspect the execution log. Expected overall status: PASS.
8. To create a new project containing the website handler, run createWebsiteHandlerProject.
9. To create a separate project containing the Gmail follow-up bot, run createGmailFollowUpProject.
10. Authorise the requested Google permissions when prompted. Inspect the returned editorUrl.

## Important safety notes

- This copies source code from GitHub; it does not generate new code with AI.
- Public repository reads need no GitHub token. The Google Apps Script API requires the user's Google authorisation.
- Project creation is a real action and creates a new script project.
- The bot never runs the copied source, installs triggers, deploys a web app, or sends email.
- Review the generated project's code and permissions before running or deploying it.
- The two source files are intentionally placed in separate projects: the website handler and Gmail automation have different roles and should not be combined by default.
- The repository connection check confirms retrieval and markers, not syntax correctness or end-to-end behaviour.

## Troubleshooting

- 403 or PERMISSION_DENIED from the Apps Script API: enable the Apps Script API in the linked Google Cloud project, check account restrictions, and confirm the manifest scope is authorised.
- 401 from the Apps Script API: re-run and complete Google authorisation.
- GitHub source fetch fails: confirm the repository is public, branch is main, and file paths match.
- If project creation succeeds but adding content fails, inspect the logged scriptId and open that project before retrying to avoid creating duplicate projects.
