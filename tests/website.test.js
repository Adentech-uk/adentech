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

test("both pages provide keyboard skip navigation and visible focus styling", () => {
  assert.ok(html.includes('href="#main-content">Skip to main content</a>'));
  assert.ok(html.includes(':focus-visible'));
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.ok(about.includes('href="#main-content">Skip to main content</a>'));
  assert.ok(about.includes(':focus-visible'));
});

test("website explains local coverage and quote expectations", () => {
  assert.match(html, /around NW8/i);
  assert.match(html, /Your postcode helps me check whether I can cover your area/i);
  assert.match(html, /not a confirmed quote or booking/i);
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.match(about, /based in NW8 and focus on serving nearby areas/i);
});

test("website has no duplicate element IDs", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});

test("quote form requires postcode, equipment, quantity, job type, subject and a useful job description", () => {
  assert.match(script, /location\.required\s*=\s*isQuote/);
  assert.match(script, /equipment\.required\s*=\s*isQuote/);
  assert.match(script, /equipment\.minLength\s*=\s*isQuote\s*\?\s*3\s*:/);
  assert.match(script, /jobType\.required\s*=\s*isQuote/);
  assert.match(script, /deviceQuantity\.required\s*=\s*isQuote/);
  assert.match(html, /id="deviceQuantity" name="deviceQuantity" maxlength="100"/);
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

test("homepage removes public pricing navigation and retains a clear quote journey", () => {
  const pricing = fs.readFileSync(__dirname + "/../pricing.html", "utf8");
  assert.doesNotMatch(html, /href="pricing\.html"/);
  assert.match(html, /class="header-link" href="#start">Get a quote/);
  assert.ok(html.includes('href="#start">Get a quote</a>'));
  assert.ok(html.includes('id="start"'));
  assert.ok(html.includes('id="enquiry-form"'));
  assert.doesNotMatch(html, /£20 per hour|one-hour minimum|£50 minimum visit charge/);
  assert.match(pricing, /http-equiv="refresh" content="0; url=index\.html#start"/);
  assert.match(pricing, /Continue to the AdenTech quote form/);
  assert.doesNotMatch(pricing, /£20|£50|£0\.45|per hour|first 10 customers|5 miles of NW8/i);
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
  assert.match(script, /(?:couldn't confirm that a separate receipt email was accepted for sending|I couldn’t confirm delivery to AdenTech\.)/);
  assert.match(privacy, /separate receipt-only email to the email address you provided/i);
  assert.match(privacy, /replies to the customer receipt are directed to support@adentech\.co\.uk/i);
});

test("About page includes the founder portrait, LinkedIn and Google review link", () => {
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.ok(about.includes('src="assets/founder.png"'));
  assert.ok(fs.existsSync(__dirname + "/../assets/founder.png"));
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


test("homepage has mobile viewport, touch-sized controls and phone-friendly form inputs", () => {
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /\.field input,\.field select,\.field textarea\{font-size:16px\}/);
  assert.match(html, /min-height:48px;padding:12px/);
  assert.match(html, /@media\(max-width:360px\)/);
  assert.match(html, /overflow-x:hidden/);
});

test("About page has mobile viewport, touch-friendly navigation and narrow-screen layout", () => {
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.match(about, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(about, /nav a\{[^}]*min-height:44px/);
  assert.match(about, /@media\(max-width:380px\)/);
  assert.match(about, /overflow-x:hidden/);
});


test("founder story stacks on narrow screens with a readable portrait and text column", () => {
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.match(about, /\.founder\{[^}]*grid-template-columns:150px minmax\(0,1fr\)/);
  assert.match(about, /@media\(max-width:760px\)[\s\S]*?\.founder\{[^}]*grid-template-columns:1fr/);
  assert.match(about, /\.portrait\{[^}]*width:150px;height:150px;max-width:100%;aspect-ratio:1\/1/);
  assert.match(about, /border-radius:50%/);
  assert.match(about, /width:min\(100%,140px\);height:140px;max-width:140px/);
  assert.match(about, /\.story p\{margin:0 0 12px;color:var\(--muted\)\}/);
});


test("About trust cards remain readable and responsive across screen sizes", () => {
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.match(about, /\.trust-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(about, /@media\(max-width:760px\)[\s\S]*?\.trust-grid\{grid-template-columns:1fr\}/);
  assert.match(about, /\.card\{padding:20px;[^}]*background:#fff/);
  assert.match(about, /\.card p\{margin:0;color:var\(--muted\)\}/);
});


test("legacy pricing URL no longer publishes a price list and redirects to the quote form", () => {
  const pricing = fs.readFileSync(__dirname + "/../pricing.html", "utf8");
  assert.match(pricing, /meta name="robots" content="noindex,follow"/);
  assert.match(pricing, /index\.html#start/);
  assert.doesNotMatch(pricing, /£20|£50|£0\.45|per hour|first 10 customers|5 miles of NW8/i);
});

test("responsive browser check targets the current About trust cards and real breakpoints", () => {
  const responsive = fs.readFileSync(__dirname + "/../scripts/check-responsive-layout.cjs", "utf8");
  const about = fs.readFileSync(__dirname + "/../about.html", "utf8");
  assert.match(about, /\.trust-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(about, /@media\(max-width:760px\)[\s\S]*?\.trust-grid\{grid-template-columns:1fr\}/);
  assert.match(responsive, /querySelector\("\.trust-grid"\)/);
  assert.match(responsive, /querySelectorAll\("\.trust-grid \.card"\)/);
  assert.match(responsive, /width <= 760 \? 1 : 3/);
  assert.match(responsive, /layout\.documentWidth/);
  assert.match(responsive, /card\.visible/);
  assert.match(responsive, /card\.textWidth > 0 && card\.textHeight > 0/);
  assert.doesNotMatch(responsive, /\.values \.grid|\.commitments/);
});
