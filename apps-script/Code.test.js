const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(__dirname + "/Code.gs", "utf8");

function harness(searchResult) {
  const saved = [];
  const sent = [];
  const warnings = [];
  const properties = {setProperty: (key, value) => saved.push({key, value})};
  const context = {
    console: {warn: value => warnings.push(value)},
    PropertiesService: {getScriptProperties: () => properties},
    Session: {getEffectiveUser: () => ({getEmail: () => "owner@example.test"})},
    GmailApp: {
      search: () => typeof searchResult === "function" ? searchResult() : searchResult,
      sendEmail: (...args) => sent.push(args)
    },
    Date,
    JSON
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {context, properties, saved, sent, warnings};
}

function state() {
  return {status: "in_progress", reference: "REF123", phases: {manualReviewNotification: "attempting"}};
}

function request() {
  return {requestId: "12345678-1234-4234-8234-123456789abc", name: "Owner review", email: "customer@example.test",
    message: "Please review", payload: {location: "NW8"}};
}

function markedThread(count = 1) {
  return {getId: () => "thread-1", getMessages: () => Array.from({length: count}, (_, i) => ({
    getSubject: () => "[AT-12345678-1234-4234-8234-123456789abc-REVIEW] notice " + i,
    getId: () => "message-" + i
  }))};
}

test("interrupted notice with a uniquely marked sent message recovers as done", () => {
  const h = harness([markedThread()]);
  const s = state();
  const recovered = h.context.reconcileAttemptingPhases_(s, request(), h.properties, "key");
  assert.equal(recovered, true);
  assert.equal(s.phases.manualReviewNotification, "done");
  assert.equal(h.sent.length, 0);
});

test("missing marked message remains manual review and is never resent", () => {
  const h = harness([]);
  const s = state();
  assert.equal(h.context.reconcileAttemptingPhases_(s, request(), h.properties, "key"), false);
  h.context.sendManualReviewNotice_(s, request(), h.properties, "key");
  assert.equal(s.status, "manual_review");
  assert.equal(s.phases.manualReviewNotification, "attempting");
  assert.equal(h.sent.length, 0);
  assert.equal(h.warnings.length, 1);
});

test("ambiguous marked messages remain manual review and are never resent", () => {
  const h = harness([markedThread(2)]);
  const s = state();
  assert.equal(h.context.reconcileAttemptingPhases_(s, request(), h.properties, "key"), false);
  h.context.sendManualReviewNotice_(s, request(), h.properties, "key");
  assert.equal(s.status, "manual_review");
  assert.equal(s.phases.manualReviewNotification, "attempting");
  assert.equal(h.sent.length, 0);
});

test("Gmail search failure does not retry an interrupted notice", () => {
  const h = harness(() => { throw new Error("search unavailable"); });
  h.context.sendManualReviewNotice_(state(), request(), h.properties, "key");
  assert.equal(h.sent.length, 0);
});

test("a pending manual-review notice sends once and records completion", () => {
  const h = harness([]);
  const s = state();
  s.phases.manualReviewNotification = "pending";
  h.context.sendManualReviewNotice_(s, request(), h.properties, "key");
  assert.equal(h.sent.length, 1);
  assert.equal(s.phases.manualReviewNotification, "done");
});
