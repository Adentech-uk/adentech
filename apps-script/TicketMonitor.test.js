const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(__dirname + "/TicketMonitor.gs", "utf8");
const OWNER = "owner@example.test";
const CUSTOMER = "customer@example.test";
const REF = "ABCDEF1234567890";

function makeMessage({id, from, date, subject = "Re: AdenTech quote " + REF, body = "Reply"}) {
  return {getId:() => id, getFrom:() => from, getDate:() => new Date(date), getSubject:() => subject, getPlainBody:() => body};
}
function makeThread({id = "thread-1", kind = "quote", reference = REF, customer = CUSTOMER, replies = [], missingReference = false, extraReference = ""} = {}) {
  const refLine = missingReference ? "" : "Reference: " + reference;
  const typeLine = kind === "quote" ? "Quote request — owner approval required" : "General enquiry — owner review";
  const first = makeMessage({id:"owner-message", from:OWNER, date:"2026-10-27T09:00:00Z", subject:"AdenTech " + kind + " " + reference,
    body:[refLine, extraReference, "Type: " + typeLine, "Name: Example Customer", "Email: " + customer].join("\n")});
  return {getId:() => id, getFirstMessageSubject:() => "AdenTech " + kind + " " + reference, getMessages:() => [first].concat(replies), getPermalink:() => "https://mail.google.test/thread/" + id};
}
function harness({threads = [], owner = OWNER, failWriteAt = -1, failSend = false, sendThenThrow = false, existingRows = []} = {}) {
  const properties = new Map([
    ["ADENTECH_TICKET_SPREADSHEET_ID", "sheet-id"],
    ["ADENTECH_TICKET_OWNER_EMAIL", owner],
    ["ADENTECH_TICKET_MONITOR_INTERVAL_MINUTES", "15"]
  ]);
  const sheets = new Map();
  let writes = 0;
  function sheet(name) {
    if (!sheets.has(name)) {
      const rows = name === "Tickets" ? existingRows.slice() : [];
      sheets.set(name, {rows, backgrounds:[], getLastRow() {return this.rows.length;}, getRange(r,c,nr,nc) {
        return {getValues:() => Array.from({length:nr}, (_,ri) => Array.from({length:nc}, (_,ci) => ((this.rows[r + ri - 1] || [])[c + ci - 1]))),
          setValues:values => {writes++; if (writes === failWriteAt) throw new Error("sheet write failed"); values.forEach((v, i) => {this.rows[r + i - 1] = v.slice();});},
          setBackground:value => this.backgrounds.push({row:r, value})};
      }});
    }
    return sheets.get(name);
  }
  const sent = [];
  const drafts = [];
  const lock = {tryLock:() => true, releaseLock:() => {}};
  const context = {
    console:{error:() => {}},
    PropertiesService:{getScriptProperties:() => ({getProperty:key => properties.has(key) ? properties.get(key) : null, setProperty:(k,v) => properties.set(k,String(v)), deleteProperty:k => properties.delete(k)})},
    LockService:{getScriptLock:() => lock},
    Session:{getEffectiveUser:() => ({getEmail:() => OWNER})},
    SpreadsheetApp:{openById:id => {assert.equal(id,"sheet-id"); return {getSheetByName:name => sheets.get(name) || null, insertSheet:name => sheet(name)};}},
    GmailApp:{search:(query) => {
      if (query.indexOf("in:sent") === 0) {const marker = query.match(/subject:"([^"]+)"/)[1]; return sent.filter(x => x.subject.includes(marker)).map(x => ({getId:() => x.id}));}
      if (query.indexOf("label:") === 0) return threads;
      return [];
    }, createDraft:(to, subject, body) => ({send:() => {
      if (failSend && !sendThenThrow) throw new Error("send failed before delivery");
      sent.push({to,subject,body,id:"sent-" + sent.length});
      if (sendThenThrow) throw new Error("response lost after delivery");
      return {};
    }})},
    Utilities:{DigestAlgorithm:{SHA_256:"SHA_256"},Charset:{UTF_8:"UTF_8"},computeDigest:(_a,value) => require("node:crypto").createHash("sha256").update(value).digest(),base64EncodeWebSafe:bytes => Buffer.from(bytes).toString("base64url")},
    ScriptApp:{getProjectTriggers:() => [],newTrigger:handler => ({timeBased:() => ({everyMinutes:minutes => ({create:() => ({handler,minutes})})})})},
    Date, Array, Set, String, Number, Object, JSON
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {context, properties, sheets, sent, drafts, sheet, getWrites:() => writes};
}

test("new quote and enquiry requests create one correctly typed ticket row", () => {
  const h = harness({threads:[makeThread(), makeThread({id:"enquiry-1", kind:"enquiry", reference:"1234567890ABCDEF"})]});
  const result = h.context.processAdenTechTickets();
  assert.equal(result.created, 2);
  const rows = h.sheets.get("Tickets").rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], REF);
  assert.equal(rows[1][4], "Quote");
  assert.equal(rows[2][4], "Enquiry");
  assert.equal(rows[1][11], "thread-1");
  assert.equal(rows[1][12], "");
});

test("known customer reply updates existing row, highlights it and sends one owner alert", () => {
  const reply = makeMessage({id:"customer-msg-1", from:CUSTOMER, date:"2026-10-27T10:00:00Z", subject:"Re: quote", body:"Thanks"});
  const thread = makeThread({replies:[reply]});
  const h = harness({threads:[thread]});
  h.context.processAdenTechTickets();
  h.context.processAdenTechTickets();
  const rows = h.sheets.get("Tickets").rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[1][6], "Customer Responded");
  assert.equal(rows[1][12], "customer-msg-1");
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].to, OWNER);
  assert.match(h.sent[0].subject, /AT-TICKET-/);
  assert.equal(h.sheets.get("Tickets").backgrounds.length, 1);
});

test("verified enquiry replies update the enquiry ticket and alert only the owner", () => {
  const reply = makeMessage({id:"enquiry-reply", from:CUSTOMER, date:"2026-10-27T11:00:00Z"});
  const h = harness({threads:[makeThread({id:"enquiry-thread", kind:"enquiry", reference:"1234567890ABCDEF", replies:[reply]})]});
  h.context.processAdenTechTickets();
  const row = h.sheets.get("Tickets").rows[1];
  assert.equal(row[4], "Enquiry");
  assert.equal(row[6], "Customer Responded");
  assert.equal(row[12], "enquiry-reply");
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].to, OWNER);
});

test("owner messages are ignored and unrelated senders are queued once for owner review", () => {
  const thread = makeThread({replies:[makeMessage({id:"owner-reply", from:OWNER, date:"2026-10-27T09:30:00Z"}), makeMessage({id:"stranger", from:"stranger@example.test", date:"2026-10-27T10:00:00Z"})]});
  const h = harness({threads:[thread]});
  h.context.processAdenTechTickets();
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 0);
  const reviewRows = h.sheets.get("Ticket Reviews").rows;
  assert.equal(reviewRows.length, 2);
  assert.equal(reviewRows[1][1], "unverified_sender");
});

test("missing or ambiguous references go to a deduplicated review queue", () => {
  const h = harness({threads:[makeThread({id:"missing", missingReference:true}), makeThread({id:"ambiguous", extraReference:"Reference: 1234567890ABCDEF"})]});
  h.context.processAdenTechTickets();
  h.context.processAdenTechTickets();
  assert.equal(h.sheets.get("Tickets").rows.length, 1);
  assert.equal(h.sheets.get("Ticket Reviews").rows.length, 3);
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(row => row[1] === "missing_reference"));
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(row => row[1] === "missing_reference" && row[4] === "ambiguous"));
});

test("multiple sheet rows for one reference are flagged without choosing or duplicating", () => {
  const header = ["Reference", "Received Date", "Customer Name", "Customer Email", "Request Type", "Subject", "Status", "Last Activity", "Latest Customer Reply Date", "Next Action", "Gmail Thread Link", "Gmail Thread ID", "Last Processed Message ID", "Owner Notes"];
  const row = [REF, new Date(), "Example Customer", CUSTOMER, "Quote", "AdenTech quote", "Open", new Date(), "", "Owner review", "", "thread-1", "", ""];
  const h = harness({threads:[makeThread()], existingRows:[header, row, row.slice()]});
  h.context.processAdenTechTickets();
  assert.equal(h.sheets.get("Tickets").rows.length, 3);
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(item => item[1] === "duplicate_sheet_reference"));
});

test("duplicate polling and a persisted sent marker do not repeat the alert", () => {
  const reply = makeMessage({id:"customer-msg", from:CUSTOMER, date:"2026-10-27T10:00:00Z"});
  const thread = makeThread({replies:[reply]});
  const h = harness({threads:[thread]});
  h.context.processAdenTechTickets();
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sheets.get("Tickets").rows.length, 2);
});

test("an email send failure is escalated and never blindly retried", () => {
  const thread = makeThread({replies:[makeMessage({id:"customer-msg", from:CUSTOMER, date:"2026-10-27T10:00:00Z"})]});
  const h = harness({threads:[thread], failSend:true});
  h.context.processAdenTechTickets();
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 0);
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(row => row[1] === "notification_uncertain"));
});

test("send response lost after delivery is reconciled from sent mail without duplicate alert", () => {
  const thread = makeThread({replies:[makeMessage({id:"customer-msg", from:CUSTOMER, date:"2026-10-27T10:00:00Z"})]});
  const h = harness({threads:[thread], sendThenThrow:true});
  h.context.processAdenTechTickets();
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sheets.get("Tickets").rows[1][12], "customer-msg");
});

test("failed ticket row writes do not send owner notifications", () => {
  const thread = makeThread({replies:[makeMessage({id:"customer-msg", from:CUSTOMER, date:"2026-10-27T10:00:00Z"})]});
  const h = harness({threads:[thread], failWriteAt:3});
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 0);
  assert.equal(h.sheets.get("Tickets").rows.length, 1);
});

test("a failed post-alert sheet update recovers from the sent marker without a second alert", () => {
  const thread = makeThread({replies:[makeMessage({id:"customer-msg", from:CUSTOMER, date:"2026-10-27T10:00:00Z"})]});
  const h = harness({threads:[thread], failWriteAt:5});
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sheets.get("Tickets").rows[1][12], "");
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sheets.get("Tickets").rows[1][12], "customer-msg");
});

test("trigger setup validates interval and uses the configured schedule", () => {
  const h = harness();
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.setupAdenTechTicketMonitorTrigger())), {ok:true, installed:true, intervalMinutes:15});
  h.properties.set("ADENTECH_TICKET_MONITOR_INTERVAL_MINUTES", "7");
  assert.throws(() => h.context.setupAdenTechTicketMonitorTrigger(), /must be 1, 5, 10, 15, or 30/);
});
