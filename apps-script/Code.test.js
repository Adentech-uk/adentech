const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(__dirname + "/Code.gs", "utf8");

function harness(options = {}) {
  const store = new Map();
  const sent = [];
  const drafts = [];
  const labels = new Map();
  const warnings = [];
  const lockStats = {acquired:0, released:0};
  const properties = {
    getProperty: key => store.has(key) ? store.get(key) : null,
    setProperty: (key, value) => {store.set(key, String(value)); return properties;},
    deleteProperty: key => store.delete(key),
    getProperties: () => Object.fromEntries(store.entries())
  };
  function message(record) {
    return {
      getId: () => record.messageId,
      getSubject: () => record.subject,
      getPlainBody: () => record.body,
      getFrom: () => record.from || "owner@example.test",
      getTo: () => record.to || "",
      getCc: () => "",
      getBcc: () => ""
    };
  }
  function thread(record) {
    return {
      getId: () => record.threadId,
      getMessages: () => [message(record)]
    };
  }
  function search(query) {
    if (typeof options.search === "function") return options.search(query, {sent, drafts});
    if (query.indexOf("in:anywhere") === 0) return options.quoteThreads || [];
    const markerMatch = query.match(/subject:"([^"]+)"/);
    const marker = markerMatch ? markerMatch[1] : "";
    if (query.indexOf("in:sent") === 0) return sent.filter(item => item.subject.indexOf(marker) >= 0).map(thread);
    if (query.indexOf("in:drafts") === 0) return drafts.filter(item => !item.sent && item.subject.indexOf(marker) >= 0).map(thread);
    return [];
  }
  const context = {
    console: {warn: value => warnings.push(value), error: value => warnings.push(value)},
    Logger: {log: value => warnings.push(value)},
    PropertiesService: {getScriptProperties: () => properties},
    LockService: {getScriptLock: () => ({
      tryLock: () => {lockStats.acquired++; return options.lockResult !== false;},
      releaseLock: () => {lockStats.released++;}
    })},
    Session: {getEffectiveUser: () => ({getEmail: () => options.ownerEmail === undefined ? "owner@example.test" : options.ownerEmail})},
    Utilities: {
      DigestAlgorithm: {SHA_256:"SHA_256"}, Charset: {UTF_8:"UTF_8"},
      computeDigest: (_algorithm, value) => crypto.createHash("sha256").update(value).digest(),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""),
      getUuid: () => "11111111-1111-4111-8111-111111111111"
    },
    ContentService: {
      MimeType: {JSON:"application/json", TEXT:"text/plain"},
      createTextOutput: content => ({getContent:() => content, setMimeType:() => ({getContent:() => content})})
    },
    GmailApp: {
      search,
      getUserLabelByName: name => labels.get(name) || null,
      createLabel: name => {
        const label = {name:name, threads:[], addToThread(value){this.threads.push(value);}};
        labels.set(name, label);
        return label;
      },
      getThreadById: id => ({getId:() => id}),
      createDraft: (to, subject, body, extra) => {
        const record = {to, subject, body, extra, sent:false, threadId:"thread-"+(drafts.length+1), messageId:"draft-"+(drafts.length+1)};
        drafts.push(record);
        return {send:() => {
          record.sent = true;
          if (options.throwAfterOwnerSend && subject.indexOf("-OWNER]") >= 0) {
            sent.push(record);
            throw new Error("send response lost after delivery");
          }
          sent.push(record);
          return {getThread:() => thread(record)};
        }};
      },
      sendEmail: (to, subject, body, extra) => {
        const record = {to, subject, body, extra, sent:true, threadId:"sent-"+(sent.length+1), messageId:"message-"+(sent.length+1)};
        sent.push(record);
        if (options.throwAfterAcknowledgement && subject.indexOf("-ACK]") >= 0) {
          throw new Error("send response lost after delivery");
        }
      }
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: handler => ({timeBased:() => ({everyHours:() => ({create:() => ({handler})})})})
    },
    Date,
    JSON
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {context, properties, store, sent, drafts, labels, warnings, lockStats};
}

function validQuote(overrides = {}) {
  return Object.assign({
    requestId:"12345678-1234-4234-8234-123456789abc",
    kind:"quote", name:"Ada Example", email:"customer@example.com", location:"NW2",
    equipment:"Laptop and two monitors", details:"Please connect and test my laptop with two monitors.",
    timing:"", subject:"", existingReference:"", fullAddress:"", deviceQuantity:"",
    jobType:"Installation / setup", photoLink:""
  }, overrides);
}

function post(h, data) {
  const result = h.context.doPost({postData:{contents:typeof data === "string" ? data : JSON.stringify(data)}});
  return JSON.parse(result.getContent());
}

test("normal quote submission creates an owner draft and sends receipt only to customer", () => {
  const h = harness();
  const result = post(h, validQuote());
  assert.equal(result.ok, true);
  assert.equal(result.workflow, "quote-awaiting-owner-approval");
  assert.equal(h.sent.filter(item => item.to === "customer@example.com").length, 1);
  const customerMessage = h.sent.find(item => item.to === "customer@example.com");
  assert.match(customerMessage.subject, /-ACK\]/);
  assert.match(customerMessage.body, /receipt only/i);
  assert.doesNotMatch(customerMessage.body, /£|our pricing policy|labour estimate|mileage cost/i);
  assert.equal(h.drafts.filter(item => !item.sent && /-DRAFT\]/.test(item.subject)).length, 1);
  assert.match(h.drafts.find(item => /-DRAFT\]/.test(item.subject)).body, /INTERNAL OWNER-ONLY DRAFT/i);
  assert.equal(h.lockStats.acquired, 1);
  assert.equal(h.lockStats.released, 1);
});

test("invalid JSON, invalid email, and unsupported fields create no state and consume no rate budget", () => {
  const h = harness();
  assert.equal(post(h, "{").ok, false);
  assert.equal(post(h, validQuote({email:"not-an-email"})).ok, false);
  assert.equal(post(h, Object.assign(validQuote(), {unexpected:"field"})).ok, false);
  assert.equal(h.store.size, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.drafts.length, 0);
  assert.equal(h.store.has("AT_RATE_GLOBAL"), false);
  assert.equal(h.lockStats.acquired, 0);
});

test("unknown device quantity is accepted and stays explicitly unconfirmed in owner draft", () => {
  const h = harness();
  const result = post(h, validQuote({deviceQuantity:""}));
  assert.equal(result.ok, true);
  const quoteDraft = h.drafts.find(item => !item.sent && /-DRAFT\]/.test(item.subject));
  assert.match(quoteDraft.body, /Device quantity: Not supplied; confirm with customer\./);
  assert.doesNotMatch(quoteDraft.body, /\b[2-9] devices?\b/i);
});

test("same request ID and same answers return duplicate without repeating Gmail work or rate counts", () => {
  const h = harness();
  const input = validQuote();
  const first = post(h, input);
  const sentAfterFirst = h.sent.length;
  const draftsAfterFirst = h.drafts.length;
  const second = post(h, input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(h.sent.length, sentAfterFirst);
  assert.equal(h.drafts.length, draftsAfterFirst);
  assert.equal(JSON.parse(h.properties.getProperty("AT_RATE_GLOBAL")).length, 1);
});

test("valid new work is globally rate limited while saved retries bypass the per-email quota", () => {
  const h = harness();
  const emailKey = "AT_RATE_EMAIL_" + h.context.digest_("customer@example.com").replace(/[^A-Za-z0-9_-]/g, "");
  h.properties.setProperty(emailKey, JSON.stringify(Array(5).fill(Date.now())));
  const limited = post(h, validQuote());
  assert.equal(limited.retryable, true);
  assert.equal(h.store.has("AT_REQUEST_12345678123442348234123456789ABC"), false);
  assert.equal(JSON.parse(h.properties.getProperty("AT_RATE_GLOBAL")).length, 1);

  const allowed = harness();
  const input = validQuote();
  const first = post(allowed, input);
  assert.equal(first.ok, true);
  const stateKey = "AT_REQUEST_12345678123442348234123456789ABC";
  const saved = JSON.parse(allowed.properties.getProperty(stateKey));
  saved.status = "incomplete";
  saved.phases.acknowledgement = "pending";
  allowed.properties.setProperty(stateKey, JSON.stringify(saved));
  const retry = post(allowed, input);
  assert.equal(retry.ok, true);
});

test("global rate limit blocks validated work at its cap and fails closed on corrupt state", () => {
  const atCap = harness();
  atCap.properties.setProperty("AT_RATE_GLOBAL", JSON.stringify(Array(60).fill(Date.now())));
  const blocked = post(atCap, validQuote());
  assert.equal(blocked.retryable, true);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(atCap.sent.length, 0);

  const corrupt = harness();
  corrupt.properties.setProperty("AT_RATE_GLOBAL", "not-json");
  const unavailable = post(corrupt, validQuote());
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.retryable, false);
  assert.equal(corrupt.sent.length, 0);
});

test("unmatched existing quote reference escalates to owner review without creating a quote draft", () => {
  const h = harness();
  const result = post(h, validQuote({existingReference:"ABCDEF1234567890"}));
  assert.equal(result.ok, true);
  assert.equal(result.needsOwnerReview, true);
  assert.equal(result.workflow, "quote-reference-owner-review");
  const ownerMessage = h.sent.find(item => item.to === "owner@example.test");
  assert.match(ownerMessage.body, /MANUAL REVIEW FLAG/);
  assert.equal(h.drafts.filter(item => !item.sent && /-DRAFT\]/.test(item.subject)).length, 0);
  assert.equal(h.sent.filter(item => item.to === "customer@example.com").length, 1);
  assert.match(h.sent.find(item => item.to === "customer@example.com").body, /receipt only/i);
});

test("ambiguous acknowledgement outcome is preserved for review and retry does not send a second acknowledgement", () => {
  const h = harness({throwAfterAcknowledgement:true});
  const input = validQuote();
  const first = post(h, input);
  assert.equal(first.ok, true);
  assert.equal(first.needsOwnerReview, true);
  assert.equal(h.sent.filter(item => item.to === "customer@example.com").length, 1);
  assert.equal(h.context.getPendingIntakeReviews().length, 1);
  const second = post(h, input);
  assert.equal(second.needsOwnerReview, true);
  assert.equal(h.sent.filter(item => item.to === "customer@example.com").length, 1);
});

test("corrupt saved request state is quarantined under a stable manual-review record", () => {
  const h = harness();
  const key = "AT_REQUEST_12345678123442348234123456789ABC";
  h.properties.setProperty(key, "{");
  const input = validQuote();
  const first = post(h, input);
  assert.equal(first.ok, true);
  assert.equal(first.needsOwnerReview, true);
  const reviewKey = "AT_REVIEW_12345678123442348234123456789ABC";
  const review = JSON.parse(h.properties.getProperty(reviewKey));
  assert.equal(review.reviewReason, "request_state_corrupt");
  assert.equal(review.status, "manual_review");
  const sentCount = h.sent.length;
  const second = post(h, input);
  assert.equal(second.needsOwnerReview, true);
  assert.equal(h.sent.length, sentCount);
});

test("recovery worker sends a pending owner alert and never blindly resends an uncertain one", () => {
  const pending = harness();
  const first = post(pending, validQuote({existingReference:"ABCDEF1234567890"}));
  assert.equal(first.needsOwnerReview, true);
  const key = "AT_REQUEST_12345678123442348234123456789ABC";
  const state = JSON.parse(pending.properties.getProperty(key));
  state.phases.manualReviewNotification = "pending";
  pending.properties.setProperty(key, JSON.stringify(state));
  const before = pending.sent.length;
  const result = pending.context.recoverPendingIntakeReviews();
  assert.equal(result.ok, true);
  assert.equal(result.reviewed, 1);
  assert.equal(result.notified, 1);
  assert.equal(pending.sent.length, before + 1);
  assert.equal(JSON.parse(pending.properties.getProperty(key)).phases.manualReviewNotification,"done");

  const uncertain = harness();
  post(uncertain, validQuote());
  const uncertainState = JSON.parse(uncertain.properties.getProperty(key));
  uncertainState.status = "manual_review";
  uncertainState.reviewContext = {requestId:uncertainState.requestId,kind:"quote",name:"Ada",email:"customer@example.com",location:"NW2",equipment:"Laptop",message:"Please help"};
  uncertainState.phases.manualReviewNotification = "attempting";
  uncertain.properties.setProperty(key, JSON.stringify(uncertainState));
  const sentBefore = uncertain.sent.length;
  const uncertainResult = uncertain.context.recoverPendingIntakeReviews();
  assert.equal(uncertainResult.uncertain, 1);
  assert.equal(uncertain.sent.length, sentBefore);
});

test("pending-review execution logs do not expose customer names or email addresses", () => {
  const h = harness();
  h.properties.setProperty("AT_REQUEST_PRIVATE", JSON.stringify({
    status:"manual_review", reference:"ABCDEF1234567890", requestId:"private-id", createdAt:1,
    reviewContext:{name:"Private Customer Name",email:"private@example.test"}
  }));
  const reviews = h.context.getPendingIntakeReviews();
  assert.equal(reviews[0].name, "Private Customer Name");
  assert.equal(reviews[0].email, "private@example.test");
  assert.equal(h.warnings.some(line => /Private Customer Name|private@example\.test/.test(line)), false);
});
