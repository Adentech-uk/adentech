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
function makeThread({id = "thread-1", kind = "quote", reference = REF, customer = CUSTOMER, replies = [], missingReference = false, extraReference = "", intakeFrom = OWNER, requestSubject = kind === "enquiry" ? "Printer setup question" : "Not supplied"} = {}) {
  const refLine = missingReference ? "" : "Reference: " + reference;
  const typeLine = kind === "quote" ? "Quote request — owner approval required" : "General enquiry — owner review";
  const firstMessageId = id === "thread-1" ? "owner-message" : "owner-message-" + id;
  const first = makeMessage({id:firstMessageId, from:intakeFrom, date:"2026-10-27T09:00:00Z", subject:"AdenTech " + kind + " " + reference,
    body:[refLine, extraReference, "Type: " + typeLine, "Name: Example Customer", "Email: " + customer, "Subject: " + requestSubject].join("\n")});
  return {getId:() => id, getFirstMessageSubject:() => "AdenTech " + kind + " " + reference, getMessages:() => [first].concat(replies), getPermalink:() => "https://mail.google.test/thread/" + id};
}
function harness({threads = [], owner = OWNER, spreadsheetId = "sheet-id", interval = "15", monitorStartedAt = 1793093400000, failWriteAt = -1, failSend = false, sendThenThrow = false, existingRows = []} = {}) {
  const entries = [["ADENTECH_TICKET_SPREADSHEET_ID", spreadsheetId], ["ADENTECH_TICKET_OWNER_EMAIL", owner], ["ADENTECH_TICKET_MONITOR_INTERVAL_MINUTES", interval]];
  if (monitorStartedAt !== null) entries.push(["AT_TICKET_MONITOR_STARTED_AT", String(monitorStartedAt)]);
  const properties = new Map(entries);
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
  const triggers = [];
  const lock = {tryLock:() => true, releaseLock:() => {}};
  const context = {
    console:{error:() => {}},
    PropertiesService:{getScriptProperties:() => ({getProperty:key => properties.has(key) ? properties.get(key) : null, setProperty:(k,v) => properties.set(k,String(v)), deleteProperty:k => properties.delete(k)})},
    LockService:{getScriptLock:() => lock},
    Session:{getEffectiveUser:() => ({getEmail:() => OWNER})},
    SpreadsheetApp:{openById:id => {assert.equal(id,spreadsheetId); return {getSheetByName:name => sheets.get(name) || null, insertSheet:name => sheet(name)};}},
    GmailApp:{search:(query, start = 0, max = 100) => {
      if (query.indexOf("in:sent") === 0) {const marker = query.match(/subject:"([^"]+)"/)[1]; return sent.filter(x => x.subject.includes(marker)).map(x => ({getId:() => x.id})).slice(start, start + max);}
      if (query.indexOf("label:") === 0) return threads.slice(start, start + max);
      return [];
    }, createDraft:(to, subject, body) => ({send:() => {
      if (failSend && !sendThenThrow) throw new Error("send failed before delivery");
      sent.push({to,subject,body,id:"sent-" + sent.length});
      if (sendThenThrow) throw new Error("response lost after delivery");
      return {};
    }})},
    Utilities:{DigestAlgorithm:{SHA_256:"SHA_256"},Charset:{UTF_8:"UTF_8"},computeDigest:(_a,value) => require("node:crypto").createHash("sha256").update(value).digest(),base64EncodeWebSafe:bytes => Buffer.from(bytes).toString("base64url")},
    ScriptApp:{getProjectTriggers:() => triggers.slice(),newTrigger:handler => ({timeBased:() => ({everyMinutes:minutes => ({create:() => {const trigger={handler,minutes,getHandlerFunction:() => handler}; triggers.push(trigger); return trigger;}})})})},
    Date:class MockDate extends Date {static now() {return Date.parse("2026-10-27T09:30:00Z");}}, Array, Set, String, Number, Object, JSON
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {context, properties, sheets, sent, drafts, triggers, sheet, getWrites:() => writes};
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
  assert.equal(rows[2][5], "Printer setup question");
  assert.equal(rows[1][11], "thread-1");
  assert.equal(rows[1][12], "");
  assert.equal(rows[1][14], "owner-message");
});

test("ticket label pagination processes every thread across multiple pages", () => {
  const threads = Array.from({length:205}, (_, index) => {
    const reference = index.toString(16).toUpperCase().padStart(16, "0");
    return makeThread({id:"page-thread-" + index, reference});
  });
  const h = harness({threads});
  const result = h.context.processAdenTechTickets();
  assert.equal(result.threads, 205);
  assert.equal(result.created, 205);
  assert.equal(h.sheets.get("Tickets").rows.length, 206);
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

test("first scan imports historical replies without alert, then alerts on post-start replies", () => {
  const replies = [makeMessage({id:"historical", from:CUSTOMER, date:"2026-10-27T09:15:00Z"})];
  const thread = makeThread({replies});
  const h = harness({threads:[thread], monitorStartedAt:null});
  h.context.processAdenTechTickets();
  let row = h.sheets.get("Tickets").rows[1];
  assert.equal(h.sent.length, 0);
  assert.equal(row[6], "Customer Responded");
  assert.equal(row[12], "historical");
  assert.match(row[9], /historical customer reply/i);
  replies.push(makeMessage({id:"after-start", from:CUSTOMER, date:"2026-10-27T10:00:00Z"}));
  h.context.processAdenTechTickets();
  row = h.sheets.get("Tickets").rows[1];
  assert.equal(h.sent.length, 1);
  assert.equal(row[12], "after-start");
});

test("customer-supplied formula text is neutralized and control characters removed", () => {
  const thread = makeThread();
  const getMessages = thread.getMessages;
  thread.getMessages = () => {
    const messages = getMessages();
    const original = messages[0];
    messages[0] = Object.assign({}, original, {getPlainBody:() => original.getPlainBody().replace("Name: Example Customer", "Name: =HYPERLINK(\"https://bad.test\")\u0001")});
    return messages;
  };
  thread.getFirstMessageSubject = () => "@SUM(1,1) AdenTech quote";
  const h = harness({threads:[thread]});
  h.context.processAdenTechTickets();
  const row = h.sheets.get("Tickets").rows[1];
  assert.match(row[2], /^'=HYPERLINK/);
  assert.match(row[5], /^'@SUM/);
  assert.doesNotMatch(row[2], /\u0001/);
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

test("stored customer-email mismatch is queued and the reply is not alerted", () => {
  const header = ["Reference", "Received Date", "Customer Name", "Customer Email", "Request Type", "Subject", "Status", "Last Activity", "Latest Customer Reply Date", "Next Action", "Gmail Thread Link", "Gmail Thread ID", "Last Processed Message ID", "Owner Notes", "Gmail Anchor Message ID"];
  const row = [REF, new Date(), "Example Customer", "other@example.test", "Quote", "AdenTech quote", "Open", new Date(), "", "Owner review", "", "thread-1", "", "", "owner-message"];
  const thread = makeThread({replies:[makeMessage({id:"reply", from:CUSTOMER, date:"2026-10-27T10:00:00Z"})]});
  const h = harness({threads:[thread], existingRows:[header, row]});
  h.context.processAdenTechTickets();
  assert.equal(h.sent.length, 0);
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(item => item[1] === "customer_email_mismatch"));
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
  const header = ["Reference", "Received Date", "Customer Name", "Customer Email", "Request Type", "Subject", "Status", "Last Activity", "Latest Customer Reply Date", "Next Action", "Gmail Thread Link", "Gmail Thread ID", "Last Processed Message ID", "Owner Notes", "Gmail Anchor Message ID"];
  const row = [REF, new Date(), "Example Customer", CUSTOMER, "Quote", "AdenTech quote", "Open", new Date(), "", "Owner review", "", "thread-1", "", "", "owner-message"];
  const h = harness({threads:[makeThread()], existingRows:[header, row, row.slice()]});
  h.context.processAdenTechTickets();
  assert.equal(h.sheets.get("Tickets").rows.length, 3);
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(item => item[1] === "duplicate_sheet_reference"));
});

test("two Gmail threads with the same reference create one ticket and queue the second for review", () => {
  const h = harness({threads:[makeThread({id:"first-thread"}), makeThread({id:"second-thread"})]});
  h.context.processAdenTechTickets();
  assert.equal(h.sheets.get("Tickets").rows.length, 2);
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(row => row[1] === "reference_thread_mismatch"));
});

test("thread ID changes are matched using the stable first-message anchor", () => {
  const replies = [];
  let threadId = "thread-before";
  const thread = makeThread({replies});
  thread.getId = () => threadId;
  const h = harness({threads:[thread]});
  h.context.processAdenTechTickets();
  threadId = "thread-after";
  replies.push(makeMessage({id:"new-reply", from:CUSTOMER, date:"2026-10-27T10:00:00Z"}));
  h.context.processAdenTechTickets();
  assert.equal(h.sheets.get("Tickets").rows[1][11], "thread-after");
  assert.equal(h.sheets.get("Tickets").rows[1][14], "owner-message");
  assert.equal(h.sent.length, 1);
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
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.setupAdenTechTicketMonitorTrigger())), {ok:true, alreadyInstalled:true, count:1, intervalMinutes:15});
  assert.equal(h.triggers.length, 1);
  h.properties.set("ADENTECH_TICKET_MONITOR_INTERVAL_MINUTES", "7");
  assert.throws(() => h.context.setupAdenTechTicketMonitorTrigger(), /must be 1, 5, 10, 15, or 30/);
});

test("missing configuration and invalid monitor start fail closed", () => {
  const missing = harness({spreadsheetId:""});
  assert.throws(() => missing.context.processAdenTechTickets(), /ADENTECH_TICKET_SPREADSHEET_ID/);
  const invalidStart = harness({monitorStartedAt:"not-a-time"});
  assert.throws(() => invalidStart.context.processAdenTechTickets(), /start-time state is invalid/);
  const invalidOwner = harness({owner:"not-an-email"});
  assert.throws(() => invalidOwner.context.processAdenTechTickets(), /ADENTECH_TICKET_OWNER_EMAIL/);
  const wrongSheetHeader = harness({existingRows:[["Unrelated data"]]});
  assert.throws(() => wrongSheetHeader.context.processAdenTechTickets(), /unexpected columns/);
});

test("unrecognized owner notification source is queued instead of creating a ticket", () => {
  const h = harness({threads:[makeThread({intakeFrom:"spoof@example.test"})]});
  h.context.processAdenTechTickets();
  assert.equal(h.sheets.get("Tickets").rows.length, 1);
  assert.ok(h.sheets.get("Ticket Reviews").rows.some(row => row[1] === "unverified_intake_thread"));
});
