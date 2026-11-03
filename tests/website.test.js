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

test("public site explains pricing clearly and keeps the quote call to action", () => {
  assert.ok(html.includes("Get a quote"));
  assert.ok(html.includes("From £20 per hour"));
  assert.ok(html.toLowerCase().includes("no minimum visit charge"));
  assert.ok(html.toLowerCase().includes("no mileage fee"));
  assert.ok(html.includes("<option>Saturday</option>"));
  assert.ok(html.includes("<option>Sunday</option>"));
  assert.ok(html.includes("https://www.facebook.com/profile.php?id=61596044257571"));
  assert.ok(html.includes("https://www.youtube.com/@AdenTechSupport"));
});

test("privacy policy discloses GitHub, Cloudflare, Resend and Gmail processing", () => {
  assert.match(privacy, /Cloudflare Worker/);
  assert.match(privacy, /Resend/);
  assert.match(privacy, /Gmail/);
  assert.match(privacy, /No Google Apps Script or Google Sheets service is used/i);
  assert.match(privacy, /does not ask for a phone number or full service address at the initial enquiry stage/i);
});

test("customer receipt status reflects provider acceptance without claiming delivery", () => {
  assert.match(script, /Resend has accepted a receipt email for sending to/);
  assert.match(script, /couldn't confirm that a separate receipt email was accepted for sending/);
  assert.match(privacy, /separate receipt-only email to the email address you provided/i);
  assert.match(privacy, /replies to the customer receipt are directed to support@adentech\.co\.uk/i);
});

test("About page includes the founder portrait, LinkedIn and Google review link", () => {
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.ok(about.includes('src="/assets/founder.png"'));
  assert.ok(about.includes("https://www.linkedin.com/in/mahad-aden-0327a1124"));
  assert.ok(about.includes("https://g.page/r/CS4FWxybnOanEBM/review"));
});

test("public contact and fallback email use the AdenTech support address", () => {
  assert.match(html, /mailto:support@adentech\.co\.uk/);
  assert.match(html, /email support@adentech\.co\.uk/i);
  assert.doesNotMatch(html, /adentech26@gmail\.com/i);
  assert.match(privacy, /mailto:support@adentech\.co\.uk/);
  assert.doesNotMatch(privacy, /adentech26@gmail\.com/i);
});
