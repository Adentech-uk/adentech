/**
 * AdenTech Repository-to-Apps-Script Bot
 * Version 1.0.0 — no AI API and no GitHub token required.
 *
 * Reads an allowlisted file from the public AdenTech GitHub repository
 * and creates a NEW standalone Apps Script project containing that file.
 *
 * It does not execute fetched code, install triggers, deploy, or send email.
 */

const REPO_BOT = Object.freeze({
  owner: 'Adentech-uk',
  repo: 'adentech',
  branch: 'main',
  githubRawBase: 'https://raw.githubusercontent.com',
  appsScriptApiBase: 'https://script.googleapis.com/v1',
  profiles: {
    website: {
      title: 'AdenTech Website Enquiry Handler',
      sourcePath: 'apps-script/Code.gs',
      outputName: 'Code',
      requiredMarker: 'function doPost'
    },
    gmail: {
      title: 'AdenTech Gmail Follow-Up Bot',
      sourcePath: 'apps-script/GmailFollowUpBot.gs',
      outputName: 'Code',
      requiredMarker: 'function processAdenTechInbox'
    }
  }
});

/**
 * Run this first. Checks public GitHub connectivity and expected code markers.
 * Does not create a project or require Google project-creation permissions.
 */
function testRepositoryConnection() {
  const results = {
    bot: 'AdenTech Repository-to-Apps-Script Bot',
    repository: REPO_BOT.owner + '/' + REPO_BOT.repo,
    branch: REPO_BOT.branch,
    checkedAt: new Date().toISOString(),
    files: [],
    overall: 'PASS'
  };

  Object.keys(REPO_BOT.profiles).forEach(function (key) {
    const profile = REPO_BOT.profiles[key];
    try {
      const source = fetchApprovedRepositoryFile_(profile);
      const markerFound = source.indexOf(profile.requiredMarker) !== -1;
      if (!markerFound) throw new Error('Expected code marker was not found.');
      results.files.push({
        profile: key,
        path: profile.sourcePath,
        status: 'PASS',
        characters: source.length,
        requiredMarkerFound: true
      });
    } catch (err) {
      results.overall = 'FAIL';
      results.files.push({
        profile: key,
        path: profile.sourcePath,
        status: 'FAIL',
        error: String(err.message || err)
      });
    }
  });

  console.log(JSON.stringify(results, null, 2));
  return results;
}

/** Creates a new Apps Script project for the website handler. */
function createWebsiteHandlerProject() {
  return createProjectFromRepositoryProfile_('website');
}

/** Creates a separate new Apps Script project for the Gmail follow-up bot. */
function createGmailFollowUpProject() {
  return createProjectFromRepositoryProfile_('gmail');
}

function createProjectFromRepositoryProfile_(profileKey) {
  const profile = REPO_BOT.profiles[profileKey];
  if (!profile) throw new Error('Unknown profile. Use website or gmail.');

  // Fetch and validate the source before making any Google project.
  const source = fetchApprovedRepositoryFile_(profile);
  if (source.indexOf(profile.requiredMarker) === -1) {
    throw new Error('Expected function marker was not found. No project created.');
  }

  const accessToken = ScriptApp.getOAuthToken();
  const createResponse = UrlFetchApp.fetch(
    REPO_BOT.appsScriptApiBase + '/projects',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + accessToken },
      payload: JSON.stringify({ title: profile.title }),
      muteHttpExceptions: true
    }
  );

  const createStatus = createResponse.getResponseCode();
  const createBody = createResponse.getContentText();
  if (createStatus < 200 || createStatus >= 300) {
    throw new Error(
      'Apps Script project creation failed (HTTP ' + createStatus + '): ' +
      createBody.slice(0, 700) +
      '. Check that the Apps Script API is enabled and script.projects scope is authorised.'
    );
  }

  const project = JSON.parse(createBody);
  if (!project.scriptId) {
    throw new Error('Google did not return a scriptId.');
  }

  const files = [
    {
      name: 'appsscript',
      type: 'JSON',
      source: JSON.stringify({
        timeZone: 'Europe/London',
        exceptionLogging: 'STACKDRIVER',
        runtimeVersion: 'V8'
      }, null, 2)
    },
    {
      name: profile.outputName,
      type: 'SERVER_JS',
      source: source
    }
  ];

  const updateResponse = UrlFetchApp.fetch(
    REPO_BOT.appsScriptApiBase + '/projects/' +
      encodeURIComponent(project.scriptId) + '/content',
    {
      method: 'put',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + accessToken },
      payload: JSON.stringify({ files: files }),
      muteHttpExceptions: true
    }
  );

  const updateStatus = updateResponse.getResponseCode();
  if (updateStatus < 200 || updateStatus >= 300) {
    throw new Error(
      'Project ' + project.scriptId + ' was created, but adding code failed ' +
      '(HTTP ' + updateStatus + '): ' +
      updateResponse.getContentText().slice(0, 700) +
      '. Open the project and inspect it before retrying.'
    );
  }

  const result = {
    profile: profileKey,
    title: profile.title,
    sourceRepository: 'https://github.com/' +
      REPO_BOT.owner + '/' + REPO_BOT.repo + '/blob/' +
      REPO_BOT.branch + '/' + profile.sourcePath,
    scriptId: project.scriptId,
    editorUrl: 'https://script.google.com/home/projects/' +
      encodeURIComponent(project.scriptId) + '/edit',
    status: 'CREATED_NOT_RUN_NOT_DEPLOYED',
    note: 'Code copied from GitHub. It has not been executed, deployed, or given triggers.'
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function fetchApprovedRepositoryFile_(profile) {
  // Only files named in the fixed profile allowlist can be fetched.
  const knownPaths = Object.keys(REPO_BOT.profiles).map(function (key) {
    return REPO_BOT.profiles[key].sourcePath;
  });
  if (knownPaths.indexOf(profile.sourcePath) === -1) {
    throw new Error('Source path is not on the allowlist.');
  }

  const url = REPO_BOT.githubRawBase + '/' +
    encodeURIComponent(REPO_BOT.owner) + '/' +
    encodeURIComponent(REPO_BOT.repo) + '/' +
    encodeURIComponent(REPO_BOT.branch) + '/' +
    profile.sourcePath.split('/').map(encodeURIComponent).join('/');

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: false
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('GitHub source fetch returned HTTP ' + status + '.');
  }

  const source = response.getContentText();
  if (!source || !source.trim()) {
    throw new Error('The repository source file is empty.');
  }
  if (source.length > 100000) {
    throw new Error('Source file exceeded the 100,000-character safety limit.');
  }
  return source;
}
