/**
 * AdenTech Gmail quote follow-up workflow.
 *
 * This is a Gmail-bound Apps Script, separate from the website's doPost web app.
 * It NEVER sends follow-up emails or quotes. It only creates drafts for owner review.
 *
 * SETUP
 * 1. Sign into the Gmail account that receives AdenTech quote notifications.
 * 2. Go to https://script.google.com/ and create a standalone project.
 * 3. Paste this entire file into Code.gs and save.
 * 4. Run setupAdenTechAutomation() once and approve Gmail permissions.
 * 5. Ensure quote threads carry the Gmail label "adentech-quotes".
 *    Existing label "AdenTech/Quotes" is also supported.
 * 6. Run processAdenTechInbox() once manually to test; then the trigger runs every 15 minutes.
 *
 * FLOW
 * A. A new thread with the quote label gets a customer follow-up-question draft.
 * B. When the customer replies and the thread/reference is found in Inbox, a quote draft
 *    is created for the owner. The reply is used as context; missing hours/mileage/parts
 *    remain explicitly unconfirmed. Nothing is sent automatically.
 */

const AT_LABELS = {
  quote: "adentech-quotes",
  legacyQuote: "AdenTech/Quotes",
  followupDrafted: "adentech-follow-up-drafted",
  replySeen: "adentech-customer-replied",
  quoteDrafted: "adentech-quote-drafted"
};

const AT_PRICING = {
  basePostcode: "NW8",
  firstHour: 50,
  extraHour: 20,
  roundTripMile: 0.45,
  vatRegistered: false
};

function setupAdenTechAutomation() {
  Object.keys(AT_LABELS).forEach(function (key) {
    getOrCreateLabel_(AT_LABELS[key]);
  });

  // Avoid duplicate triggers.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "processAdenTechInbox") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("processAdenTechInbox")
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log("AdenTech automation installed. It creates drafts only; it does not send emails.");
}

function processAdenTechInbox() {
  draftFollowUpQuestionsForNewQuotes_();
  draftQuoteAfterCustomerReply_();
}

/**
 * For each labelled quote thread not processed before, create a follow-up draft.
 */
function draftFollowUpQuestionsForNewQuotes_() {
  const done = getOrCreateLabel_(AT_LABELS.followupDrafted);
  const queries = [
    'label:' + AT_LABELS.quote + ' -label:' + AT_LABELS.followupDrafted,
    'label:"AdenTech/Quotes" -label:' + AT_LABELS.followupDrafted
  ];
  const threads = uniqueThreads_(queries);

  threads.forEach(function (thread) {
    const details = extractRequestDetails_(thread);
    if (!details.customerEmail || !isValidEmail_(details.customerEmail)) {
      Logger.log("Skipping thread without a clear customer email: " + thread.getFirstMessageSubject());
      done.addToThread(thread);
      return;
    }

    const subject = "AdenTech — a few questions about your request — " +
      (details.reference || "reference to be confirmed");
    const body = [
      "Hi " + (details.customerName || "there") + ",",
      "",
      "Thanks for contacting AdenTech" + (details.reference ? " (reference " + details.reference + ")" : "") + ".",
      "Before we prepare a quote, could you please confirm the details below that apply to your setup?",
      "",
      "1. How many laptops/computers and how many monitors need to be set up?",
      "2. What are the make/model of the laptop and monitors, if known?",
      "3. How should the monitors connect (HDMI, DisplayPort, USB-C, docking station, or not sure)?",
      "4. Are the laptop, monitors, power supplies and required cables already available?",
      "5. Is the laptop new or already configured? Does anything need transferring or installing?",
      "6. Please confirm the full service address and postcode.",
      "7. Is there parking or any access information we should know about?",
      "8. Which date/weekend would suit you?",
      "",
      "Please do not email passwords or other sensitive account information.",
      "",
      "We will confirm the likely labour time, travel and any parts after reviewing your answers. Our pricing policy is £50 for the first hour, £20 for each additional hour, and £0.45 per round-trip mile from NW8 after the route is checked. Parts are separate if required. AdenTech is not VAT registered, so VAT is not added.",
      "",
      "This is a request for information, not a confirmed booking or quote.",
      "",
      "Kind regards,",
      "AdenTech"
    ].join("\n");

    // Draft only: never send.
    GmailApp.createDraft(details.customerEmail, subject, body, {
      name: "AdenTech",
      replyTo: Session.getEffectiveUser().getEmail()
    });
    done.addToThread(thread);
  });
}

/**
 * Detects customer replies in Inbox, matches them to a quote reference, and creates
 * one owner-review quote draft per reference. Quote is never sent automatically.
 */
function draftQuoteAfterCustomerReply_() {
  const replySeen = getOrCreateLabel_(AT_LABELS.replySeen);
  const quoteDrafted = getOrCreateLabel_(AT_LABELS.quoteDrafted);
  const ownerEmail = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
  const threads = GmailApp.search('in:inbox newer_than:180d -label:' + AT_LABELS.quoteDrafted, 0, 100);

  threads.forEach(function (thread) {
    const messages = thread.getMessages();
    if (!messages || messages.length < 2) return;

    const request = extractRequestDetails_(thread);
    const reference = request.reference || findReference_(thread.getFirstMessageSubject() + "\n" + thread.getFirstMessageBody());
    if (!reference) return;

    const incomingReplies = messages.filter(function (message) {
      const from = extractEmail_(message.getFrom()).toLowerCase();
      return from && from !== ownerEmail && message.getDate() > messages[0].getDate();
    });
    if (!incomingReplies.length) return;

    // Only treat it as a quote reply if this thread contains a known AdenTech quote reference.
    const latestReply = incomingReplies[incomingReplies.length - 1];
    const replyText = latestReply.getPlainBody().slice(0, 12000);
    const recipient = request.customerEmail || extractEmail_(latestReply.getFrom());
    if (!recipient || !isValidEmail_(recipient)) return;

    const subject = "DRAFT QUOTE — " + reference + " — " + (request.customerName || recipient);
    const draftBody = [
      "Hi " + (request.customerName || "there") + ",",
      "",
      "Thank you for the additional details for reference " + reference + ".",
      "",
      "DRAFT ONLY — OWNER MUST VERIFY ALL ITEMS BELOW BEFORE SENDING",
      "",
      "CUSTOMER'S ORIGINAL REQUEST",
      "Name: " + (request.customerName || "Not identified"),
      "Email: " + recipient,
      "Location / postcode: " + (request.location || "Confirm with customer"),
      "Full address: " + (request.fullAddress || "Confirm exact address"),
      "Equipment: " + (request.equipment || "Confirm equipment"),
      "Device quantity: " + (request.quantity || "Confirm quantity"),
      "Requested work: " + (request.requestedWork || "Review original thread"),
      "Preferred timing: " + (request.timing || "Not specified"),
      "",
      "CUSTOMER'S LATEST REPLY (review the original email thread too)",
      replyText,
      "",
      "QUOTE WORKSHEET — DO NOT PRESENT AS A FINAL PRICE UNTIL COMPLETED",
      "Labour hours: NOT CONFIRMED — establish expected duration from the agreed scope.",
      "Labour price: £" + AT_PRICING.firstHour.toFixed(2) + " for the first hour; £" +
        AT_PRICING.extraHour.toFixed(2) + " per additional hour. Calculate only after duration is agreed.",
      "Travel: NOT CALCULATED — check the exact address and route from " + AT_PRICING.basePostcode +
        ", then calculate round-trip miles × £" + AT_PRICING.roundTripMile.toFixed(2) + ".",
      "Parts / cables / licences: NOT CONFIRMED — list and price only after checking with customer.",
      "VAT: Not charged; AdenTech is not VAT registered.",
      "",
      "Before sending, owner must confirm: exact address, number of devices/monitors, compatibility and cables, agreed scope, labour hours, route and round-trip mileage, parts/materials, final total, and requested date.",
      "Do not claim a route, duration, compatibility, or final price has been checked unless it actually has.",
      "",
      "Kind regards,",
      "AdenTech"
    ].join("\n");

    GmailApp.createDraft(recipient, subject, draftBody, { name: "AdenTech" });
    quoteDrafted.addToThread(thread);
    replySeen.addToThread(thread);
  });
}

function extractRequestDetails_(thread) {
  const messages = thread.getMessages();
  const first = messages.length ? messages[0] : null;
  const text = first ? first.getPlainBody() : "";
  const combined = thread.getFirstMessageSubject() + "\n" + text;

  return {
    reference: findReference_(combined),
    customerName: matchField_(text, /^Name:\s*(.+)$/im),
    customerEmail: matchField_(text, /^(?:Email|Customer email):\s*(\S+@\S+)$/im),
    location: matchField_(text, /^(?:Town\s*\/\s*postcode|Location|Postcode):\s*(.+)$/im),
    fullAddress: matchField_(text, /^Full service address:\s*(.+)$/im),
    equipment: matchField_(text, /^Equipment:\s*(.+)$/im),
    quantity: matchField_(text, /^(?:Device quantity|Number of devices):\s*(.+)$/im),
    timing: matchField_(text, /^Preferred timing:\s*(.+)$/im),
    requestedWork: extractMessage_(text)
  };
}

function extractMessage_(body) {
  const match = String(body || "").match(/(?:^|\n)Message:\s*\n([\s\S]*?)(?:\n\n(?:Submitted from:|Google Maps|Travel route|$))/i);
  return match ? match[1].trim().slice(0, 3000) : "";
}

function findReference_(text) {
  const value = String(text || "");
  const patterns = [
    /Reference:\s*([A-Z0-9]{6,16})/i,
    /AdenTech\s+(?:Quote|Enquiry)\s+([A-Z0-9]{6,16})/i,
    /\b(?:quote|reference|ref|order)\s*#?\s*([A-Z0-9]{6,16})\b/i,
    /\[AdenTech\s+(?:Quote|Enquiry)\s+([A-Z0-9]{6,16})\]/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = value.match(patterns[i]);
    if (match) return match[1].toUpperCase();
  }
  return "";
}

function uniqueThreads_(queries) {
  const found = {};
  queries.forEach(function (query) {
    GmailApp.search(query, 0, 100).forEach(function (thread) {
      found[thread.getId()] = thread;
    });
  });
  return Object.keys(found).map(function (id) { return found[id]; });
}

function matchField_(text, regex) {
  const match = String(text || "").match(regex);
  return match ? match[1].trim() : "";
}

function extractEmail_(fromHeader) {
  const value = String(fromHeader || "");
  const bracket = value.match(/<([^<>]+@[^<>]+)>/);
  if (bracket) return bracket[1].trim();
  const plain = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plain ? plain[0] : "";
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
