/**
 * AdenTech Gmail-to-Sheets ticket monitor.
 *
 * This is an opt-in worker for the same Apps Script project as Code.gs. It
 * reads only the existing owner-notification labels and never replies to a
 * customer. Configure Script Properties before running it (see
 * TICKET_MONITOR_SETUP.md). Do not run setup/install functions against a live
 * account without owner approval.
 */
const AT_TICKET = {
  spreadsheetProperty: "ADENTECH_TICKET_SPREADSHEET_ID",
  ownerProperty: "ADENTECH_TICKET_OWNER_EMAIL",
  intervalProperty: "ADENTECH_TICKET_MONITOR_INTERVAL_MINUTES",
  startedAtProperty: "AT_TICKET_MONITOR_STARTED_AT",
  alertPrefix: "AT_TICKET_ALERT_",
  ticketsSheet: "Tickets",
  reviewsSheet: "Ticket Reviews",
  handler: "processAdenTechTickets",
  headers: ["Reference", "Received Date", "Customer Name", "Customer Email", "Request Type", "Subject", "Status", "Last Activity", "Latest Customer Reply Date", "Next Action", "Gmail Thread Link", "Gmail Thread ID", "Last Processed Message ID", "Owner Notes", "Gmail Anchor Message ID"],
  reviewHeaders: ["Created At", "Reason", "Reference", "Gmail Thread Link", "Gmail Thread ID", "Status", "Details"]
};

/** Processes existing AdenTech intake notification threads. Safe to rerun. */
function processAdenTechTickets() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return {ok:false, reason:"busy"};
  try {
    const config = ticketConfig_();
    const monitorStartedAt = ensureTicketMonitorStartedAt_();
    const book = SpreadsheetApp.openById(config.spreadsheetId);
    const tickets = ensureTicketSheet_(book, AT_TICKET.ticketsSheet, AT_TICKET.headers);
    const reviews = ensureTicketSheet_(book, AT_TICKET.reviewsSheet, AT_TICKET.reviewHeaders);
    const threads = ticketThreads_();
    const results = {ok:true, threads:threads.length, created:0, updated:0, reviews:0, alerts:0, failures:0};
    threads.forEach(function(thread) {
      try {
        const outcome = processTicketThread_(thread, tickets, reviews, config, monitorStartedAt);
        if (outcome === "created") results.created++;
        else if (outcome === "updated") results.updated++;
        else if (outcome === "review") results.reviews++;
        else if (outcome === "alerted") results.alerts++;
      } catch (error) {
        // A thread-level failure must not abort other tickets. The next poll
        // retries it. Avoid putting message/thread content into execution logs.
        results.failures++;
      }
    });
    if (results.failures) console.error("AdenTech ticket monitor had " + results.failures + " thread failures; check execution history. The next poll will retry.");
    return results;
  } finally {
    lock.releaseLock();
  }
}

/** Installs one configurable polling trigger. Owner must run this deliberately. */
function setupAdenTechTicketMonitorTrigger() {
  const config = ticketConfig_();
  ensureTicketMonitorStartedAt_();
  const existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === AT_TICKET.handler;
  });
  if (existing.length) return {ok:true, alreadyInstalled:true, count:existing.length, intervalMinutes:config.intervalMinutes};
  ScriptApp.newTrigger(AT_TICKET.handler).timeBased().everyMinutes(config.intervalMinutes).create();
  return {ok:true, installed:true, intervalMinutes:config.intervalMinutes};
}

function ensureTicketMonitorStartedAt_() {
  const properties = PropertiesService.getScriptProperties();
  const saved = properties.getProperty(AT_TICKET.startedAtProperty);
  if (saved === null) {
    const startedAt = Date.now();
    properties.setProperty(AT_TICKET.startedAtProperty, String(startedAt));
    return startedAt;
  }
  const startedAt = Number(saved);
  if (!isFinite(startedAt) || startedAt <= 0) throw new Error("Monitor start-time state is invalid; owner repair is required.");
  return startedAt;
}

function ticketConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = String(properties.getProperty(AT_TICKET.spreadsheetProperty) || "").trim();
  const ownerEmail = String(properties.getProperty(AT_TICKET.ownerProperty) || "").trim();
  const rawInterval = String(properties.getProperty(AT_TICKET.intervalProperty) || "15").trim();
  const intervalMinutes = Number(rawInterval);
  if (!spreadsheetId) throw new Error("Set Script Property " + AT_TICKET.spreadsheetProperty + " to the owner-selected spreadsheet ID.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error("Set Script Property " + AT_TICKET.ownerProperty + " to the owner notification email.");
  if ([1, 5, 10, 15, 30].indexOf(intervalMinutes) < 0) throw new Error("Monitor interval must be 1, 5, 10, 15, or 30 minutes.");
  return {spreadsheetId:spreadsheetId, ownerEmail:ownerEmail.toLowerCase(), intervalMinutes:intervalMinutes};
}

function ticketThreads_() {
  const queries = ['label:"AdenTech/Quotes"', 'label:"AdenTech/Enquiries"'];
  const unique = {};
  queries.forEach(function(query) {
    for (let start = 0; ; start += 100) {
      const page = GmailApp.search(query, start, 100);
      page.forEach(function(thread) { unique[String(thread.getId())] = thread; });
      if (page.length < 100) break;
    }
  });
  return Object.keys(unique).map(function(id) { return unique[id]; });
}

function processTicketThread_(thread, sheet, reviewSheet, config, monitorStartedAt) {
  const messages = thread.getMessages() || [];
  if (!messages.length) return "ignored";
  const first = messages[0];
  const firstBody = String(first.getPlainBody() || "");
  const subject = String(thread.getFirstMessageSubject() || first.getSubject() || "").slice(0, 250);
  const reference = ticketReference_(subject + "\n" + firstBody);
  if (!reference) {
    appendTicketReview_(reviewSheet, "missing_reference", "", thread, "Labeled AdenTech notification has no recognized reference.");
    return "review";
  }
  const effectiveOwner = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
  const intakeSender = ticketEmail_(first.getFrom()).toLowerCase();
  if (!/adentech/i.test(subject) || !intakeSender ||
      [config.ownerEmail, effectiveOwner].indexOf(intakeSender) < 0) {
    appendTicketReview_(reviewSheet, "unverified_intake_thread", reference, thread, "Labeled thread is not a recognized owner-generated AdenTech intake notification.");
    return "review";
  }
  const rowMatches = findTicketRows_(sheet, reference);
  if (rowMatches.length > 1) {
    appendTicketReview_(reviewSheet, "duplicate_sheet_reference", reference, thread, "More than one Tickets row has this reference; no row was changed.");
    return "review";
  }

  const details = parseTicketDetails_(firstBody);
  let row = rowMatches.length ? rowMatches[0] : null;
  let result = "ignored";
  if (!row) {
    const values = [reference, first.getDate(), ticketSheetText_(details.name, 160), ticketSheetText_(details.email, 254), details.type, ticketSheetText_(details.subject || subject, 250), "Open", first.getDate(), "", "Owner review", ticketSheetText_(thread.getPermalink ? thread.getPermalink() : "", 1000), String(thread.getId()), "", "", String(first.getId() || "")];
    const targetRow = sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 1, 1, AT_TICKET.headers.length).setValues([values]);
    row = {number:targetRow, values:values};
    result = "created";
  } else {
    const anchorId = String(first.getId() || "");
    if (row.values[14] && String(row.values[14]) !== anchorId) {
      appendTicketReview_(reviewSheet, "reference_thread_mismatch", reference, thread, "Reference already belongs to a different Gmail thread; no reply was processed.");
      return "review";
    }
    // Legacy rows without the stable first-message anchor may be adopted only
    // when their original thread ID still matches; otherwise refuse to guess.
    if (!row.values[14] && String(row.values[11]) !== String(thread.getId())) {
      appendTicketReview_(reviewSheet, "reference_thread_mismatch", reference, thread, "Existing ticket has no stable message anchor and its thread ID differs; no reply was processed.");
      return "review";
    }
    if (!row.values[14]) row.values[14] = anchorId;
    // GmailThread IDs may change as messages are added. The first-message ID
    // is the stable conversation anchor; refresh the current thread permalink.
    row.values[11] = String(thread.getId());
    row.values[10] = ticketSheetText_(thread.getPermalink ? thread.getPermalink() : "", 1000);
    writeTicketRow_(sheet, row);
  }

  const knownEmail = String(row.values[3] || details.email || "").toLowerCase();
  if (row.values[3] && details.email && String(row.values[3]).toLowerCase() !== details.email.toLowerCase()) {
    appendTicketReview_(reviewSheet, "customer_email_mismatch", reference, thread, "Customer email in sheet differs from the intake notification.");
    return "review";
  }
  const lastId = String(row.values[12] || "");
  const ownerEmails = [config.ownerEmail, String(Session.getEffectiveUser().getEmail() || "").toLowerCase()];
  const cursorIndex = lastId ? messages.findIndex(function(candidate) { return String(candidate.getId() || "") === lastId; }) : -1;
  if (lastId && cursorIndex < 0) {
    appendTicketReview_(reviewSheet, "processed_message_missing", reference, thread, "Saved message cursor is absent from this thread; reply order is uncertain.");
    return "review";
  }
  const isBaseline = !lastId;
  let latestProcessedId = lastId;
  let alerted = false;
  for (let i = 1; i < messages.length; i++) {
    const message = messages[i];
    const messageId = String(message.getId() || "");
    if (!messageId) {
      appendTicketReview_(reviewSheet, "missing_message_id", reference, thread, "A later thread message has no readable message ID.");
      return "review";
    }
    if (!isBaseline && i <= cursorIndex) continue;
    const messageDate = message.getDate();
    const messageTime = messageDate && typeof messageDate.getTime === "function" ? messageDate.getTime() : NaN;
    if (!isFinite(messageTime)) {
      appendTicketReview_(reviewSheet, "invalid_message_date", reference, thread, "A thread message has an unreadable timestamp; no reply was processed.");
      return "review";
    }
    const sender = ticketEmail_(message.getFrom()).toLowerCase();
    if (!sender || ownerEmails.indexOf(sender) >= 0) {
      latestProcessedId = messageId;
      row.values[7] = messageDate;
      row.values[12] = messageId;
      writeTicketRow_(sheet, row);
      continue;
    }
    if (!knownEmail || sender !== knownEmail) {
      appendTicketReview_(reviewSheet, "unverified_sender", reference, thread, "A message from an unverified sender needs owner review; message ID " + messageId + ".");
      latestProcessedId = messageId;
      row.values[7] = messageDate;
      row.values[12] = messageId;
      writeTicketRow_(sheet, row);
      continue;
    }
    if (isBaseline && messageTime <= monitorStartedAt) {
      // Initial import records the newest historical reply in the ticket row,
      // but does not notify the owner for mail received before monitoring.
      row.values[6] = "Customer Responded";
      row.values[7] = messageDate;
      row.values[8] = messageDate;
      row.values[9] = "Review historical customer reply (no alert sent)";
      row.values[11] = String(thread.getId());
      row.values[12] = messageId;
      writeTicketRow_(sheet, row);
      sheet.getRange(row.number, 1, 1, AT_TICKET.headers.length).setBackground("#fff2cc");
      latestProcessedId = messageId;
      continue;
    }
    const alertResult = notifyTicketReply_(config, reference, message, thread, sheet, row);
    if (alertResult === "uncertain") {
      appendTicketReview_(reviewSheet, "notification_uncertain", reference, thread, "Owner alert delivery could not be safely confirmed for message ID " + messageId + ". Check sent mail before retrying.");
      return "review";
    }
    latestProcessedId = messageId;
    row.values[6] = "Customer Responded";
    row.values[7] = messageDate;
    row.values[8] = messageDate;
    row.values[9] = "Owner review: respond to customer";
    row.values[11] = String(thread.getId());
    row.values[12] = messageId;
    writeTicketRow_(sheet, row);
    sheet.getRange(row.number, 1, 1, AT_TICKET.headers.length).setBackground("#fff2cc");
    PropertiesService.getScriptProperties().deleteProperty(AT_TICKET.alertPrefix + ticketDigest_(reference + "|" + messageId));
    alerted = true;
  }
  if (latestProcessedId && String(row.values[12] || "") !== latestProcessedId) {
    row.values[12] = latestProcessedId;
    writeTicketRow_(sheet, row);
  }
  if (alerted) return "alerted";
  return result;
}

function notifyTicketReply_(config, reference, message, thread, sheet, row) {
  const messageId = String(message.getId());
  const key = AT_TICKET.alertPrefix + ticketDigest_(reference + "|" + messageId);
  const properties = PropertiesService.getScriptProperties();
  const saved = properties.getProperty(key);
  if (saved === "sent") return "sent";
  if (saved === "attempting" || saved === "uncertain") {
    const existing = sentTicketAlerts_(ticketMarker_(reference, messageId));
    if (existing === 1) { properties.setProperty(key, "sent"); return "sent"; }
    properties.setProperty(key, "uncertain");
    return "uncertain";
  }
  // Persist row status before external notification, then record the attempt.
  row.values[6] = "Customer Responded";
  row.values[7] = message.getDate();
  row.values[8] = message.getDate();
  row.values[9] = "Owner review: respond to customer";
  writeTicketRow_(sheet, row);
  properties.setProperty(key, "attempting");
  const marker = ticketMarker_(reference, messageId);
  try {
    GmailApp.createDraft(config.ownerEmail, "[" + marker + "] AdenTech customer reply — " + reference,
      "A customer replied to AdenTech ticket " + reference + ".\n\nFrom: " + ticketEmail_(message.getFrom()) +
      "\nSubject: " + String(message.getSubject() || "") + "\n\nReview the original Gmail thread: " +
      (thread.getPermalink ? thread.getPermalink() : "Gmail thread " + thread.getId()) +
      "\n\nThis is an owner notification only. No customer reply was sent.").send();
    properties.setProperty(key, "sent");
    return "sent";
  } catch (error) {
    const matching = sentTicketAlerts_(marker);
    if (matching === 1) { properties.setProperty(key, "sent"); return "sent"; }
    properties.setProperty(key, "uncertain");
    return "uncertain";
  }
}

function sentTicketAlerts_(marker) {
  const threads = GmailApp.search('in:sent subject:"' + marker + '"', 0, 2);
  if (threads.length > 1) return 2;
  return threads.length;
}

function ticketMarker_(reference, messageId) { return "AT-TICKET-" + ticketDigest_(reference + "|" + messageId).slice(0, 24).toUpperCase(); }
function ticketDigest_(value) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)).replace(/=+$/g, ""); }
function ticketReference_(text) {
  const matches = [];
  const re = /Reference:\s*([A-F0-9]{8,16})\b/ig;
  let match;
  while ((match = re.exec(String(text || ""))) !== null) matches.push(match[1].toUpperCase());
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? unique[0] : "";
}
function ticketEmail_(value) { const match = String(value || "").match(/<([^>]+)>/); return (match ? match[1] : String(value || "")).trim().toLowerCase(); }
function parseTicketDetails_(body) {
  function field(pattern) { const match = String(body || "").match(pattern); return match ? match[1].trim() : ""; }
  const type = field(/^Type:\s*(.+)$/im);
  const email = field(/^Email:\s*(\S+@\S+)$/im).toLowerCase();
  const submittedSubject = field(/^Subject:\s*(.*)$/im);
  return {name:field(/^Name:\s*(.+)$/im), email:email, subject:/^not supplied$/i.test(submittedSubject) ? "" : submittedSubject,
    type:/enquiry/i.test(type) ? "Enquiry" : /quote/i.test(type) ? "Quote" : "Owner Review"};
}
function ticketSheetText_(value, maxLength) {
  let text = String(value || "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").slice(0, maxLength);
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return text;
}
function ensureTicketSheet_(book, name, headers) {
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else {
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some(function(header, index) { return current[index] !== header; })) throw new Error("Sheet " + name + " has unexpected columns; owner review is required.");
  }
  return sheet;
}
function findTicketRows_(sheet, reference) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, AT_TICKET.headers.length).getValues().reduce(function(found, values, index) {
    if (String(values[0] || "").toUpperCase() === reference) found.push({number:index + 2, values:values});
    return found;
  }, []);
}
function writeTicketRow_(sheet, row) { sheet.getRange(row.number, 1, 1, AT_TICKET.headers.length).setValues([row.values]); }
function appendTicketReview_(sheet, reason, reference, thread, details) {
  const id = String(thread.getId());
  if (sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, AT_TICKET.reviewHeaders.length).getValues();
    if (rows.some(function(row) { return row[1] === reason && row[4] === id && row[5] === "Open"; })) return;
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, AT_TICKET.reviewHeaders.length).setValues([[
    new Date(), reason, reference, thread.getPermalink ? thread.getPermalink() : "", id, "Open", details
  ]]);
}
