const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
const privacy = fs.readFileSync(__dirname + "/../privacy.html", "utf8");
const config = fs.readFileSync(__dirname + "/../config.js", "utf8");
const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.indexOf("</script>", scriptStart);
const script = html.slice(scriptStart, scriptEnd);

test("website inline JavaScript parses", () => {
  assert.ok(scriptStart >= "<script>".length && scriptEnd > scriptStart);
  assert.doesNotThrow(() => new vm.Script(script));
});

test("website has no duplicate element IDs", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});

test("quote form requires postcode, equipment, subject and a useful job description", () => {
  assert.match(script, /location\.required\s*=\s*isQuote/);
  assert.match(script, /equipment\.required\s*=\s*isQuote/);
  assert.match(script, /equipment\.minLength\s*=\s*isQuote\s*\?\s*3\s*:/);
  assert.match(script, /details\.minLength\s*=\s*isQuote\s*\?\s*20/);
  assert.match(script, /subject\.required\s*=\s*true/);
});

test("form payload matches the email Worker contract without collecting full address or phone", () => {
  for (const field of ["requestId","kind","name","email","location","equipment","details","timing","subject","deviceQuantity","jobType","website"]) {
    assert.match(script, new RegExp("\\b" + field + "\\s*:"));
  }
  assert.match(script, /website:\s*document\.getElementById\("website"\)\.value\.trim\(\)/);
  assert.doesNotMatch(html, /name=["']phone["']/i);
  assert.doesNotMatch(html, /name=["']fullAddress["']/i);
  assert.doesNotMatch(html, /type=["']password["']/i);
  assert.doesNotMatch(html, /type=["']tel["']/i);
});

test("form uses the JSON API and only confirms receipt after a valid server reference", () => {
  assert.match(html, /<script src="config\.js"><\/script>/);
  const endpointSetting = config.match(/window\.ADENTECH_API_URL\s*=\s*"([^"]*)"/);
  assert.ok(endpointSetting, "config.js must define ADENTECH_API_URL");
  assert.ok(endpointSetting[1] === "" || /^https:\/\/(?:[a-z0-9-]+\.)+workers\.dev\/api\/enquiries$/.test(endpointSetting[1]));
  assert.match(script, /mode:\s*"cors"/);
  assert.match(script, /"Content-Type":"application\/json"/);
  assert.match(script, /response\.ok/);
  assert.match(script, /result\.reference/);
  assert.doesNotMatch(script, /no-cors|script\.google\.com/);
  assert.match(script, /form\.reset\s*\(/);
});

test("submission retry keeps the request ID until the customer edits the form", () => {
  assert.match(script, /let requestId = createRequestId\(\)/);
  assert.match(script, /form\.addEventListener\("input"/);
});

test("public site contains no advertised prices and keeps the quote call to action", () => {
  assert.match(html, /Get a quote/i);
  assert.doesNotMatch(html, /£\s?\d+(?:\.\d{2})?/);
});

test("privacy policy discloses GitHub, Cloudflare, Resend and Gmail processing", () => {
  assert.match(privacy, /Cloudflare Worker/);
  assert.match(privacy, /Resend/);
  assert.match(privacy, /Gmail/);
  assert.match(privacy, /No Google Apps Script or Google Sheets service is used/i);
  assert.match(privacy, /does not ask for a phone number or full service address at the initial enquiry stage/i);
});
