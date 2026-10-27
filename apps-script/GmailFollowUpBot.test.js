const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(__dirname + "/GmailFollowUpBot.gs", "utf8");
const REFERENCE = "ABCDEF1234567890";
const OWNER = "owner@example.test";
const CUSTOMER = "jane@example.test";

function message({subject, body, from, to, date}) {
  return {
    getSubject:() => subject,
    getPlainBody:() => body,
    getFrom:() => from,
    getTo:() => to || "",
    getCc:() => "",
    getBcc:() => "",
    getDate:() => new Date(date)
  };
}

function quoteThread(reply = null, subject = "[AT-12345678-1234-4234-8234-123456789abc-OWNER] AdenTech quote request " + REFERENCE) {
  const first = message({subject, body:[
    "Reference: " + REFERENCE,
    "Type: Quote request — owner approval required",
    "Name: Jane Example",
    "Email: " + CUSTOMER,
    "Town / postcode: NW2",
    "Equipment: Laptop and monitor",
    "Device quantity: Not supplied",
    "Preferred timing: Weekend",
    "Message:",
    "Please set up my laptop and monitor and test them."
  ].join("\n"), from:OWNER, to:OWNER, date:"2026-01-01T10:00:00Z"});
  const messages = reply ? [first, reply] : [first];
  return {
    getId:() => "thread-" + subject,
    getFirstMessageSubject:() => subject,
    getMessages:() => messages
  };
}

function harness({newQuoteThreads = [], replyThreads = [], labelFailure = null} = {}) {
  const drafts = [];
  const labels = new Map();
  const searches = [];
  const triggers = [];
  let deletedTriggers = 0;
  let failLabel = labelFailure;
  const lockStats = {acquired:0, released:0};
  const context = {
    Logger:{log:() => {}},
    Session:{getEffectiveUser:() => ({getEmail:() => OWNER})},
    LockService:{getScriptLock:() => ({tryLock:() => {lockStats.acquired++; return true;}, releaseLock:() => {lockStats.released++;}})},
    ScriptApp:{getProjectTriggers:() => triggers.slice(), deleteTrigger:() => {deletedTriggers++;}, newTrigger:handler => ({timeBased:() => ({everyMinutes:minutes => ({create:() => {const trigger={handler,minutes,getHandlerFunction:() => handler};triggers.push(trigger);return trigger;}})})})},
    GmailApp:{
      search:(query) => {
        searches.push(query);
        if (query.indexOf("in:drafts") === 0) {
          const match = query.match(/subject:"([^"]+)"/);
          const marker = match ? match[1] : "";
          return drafts.filter(d => d.subject.indexOf(marker) >= 0).map(d => ({
            getId:() => d.threadId,
            getMessages:() => [message({subject:d.subject,body:d.body,from:OWNER,to:d.to,date:"2026-01-02T10:00:00Z"})]
          }));
        }
        if (query.indexOf("in:inbox") >= 0) return replyThreads;
        if (query.indexOf("label:") === 0) return newQuoteThreads.filter(thread => {
          const done = labels.get("adentech-follow-up-drafted");
          return !done || !done.threads.some(t => t.getId() === thread.getId());
        });
        return [];
      },
      getUserLabelByName:name => labels.get(name) || null,
      createLabel:name => {
        const label={name:name,threads:[],addToThread(thread){
          if (failLabel === name) { failLabel = null; throw new Error("label write interrupted"); }
          this.threads.push(thread);
        }};
        labels.set(name,label);
        return label;
      },
      createDraft:(to,subject,body,options) => {
        drafts.push({to,subject,body,options,threadId:"draft-"+drafts.length});
        return {};
      },
      sendEmail:() => {throw new Error("The follow-up bot must never send email.");}
    }
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return {context,drafts,labels,searches,lockStats,triggers,getDeletedTriggers:() => deletedTriggers};
}

test("new AdenTech quote gets one follow-up question draft and unknown quantities stay questions", () => {
  const thread=quoteThread();
  const h=harness({newQuoteThreads:[thread]});
  h.context.processAdenTechInbox();
  assert.equal(h.drafts.length,1);
  assert.equal(h.drafts[0].to,CUSTOMER);
  assert.match(h.drafts[0].subject,/AT-FOLLOWUP-ABCDEF1234567890/);
  assert.match(h.drafts[0].subject,/AdenTech quote request ABCDEF1234567890/);
  assert.match(h.drafts[0].body,/How many laptops\/computers and how many monitors/);
  assert.match(h.drafts[0].body,/not a confirmed booking or quote/i);
  assert.equal(h.lockStats.acquired,1);
  assert.equal(h.lockStats.released,1);
});

test("interruption after draft creation is recovered by marker without a duplicate", () => {
  const thread=quoteThread();
  const h=harness({newQuoteThreads:[thread],labelFailure:"adentech-follow-up-drafted"});
  h.context.draftFollowUpQuestionsForNewQuotes_();
  assert.equal(h.drafts.length,1);
  h.context.draftFollowUpQuestionsForNewQuotes_();
  assert.equal(h.drafts.length,1);
  assert.ok(h.labels.get("adentech-follow-up-drafted").threads.length > 0);
});

test("unrelated order and non-quote AdenTech threads cannot create drafts", () => {
  const arbitrary=quoteThread(null,"Contoso order ABCDEF1234567890");
  const adenTechEnquiry=quoteThread(null,"AdenTech enquiry ABCDEF1234567890");
  const h=harness({newQuoteThreads:[arbitrary,adenTechEnquiry],replyThreads:[arbitrary,adenTechEnquiry]});
  h.context.processAdenTechInbox();
  assert.equal(h.drafts.length,0);
  assert.equal(h.searches.some(query => query.indexOf("in:inbox") >= 0 && query.indexOf("label:") === 0),true);
});

test("quote-like thread from a non-owner sender cannot qualify for a quote draft", () => {
  const spoof=quoteThread(message({subject:"Re: AdenTech quote request " + REFERENCE,body:"Please send a price",from:CUSTOMER,date:"2026-01-02T10:00:00Z"}));
  const messages=spoof.getMessages();
  const first=messages[0];
  spoof.getMessages=() => [message({subject:first.getSubject(),body:first.getPlainBody(),from:"attacker@example.test",date:"2026-01-01T10:00:00Z"}),messages[1]];
  const h=harness({replyThreads:[spoof]});
  h.context.draftQuoteAfterCustomerReply_();
  assert.equal(h.drafts.length,0);
});

test("quote reply needs the identified customer as sender", () => {
  const wrongSender=message({subject:"Re: AdenTech quote request " + REFERENCE,body:"Another email address",from:"intruder@example.test",date:"2026-01-02T10:00:00Z"});
  const h=harness({replyThreads:[quoteThread(wrongSender)]});
  h.context.draftQuoteAfterCustomerReply_();
  assert.equal(h.drafts.length,0);
});

test("quote reply with no intake customer email cannot create a draft to an arbitrary sender", () => {
  const reply=message({subject:"Re: AdenTech quote request " + REFERENCE,body:"Please send a price",from:CUSTOMER,date:"2026-01-02T10:00:00Z"});
  const thread=quoteThread(reply);
  const getMessages=thread.getMessages;
  thread.getMessages=() => {
    const messages=getMessages();
    const original=messages[0];
    messages[0]=message({subject:original.getSubject(),body:original.getPlainBody().replace("Email: " + CUSTOMER,""),from:OWNER,date:"2026-01-01T10:00:00Z"});
    return messages;
  };
  const h=harness({replyThreads:[thread]});
  h.context.draftQuoteAfterCustomerReply_();
  assert.equal(h.drafts.length,0);
});

test("setup preserves an existing trigger and does not install a duplicate", () => {
  const h=harness();
  h.context.setupAdenTechAutomation();
  h.context.setupAdenTechAutomation();
  assert.equal(h.triggers.length,1);
  assert.equal(h.getDeletedTriggers(),0);
});

test("verified quote conversation gets a marked owner-review draft only once", () => {
  const reply=message({subject:"Re: AdenTech quote request " + REFERENCE,body:"There are two monitors and setup should take about two hours.",from:CUSTOMER,date:"2026-01-02T10:00:00Z"});
  const thread=quoteThread(reply);
  const h=harness({replyThreads:[thread]});
  h.context.draftQuoteAfterCustomerReply_();
  h.context.draftQuoteAfterCustomerReply_();
  assert.equal(h.drafts.length,1);
  assert.match(h.drafts[0].subject,/AT-QUOTE-ABCDEF1234567890/);
  assert.match(h.drafts[0].body,/DRAFT ONLY — OWNER MUST VERIFY/);
  assert.match(h.drafts[0].body,/Device quantity: Not supplied/);
  assert.match(h.drafts[0].body,/£50\.00 for the first hour plus £20\.00 per additional billable hour/);
  assert.match(h.drafts[0].body,/Travel: NOT CALCULATED/);
  assert.equal(h.labels.get("adentech-quote-drafted").threads.length,2);
});

test("internal labour estimator follows first-hour minimum and additional-hour rule", () => {
  const h=harness();
  assert.equal(h.context.labourEstimateForHours_(1),50);
  assert.equal(h.context.labourEstimateForHours_(2),70);
  assert.equal(h.context.labourEstimateForHours_(2.1),90);
  assert.equal(h.context.labourEstimateForHours_(0),null);
  assert.equal(h.context.labourEstimateForHours_("unknown"),null);
});

test("quote reference extraction rejects unrelated order numbers", () => {
  const h=harness();
  assert.equal(h.context.findReference_("Contoso order ABCDEF1234567890"),"");
  assert.equal(h.context.findReference_("AdenTech quote request ABCDEF1234567890"),REFERENCE);
});
