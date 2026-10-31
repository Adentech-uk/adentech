const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
const privacy = fs.readFileSync(__dirname + "/../privacy.html", "utf8");
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

test("quote form requires town or postcode, equipment and a useful job description", () => {
  assert.match(script, /location\.required\s*=\s*isQuote/);
  assert.match(script, /equipment\.required\s*=\s*isQuote/);
  assert.match(script, /equipment\.minLength\s*=\s*isQuote\s*\?\s*3\s*:/);
  assert.match(script, /details\.minLength\s*=\s*isQuote\s*\?\s*20/);
  assert.match(script, /subject\.required\s*=\s*!isQuote/);
});

test("form payload matches the intake contract without early phone or address collection", () => {
  for (const field of ["requestId","kind","name","email","location","equipment","details","timing","subject","existingReference","fullAddress","deviceQuantity","jobType","photoLink"]) {
    assert.match(script, new RegExp("\\b" + field + "\\s*:"));
  }
  assert.match(script, /fullAddress:\s*""/);
  assert.doesNotMatch(html, /name=["']phone["']/i);
  assert.doesNotMatch(html, /name=["']fullAddress["']/i);
  assert.doesNotMatch(html, /type=["']password["']/i);
  assert.doesNotMatch(html, /type=["']tel["']/i);
});

test("submission status does not claim backend confirmation or clear customer entries", () => {
  assert.match(script, /mode:\s*"no-cors"/);
  assert.match(script, /cannot confirm that it was received or processed/i);
  assert.doesNotMatch(script, /form\.reset\s*\(/);
});

test("public site contains no advertised prices and keeps the quote call to action", () => {
  assert.match(html, /Get a quote/i);
  assert.doesNotMatch(html, /£\s?\d+(?:\.\d{2})?/);
});

test("privacy policy explains later address and phone collection", () => {
  assert.match(privacy, /does not ask for a phone number or full service address at the initial enquiry stage/i);
  assert.match(privacy, /full service address to confirm travel/i);
  assert.match(privacy, /phone number to help coordinate the visit/i);
  assert.match(privacy, /Google Privacy Policy/);
  assert.match(privacy, /GitHub Privacy Statement/);
});
