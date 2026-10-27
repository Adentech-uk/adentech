/**
 * AdenTech quote and enquiry intake.
 *
 * Processing uses a script lock, persistent phase state, and phase-specific
 * Gmail markers. This reduces duplicate actions but does not guarantee exactly
 * once processing. If Gmail cannot be reconciled safely, the request is held
 * for owner review. Completed records are retained for 30 days; incomplete
 * and manual-review records are retained for recovery. Browser tabs and the
 * separate Gmail follow-up bot project have independent state and limitations.
 *
 * Customer messages are receipt/reference/review acknowledgements only. Quote
 * content is an owner-only draft. No quote, price confirmation, or revised
 * quote is sent automatically. New information matched to an existing quote
 * reference is flagged for owner review and does not create another quote draft.
 */

const BUSINESS_NAME = "AdenTech";
const QUOTE_LABEL = "AdenTech/Quotes";
const ENQUIRY_LABEL = "AdenTech/Enquiries";
const BASE_POSTCODE = "NW8";
const HOURLY_LABOUR_RATE = 20;
const MINIMUM_VISIT_CHARGE = 50;
const MILEAGE_RATE = 0.45;
const COMPLETED_RETENTION_DAYS = 30;
const STATE_PREFIX = "AT_REQUEST_";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UK_POSTCODE_PATTERN = /^(GIR\s?0AA|(?:[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}))$/i;
const PAYLOAD_FIELDS = ["kind","name","email","location","equipment","details","timing","subject","existingReference","fullAddress","deviceQuantity","jobType","photoLink"];

function doPost(e) {
  let requestId = "";
  let stateKey = "";
  let state = null;
  let locked = false;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== "string" || raw.length > 20000) return output_({ok:false, message:"Please review the form fields and try again."});
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return output_({ok:false, message:"Please review the form fields and try again."});
    requestId = typeof data.requestId === "string" ? data.requestId.trim().toLowerCase() : "";
    if (!UUID_V4_PATTERN.test(requestId)) return output_({ok:false, message:"This request reference is missing or invalid. Please refresh and submit again."});

    const validated = validateRequest_(data);
    if (!validated.ok) return output_({ok:false, message:validated.message});
    const request = validated.request;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return output_({ok:false, retryable:true, message:"Your request is being checked. Please retry shortly with the same answers."});
    locked = true;

    stateKey = STATE_PREFIX + requestId.replace(/-/g, "").toUpperCase();
    const properties = PropertiesService.getScriptProperties();
    pruneCompleted_(properties);
    const payloadHash = digest_(JSON.stringify(request.payload));
    const saved = properties.getProperty(stateKey);
    if (saved) {
      state = JSON.parse(saved);
      if (state.payloadHash !== payloadHash) return output_({ok:false, message:"This request reference is already associated with different answers. Change the form to create a new reference."});
      if (state.status === "completed") return output_({ok:true, reference:state.reference, workflow:state.workflow, duplicate:true});
      if (state.status === "manual_review" && state.phases.manualReviewNotification === "done") {
        return output_({ok:false, retryable:false, message:"Your request needs owner review. Please contact AdenTech and quote reference " + state.reference + "."});
      }
    } else {
      state = newState_(requestId, payloadHash, request.kind);
      properties.setProperty(stateKey, JSON.stringify(state));
    }

    if (!reconcileAttemptingPhases_(state, request, properties, stateKey)) {
      if (state.phases.manualReviewNotification === "pending") sendManualReviewNotice_(state, request, properties, stateKey);
      return output_({ok:false, retryable:false, message:"We could not safely confirm the request status. AdenTech will review it manually; reference " + state.reference + "."});
    }
    if (state.status === "manual_review") {
      if (state.phases.manualReviewNotification === "pending") sendManualReviewNotice_(state, request, properties, stateKey);
      return output_({ok:false, retryable:false, message:"Your request needs owner review. Please contact AdenTech and quote reference " + state.reference + "."});
    }

    if (request.kind === "quote" && !state.referenceResolutionComplete) {
      if (request.existingReference) {
        let match;
        try {
          match = findQuoteThreadByReference_(request.existingReference, request.email);
        } catch (matchError) {
          match = {status:"uncertain"};
        }
        if (match.status !== "matched") {
          state.requiresManualReview = true;
          state.reviewReason = match.status === "not_found" ? "provided_reference_not_found" : "provided_reference_ambiguous";
          state.workflow = "quote-reference-owner-review";
          state.phases.quoteDraft = "done";
          state.phases.existingThreadLabel = "done";
        } else {
          state.existingThreadId = match.threadId;
          state.workflow = "quote-existing-thread-owner-review";
          state.phases.quoteDraft = "done";
          state.phases.existingThreadLabel = "pending";
        }
      } else {
        state.workflow = "quote-awaiting-owner-approval";
      }
      state.referenceResolutionComplete = true;
      saveState_(properties, stateKey, state);
    }

    const owner = Session.getEffectiveUser().getEmail();
    if (!owner) throw new Error("Owner account unavailable");
    const artifacts = buildArtifacts_(request, state);
    const labelName = request.kind === "quote" ? QUOTE_LABEL : ENQUIRY_LABEL;

    if (state.phases.ownerNotification === "pending") {
      getOrCreateLabel_(labelName);
      state.phases.ownerNotification = "attempting";
      saveState_(properties, stateKey, state);
      const sentMessage = GmailApp.createDraft(owner, artifacts.ownerSubject, artifacts.ownerBody, {
        name:BUSINESS_NAME, replyTo:request.email
      }).send();
      state.ownerThreadId = sentMessage.getThread().getId();
      state.phases.ownerNotification = "done";
      if (state.requiresManualReview) state.phases.manualReviewNotification = "done";
      saveState_(properties, stateKey, state);
    }

    if (state.phases.ownerLabel === "pending") {
      state.phases.ownerLabel = "attempting";
      saveState_(properties, stateKey, state);
      const ownerThread = getOwnerThread_(state, requestId);
      getOrCreateLabel_(labelName).addToThread(ownerThread);
      state.ownerThreadId = ownerThread.getId();
      state.phases.ownerLabel = "done";
      saveState_(properties, stateKey, state);
    }

    if (request.kind === "quote" && state.phases.quoteDraft === "pending") {
      state.phases.quoteDraft = "attempting";
      saveState_(properties, stateKey, state);
      GmailApp.createDraft(owner, artifacts.quoteDraftSubject, artifacts.quoteDraftBody, {name:BUSINESS_NAME});
      state.phases.quoteDraft = "done";
      saveState_(properties, stateKey, state);
    }

    if (request.kind === "quote" && state.phases.existingThreadLabel === "pending") {
      state.phases.existingThreadLabel = "attempting";
      saveState_(properties, stateKey, state);
      const existingThread = GmailApp.getThreadById(state.existingThreadId);
      if (!existingThread) throw new Error("Existing quote thread is unavailable");
      getOrCreateLabel_(QUOTE_LABEL).addToThread(existingThread);
      state.phases.existingThreadLabel = "done";
      saveState_(properties, stateKey, state);
    }

    if (state.phases.acknowledgement === "pending") {
      state.phases.acknowledgement = "attempting";
      saveState_(properties, stateKey, state);
      GmailApp.sendEmail(request.email, artifacts.ackSubject, artifacts.ackBody, {name:BUSINESS_NAME});
      state.phases.acknowledgement = "done";
      saveState_(properties, stateKey, state);
    }

    state.status = state.requiresManualReview ? "manual_review" : "completed";
    if (!state.requiresManualReview) state.completedAt = Date.now();
    else state.phases.manualReviewNotification = "done"; // The owner notification contains the review flag.
    saveState_(properties, stateKey, state);
    return output_({ok:true, reference:state.reference, workflow:state.workflow});
  } catch (err) {
    if (state && stateKey) {
      try {
        state.status = state.status === "manual_review" ? "manual_review" : "incomplete";
        saveState_(PropertiesService.getScriptProperties(), stateKey, state);
      } catch (stateError) {}
    }
    console.error("AdenTech intake needs recovery; reference=" + (state ? state.reference : "unassigned"));
    return output_({ok:false, retryable:true, message:"We could not confirm processing. Please retry unchanged shortly; if uncertainty continues, contact AdenTech."});
  } finally {
    if (locked) LockService.getScriptLock().releaseLock();
  }
}

function newState_(requestId, payloadHash, kind) {
  return {
    requestId:requestId,
    payloadHash:payloadHash,
    status:"in_progress",
    createdAt:Date.now(),
    updatedAt:Date.now(),
    reference:Utilities.getUuid().replace(/-/g, "").slice(0, 16).toUpperCase(),
    workflow:kind === "quote" ? "quote-awaiting-owner-approval" : "enquiry-awaiting-review",
    referenceResolutionComplete:kind !== "quote",
    phases:{
      ownerNotification:"pending",
      ownerLabel:"pending",
      quoteDraft:kind === "quote" ? "pending" : "done",
      existingThreadLabel:"done",
      acknowledgement:"pending",
      manualReviewNotification:"pending"
    }
  };
}

function validateRequest_(data) {
  if (data.kind !== "quote" && data.kind !== "enquiry") return {ok:false, message:"Request type is invalid. Reload the form and try again."};
  const allowed = ["requestId"].concat(PAYLOAD_FIELDS);
  for (const key in data) if (allowed.indexOf(key) < 0) return {ok:false, message:"The form contains an unsupported field. Reload and try again."};

  const limits = {name:160,email:254,location:200,equipment:500,details:5000,timing:200,subject:250,existingReference:16,fullAddress:500,deviceQuantity:20,jobType:120,photoLink:1000};
  const payload = {};
  PAYLOAD_FIELDS.forEach(function(key) {
    const value = data[key] === undefined || data[key] === null ? "" : data[key];
    if (typeof value !== "string" || value.length > limits[key]) return;
    payload[key] = value.trim();
  });
  for (const key in limits) {
    const value = data[key] === undefined || data[key] === null ? "" : data[key];
    if (typeof value !== "string" || value.length > limits[key]) return {ok:false, message:"A form field is too long or has an invalid format. Review it and try again."};
  }
  payload.kind = data.kind;
  if (payload.fullAddress) return {ok:false, message:"Please provide only a town or postcode here. AdenTech will request and verify the full address if needed."};
  if (!payload.name || !payload.email || !payload.details) return {ok:false, message:"Please provide your name, email address and message."};
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(payload.email)) return {ok:false, message:"Please provide a valid email address."};
  if (payload.photoLink && !/^https:\/\//i.test(payload.photoLink)) payload.photoLink = "";

  const bad = /^(test|testing|asdf|qwerty|n\/?a|none|unknown|xxx|123|1234|example)$/i;
  if (payload.kind === "quote") {
    if (!payload.location || bad.test(payload.location) || !payload.equipment || payload.equipment.length < 3 || bad.test(payload.equipment) ||
        payload.details.length < 20 || bad.test(payload.details) || bad.test(payload.name)) {
      return {ok:false, message:"Quote requests need a name, town or postcode, equipment details and a useful job description."};
    }
    if (payload.existingReference && !/^[A-F0-9]{8,16}$/i.test(payload.existingReference)) return {ok:false, message:"The earlier AdenTech reference is invalid. Check it or leave the optional field blank."};
  } else {
    if (payload.existingReference) return {ok:false, message:"An existing quote reference can only be used on a quote request."};
    if (!payload.subject || !payload.details) return {ok:false, message:"Please provide a subject and message for your enquiry."};
  }

  const locationStatus = payload.kind !== "quote" ? "not_applicable" :
    (UK_POSTCODE_PATTERN.test(payload.location) ? "postcode_only_unverified" : "town_or_area_unverified");
  return {ok:true, request:{requestId:String(data.requestId).trim().toLowerCase(), kind:payload.kind, name:payload.name, email:payload.email, message:payload.details,
    existingReference:payload.existingReference.toUpperCase(), locationStatus:locationStatus, payload:payload}};
}

function findQuoteThreadByReference_(reference, email) {
  const ref = String(reference || "").toUpperCase();
  if (!/^[A-F0-9]{8,16}$/.test(ref)) return {status:"uncertain"};
  const query = 'in:anywhere "' + ref + '"';
  const threads = GmailApp.search(query, 0, 51);
  if (threads.length > 50) return {status:"uncertain"};
  const candidateThreads = [];
  const matchingThreads = [];
  const refPattern = new RegExp("(^|[^A-F0-9])" + ref + "([^A-F0-9]|$)", "i");
  threads.forEach(function(thread) {
    let hasExactQuoteReference = false;
    let hasCustomerParticipant = false;
    thread.getMessages().forEach(function(message) {
      const subject = message.getSubject() || "";
      const body = message.getPlainBody() || "";
      const referenceInSubject = refPattern.test(subject);
      const referenceLine = new RegExp("(?:reference|ref)\\s*[:#]?\\s*" + ref + "(?:$|[^A-F0-9])", "im").test(body);
      if ((referenceInSubject || referenceLine) && /adentech|quote/i.test(subject + "\n" + body)) hasExactQuoteReference = true;
      const addressText = [message.getFrom(), message.getTo(), message.getCc(), message.getBcc()].join(" ");
      const addresses = addressText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
      if (addresses.map(function(address){return address.toLowerCase();}).indexOf(email.toLowerCase()) >= 0) hasCustomerParticipant = true;
    });
    // Ignore owner-only notifications/drafts; association requires the exact
    // reference and the submitted customer as an actual thread participant.
    if (hasExactQuoteReference && hasCustomerParticipant) {
      candidateThreads.push(thread);
      matchingThreads.push(thread);
    }
  });
  if (candidateThreads.length === 0) return {status:"not_found"};
  if (candidateThreads.length !== 1 || matchingThreads.length !== 1) return {status:"uncertain"};
  return {status:"matched", threadId:matchingThreads[0].getId()};
}

function buildArtifacts_(request, state) {
  const quote = request.kind === "quote";
  const marker = "AT-" + request.requestId;
  const p = request.payload;
  const existing = !!state.existingThreadId;
  const ownerSubject = "[" + marker + "-OWNER] AdenTech " + (quote ? "quote request " : "enquiry ") + state.reference;
  const ownerBody = [
    "Reference: " + state.reference,
    "Type: " + (quote ? (existing ? "New information on an existing quote — owner review required" : "Quote request — owner approval required") : "General enquiry — owner review"),
    "Name: " + p.name,
    "Email: " + p.email,
    "Submitted locality: " + (p.location || "Not supplied") + " (" + (request.locationStatus || "not applicable") + ")",
    "Exact service address: not supplied or verified; confirm directly with customer.",
    "Equipment: " + (p.equipment || "Not supplied"),
    "Preferred timing: " + (p.timing || "Not supplied"),
    "Subject: " + (p.subject || "Not supplied"),
    "Message:", p.details,
    existing ? "REVIEW FLAG: Match the supplied reference to the existing thread. Do not create a second or revised quote draft automatically." : "",
    state.requiresManualReview ? "MANUAL REVIEW FLAG: The supplied reference could not be matched uniquely to a quote thread. Do not create a quote draft until the owner resolves it." : "",
    "Labour policy: £" + HOURLY_LABOUR_RATE + "/hour rounded up to full hours, with a £" + MINIMUM_VISIT_CHARGE + " minimum.",
    "Mileage policy: £" + MILEAGE_RATE.toFixed(2) + " per verified round-trip mile from " + BASE_POSTCODE + "; leave mileage unpriced until the exact address and route are verified.",
    "Do not add VAT. Do not send quote or price details without owner approval."
  ].join("\n");
  const quoteDraftBody = [
    "INTERNAL OWNER-ONLY DRAFT — REVIEW REQUIRED; DO NOT SEND AUTOMATICALLY",
    "Reference: " + state.reference,
    "Confirm exact service address, scope, and duration directly with the customer.",
    "Town/postcode is unverified and is not a service address.",
    "Labour policy: £" + HOURLY_LABOUR_RATE + " per hour rounded up to full hours, with a £" + MINIMUM_VISIT_CHARGE + " minimum.",
    "Mileage: leave unpriced until the owner verifies the exact round-trip distance from " + BASE_POSTCODE + ". Rate: £" + MILEAGE_RATE.toFixed(2) + " per verified round-trip mile.",
    "Do not add VAT. Confirm parts/materials separately.",
    "", "Customer request for internal context:", p.details,
    "Equipment: " + p.equipment,
    "Submitted locality (unverified): " + p.location,
    "Timing: " + (p.timing || "Not supplied")
  ].join("\n");
  const ackSubject = "[" + marker + "-ACK] AdenTech " + (quote ? "quote request received — " : "enquiry received — ") + state.reference;
  const ackBody = "Thanks for contacting AdenTech. We have received your " + (quote ? "quote request" : "enquiry") +
    " and will review it before replying. This is a receipt only; it is not a quote, price confirmation or booking.\n\nReference: " + state.reference + "\n\nAdenTech";
  return {ownerSubject:ownerSubject, ownerBody:ownerBody,
    quoteDraftSubject:"[" + marker + "-DRAFT] INTERNAL AdenTech quote draft " + state.reference,
    quoteDraftBody:quoteDraftBody, ackSubject:ackSubject, ackBody:ackBody};
}

function reconcileAttemptingPhases_(state, request, properties, stateKey) {
  try {
    const marker = "AT-" + request.requestId;
    for (const phase in state.phases) {
      if (state.phases[phase] !== "attempting") continue;
      if (phase === "ownerNotification") {
        const thread = findUniqueMarkedThread_(marker + "-OWNER", "in:sent");
        if (!thread) return markManualReview_(state, properties, stateKey);
        state.ownerThreadId = thread.getId();
        if (state.requiresManualReview) state.phases.manualReviewNotification = "done";
      } else if (phase === "quoteDraft") {
        const drafts = GmailApp.search('in:drafts subject:"' + marker + '-DRAFT"', 0, 20);
        const matches = exactMarkerThreads_(drafts, marker + "-DRAFT");
        if (matches.length !== 1) return markManualReview_(state, properties, stateKey);
      } else if (phase === "acknowledgement") {
        const thread = findUniqueMarkedThread_(marker + "-ACK", "in:sent");
        if (!thread) return markManualReview_(state, properties, stateKey);
      } else if (phase === "manualReviewNotification") {
        const thread = findUniqueMarkedThread_(marker + "-REVIEW", "in:sent");
        if (!thread) return markManualReview_(state, properties, stateKey);
      } else if (phase === "ownerLabel") {
        const thread = state.ownerThreadId ? GmailApp.getThreadById(state.ownerThreadId) : findUniqueMarkedThread_(marker + "-OWNER", "in:sent");
        if (!thread) return markManualReview_(state, properties, stateKey);
        getOrCreateLabel_(request.kind === "quote" ? QUOTE_LABEL : ENQUIRY_LABEL).addToThread(thread);
        state.ownerThreadId = thread.getId();
      } else if (phase === "existingThreadLabel") {
        if (!state.existingThreadId) return markManualReview_(state, properties, stateKey);
        const thread = GmailApp.getThreadById(state.existingThreadId);
        if (!thread) return markManualReview_(state, properties, stateKey);
        getOrCreateLabel_(QUOTE_LABEL).addToThread(thread);
      }
      state.phases[phase] = "done";
      saveState_(properties, stateKey, state);
    }
    return true;
  } catch (err) {
    return markManualReview_(state, properties, stateKey);
  }
}

function sendManualReviewNotice_(state, request, properties, stateKey) {
  if (state.phases.manualReviewNotification !== "pending") return;
  const owner = Session.getEffectiveUser().getEmail();
  if (!owner) return;
  state.phases.manualReviewNotification = "attempting";
  saveState_(properties, stateKey, state);
  const marker = "AT-" + request.requestId + "-REVIEW";
  const reviewBody = [
    "AdenTech could not safely reconcile request processing. Please review it manually.",
    "Reference: " + state.reference,
    "Name: " + request.name,
    "Email: " + request.email,
    "Submitted locality (unverified): " + (request.payload.location || "Not supplied"),
    "Message: " + request.message
  ].join("\n");
  GmailApp.sendEmail(owner, "[" + marker + "] AdenTech request needs manual review " + state.reference,
    reviewBody, {name:BUSINESS_NAME});
  state.phases.manualReviewNotification = "done";
  saveState_(properties, stateKey, state);
}

function findUniqueMarkedThread_(marker, scope) {
  const threads = GmailApp.search(scope + ' subject:"' + marker + '"', 0, 20);
  const matches = exactMarkerThreads_(threads, marker);
  return matches.length === 1 ? matches[0] : null;
}

function exactMarkerThreads_(threads, marker) {
  return threads.filter(function(thread) {
    return thread.getMessages().some(function(message) {return (message.getSubject() || "").indexOf(marker) >= 0;});
  });
}

function getOwnerThread_(state, requestId) {
  if (state.ownerThreadId) {
    const savedThread = GmailApp.getThreadById(state.ownerThreadId);
    if (savedThread) return savedThread;
  }
  const thread = findUniqueMarkedThread_("AT-" + requestId + "-OWNER", "in:sent");
  if (!thread) throw new Error("Owner notification thread is unavailable");
  return thread;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function markManualReview_(state, properties, stateKey) {
  state.status = "manual_review";
  saveState_(properties, stateKey, state);
  return false;
}

function saveState_(properties, key, state) {
  state.updatedAt = Date.now();
  properties.setProperty(key, JSON.stringify(state));
}

function pruneCompleted_(properties) {
  const all = properties.getProperties();
  const cutoff = Date.now() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(STATE_PREFIX) !== 0) return;
    try {
      const record = JSON.parse(all[key]);
      if (record.status === "completed" && record.completedAt && record.completedAt < cutoff) properties.deleteProperty(key);
    } catch (err) {
      // Malformed state is retained for manual recovery.
    }
  });
}

function digest_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes);
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

/** Browser health check; this performs no Gmail operation. */
function doGet() {
  return ContentService.createTextOutput("AdenTech quote and enquiry endpoint is running.").setMimeType(ContentService.MimeType.TEXT);
}
