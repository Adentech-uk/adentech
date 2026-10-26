# AdenTech Apps Script test-project bootstrap (Windows PowerShell)
# Run from the root of a local clone of Adentech-uk/adentech.
# Creates NEW TEST projects only. Does not deploy or modify the live website.
$ErrorActionPreference = "Stop"
$Root = (& git rev-parse --show-toplevel 2>$null)
if (-not $Root) { throw "Open PowerShell in your local AdenTech repository folder first. Git is required." }
$Root = $Root.Trim()
Write-Host "\`nAdenTech Apps Script TEST setup" -ForegroundColor Cyan
Write-Host "This creates two NEW test projects. It does not deploy or send emails."
$confirm = Read-Host "Type TEST to continue"
if ($confirm -cne "TEST") { Write-Host "Cancelled."; exit 0 }
Write-Host "\`nFetching latest scripts from GitHub..."
& git -C $Root fetch origin main
if ($LASTEXITCODE -ne 0) { throw "Git fetch failed. Check internet connection and GitHub access." }
$testRoot = Join-Path $Root "apps-script-test"
$websiteDir = Join-Path $testRoot "website"
$gmailDir = Join-Path $testRoot "gmail-bot"
New-Item -ItemType Directory -Force -Path $websiteDir, $gmailDir | Out-Null
$websiteCode = & git -C $Root show "origin/main:apps-script/Code.gs"
if ($LASTEXITCODE -ne 0 -or -not $websiteCode) { throw "Could not read apps-script/Code.gs from origin/main." }
$gmailCode = & git -C $Root show "origin/main:apps-script/GmailFollowUpBot.gs"
if ($LASTEXITCODE -ne 0 -or -not $gmailCode) { throw "Could not read apps-script/GmailFollowUpBot.gs from origin/main." }
Set-Content -Path (Join-Path $websiteDir "Code.gs") -Value ($websiteCode -join "\`n") -Encoding utf8
Set-Content -Path (Join-Path $gmailDir "Code.gs") -Value ($gmailCode -join "\`n") -Encoding utf8
$manifest = @'
{
  "timeZone": "Europe/London",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
'@
Set-Content -Path (Join-Path $websiteDir "appsscript.json") -Value $manifest -Encoding utf8
Set-Content -Path (Join-Path $gmailDir "appsscript.json") -Value $manifest -Encoding utf8
$gitignore = Join-Path $Root ".gitignore"
$ignoreLines = @("apps-script-test/", "node_modules/")
if (Test-Path $gitignore) {
  $existing = Get-Content $gitignore
  foreach ($line in $ignoreLines) {
    if ($existing -notcontains $line) { Add-Content -Path $gitignore -Value $line }
  }
} else { Set-Content -Path $gitignore -Value $ignoreLines }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js/npm is missing. Install the LTS version from https://nodejs.org/ and rerun."
}
if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) {
  Write-Host "\`nInstalling Google clasp..."
  & npm install -g @google/clasp
  if ($LASTEXITCODE -ne 0) { throw "clasp installation failed." }
}
Write-Host "\`nSigning in to Google. Follow the browser prompts..."
& clasp login
if ($LASTEXITCODE -ne 0) { throw "Google sign-in failed. Fix the issue and rerun clasp login." }
Push-Location $websiteDir
try {
  Write-Host "\`nCreating WEBSITE TEST project..."
  & clasp create --type standalone --title "AdenTech Website Handler - TEST"
  if ($LASTEXITCODE -ne 0) { throw "Could not create website test project. Enable Apps Script API at https://script.google.com/home/usersettings." }
  & clasp push --force
  if ($LASTEXITCODE -ne 0) { throw "Could not upload website test code." }
} finally { Pop-Location }
Push-Location $gmailDir
try {
  Write-Host "\`nCreating GMAIL BOT TEST project..."
  & clasp create --type standalone --title "AdenTech Gmail Draft Bot - TEST"
  if ($LASTEXITCODE -ne 0) { throw "Could not create Gmail test project. Enable Apps Script API at https://script.google.com/home/usersettings." }
  & clasp push --force
  if ($LASTEXITCODE -ne 0) { throw "Could not upload Gmail test code." }
} finally { Pop-Location }
Write-Host "\`nSetup finished. No web app deployment was created and no email was sent." -ForegroundColor Green
Write-Host "Website test folder: $websiteDir"
Write-Host "Gmail test folder:   $gmailDir"
Write-Host "\`nFollow apps-script/TESTING-GUIDE.md. Do not run setupAdenTechAutomation until ready for a recurring trigger."
