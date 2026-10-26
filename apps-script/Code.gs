/**
 * AdenTech quote + enquiry assistant.
 *
 * DEPLOYMENT
 * 1. Sign into the Gmail account that should receive leads at https://script.google.com/
 * 2. Create a project and paste this file into Code.gs.
 * 3. Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone.
 * 4. Authorize the requested Gmail permissions.
 * 5. Paste the deployed /exec URL into FORM_ENDPOINT in index.html.
 * 6. Test both forms before relying on it.
 *
 * QUOTE POLICY: never invent or send a price. A quote request creates an owner
 * notification and a customer-reply draft for owner review. The customer gets
 * only a receipt acknowledgement until the owner approves a quote.
 *
 * ENQUIRY POLICY: only the fixed, low-risk services description is auto-answered.
 * Questions about pricing, coverage, availability, compatibility, urgent issues,
 * or anything not confidently covered are escalated for owner review.
 */

const QUOTE_LABEL = "AdenTech/Quotes";
const ENQUIRY_LABEL = "AdenTech/Enquiries";
const BUSINESS_NAME = "AdenTech";
const SERVICE_SUMMARY = "AdenTech helps with computer and laptop setup, monitors, printers, workstation setup and testing.";
// Fill this in with the exact towns/postcodes you serve before adding area-based auto replies.
const SERVICE_AREA = "LOCAL_AREA_NOT_CONFIGURED";

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    // Optional honeypot. If added to the site as a hidden "website" field, spam is ignored.
    if (clean_(data.website, 200)) return output_({ ok: true });

    const kind = data.kind === "quote" ? "quote" : "enquiry";
    const name = clean_(data.name, 160);
    const email = clean_(data.email, 254);
    const message = clean_(data.details, 5000);

    if (!name || !email || !message || !/^\S+@\S+\.\S+$/.test(email)) {
      return output_({ ok: false, message: "Please provide a name, valid email and message." });
    }

    const owner = Session.getEffectiveUser().getEmail();
    if (!owner) throw new Error("No owner email is available. Deploy while signed in to the receiving Google account.");

    const isQuote = kind === "quote";
    const label = getLabel_(isQuote ? QUOTE_LABEL : ENQUIRY_LABEL);
    const ticket = Utilities.getUuid().slice(0, 8).toUpperCase();
    const subject = (isQuote ? "[AdenTech Quote " : "[AdenTech Enquiry ") + ticket + "] " + name;
    const location = clean_(data.location, 200);
    const equipment = clean_(data.equipment, 500);
    const timing = clean_(data.timing, 200);
    const enquirySubject = clean_(data.subject, 250);
    const body = [
      "Reference: " + ticket,
      "Type: " + (isQuote ? "Quote request — owner approval required" : "General enquiry"),
      "Name: " + name,
      "Email: " + email,
      "Location: " + location,
      "Equipment: " + equipment,
      "Preferred timing: " + timing,
      "Subject: " + enquirySubject,
      "",
      "Message:",
      message,
      "",
      "Submitted from: " + clean_(data.page, 500)
    ].join("\n");

    // Send owner notification and place it under the relevant Gmail label/folder.
    const notification = GmailApp.createDraft(owner, subject, body, {
      replyTo: email,
      name: BUSINESS_NAME + " Website"
    }).send();
    label.addToThread(notification.getThread());

    if (isQuote) {
      // Prepare a customer reply as a DRAFT. Never send a price without owner review.
      const quoteDraftBody = [
        "Hi " + name + ",",
        "",
        "Thanks for asking AdenTech for a quote (reference " + ticket + ").",
        "",
        "Before we confirm a price, we’ll review the requested work and may ask a few follow-up questions. The final scope, any parts or travel costs, and the price will be confirmed with you before any work begins.",
        "",
        "Your request:",
        "Location: " + location,
        "Equipment: " + equipment,
        "Requested work: " + message,
        "Preferred timing: " + (timing || "Not specified"),
        "",
        "Kind regards,",
        "AdenTech"
      ].join("\n");
      GmailApp.createDraft(email, "AdenTech quote request — " + ticket, quoteDraftBody, { name: BUSINESS_NAME });
      GmailApp.sendEmail(email, "We’ve received your AdenTech quote request — " + ticket,
        "Thanks for requesting a quote from AdenTech. We’ve received your details and will review them. We’ll contact you if we need more information. No price or booking is confirmed yet.\n\nAdenTech",
        { name: BUSINESS_NAME });
      return output_({ ok: true, reference: ticket, workflow: "quote-awaiting-owner-approval" });
    }

    // Safe, fixed response only for a clear question about the services offered.
    if (isSimpleServicesQuestion_(message, enquirySubject)) {
      const answer = "Hi " + name + ",\n\nThanks for contacting AdenTech. " + SERVICE_SUMMARY +
        "\n\nWe don’t publish fixed prices because the cost depends on the job. Please use the Get a Quote form with your town or postcode and details of the setup, and we’ll review it. Service coverage and availability are confirmed individually; no booking is confirmed by this email.\n\nKind regards,\nAdenTech";
      GmailApp.sendEmail(email, "AdenTech — services information — " + ticket, answer, { name: BUSINESS_NAME });
      return output_({ ok: true, reference: ticket, workflow: "simple-enquiry-auto-answered" });
    }

    // Uncertain or specific questions: acknowledge receipt, then let the owner answer.
    GmailApp.sendEmail(email, "AdenTech received your enquiry — " + ticket,
      "Thanks for contacting AdenTech. We’ve received your enquiry and will review it before replying. We don’t want to guess about pricing, service coverage, availability or technical compatibility, so a member of the team will follow up.\n\nReference: " + ticket + "\n\nAdenTech",
      { name: BUSINESS_NAME });
    return output_({ ok: true, reference: ticket, workflow: "enquiry-escalated-for-review" });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return output_({ ok: false, message: "Unable to process request right now." });
  }
}

function isSimpleServicesQuestion_(message, subject) {
  const text = (String(subject || "") + " " + String(message || "")).toLowerCase();
  const asksAboutServices = /\b(what services|which services|what do you do|what can you help with|what do you help with|services do you offer|do you offer)\b/.test(text);
  const asksSomethingRisky = /\b(price|pricing|cost|quote|how much|available|availability|when can|urgent|emergency|compatible|compatibility|support remotely|remote support|postcode|town|area|cover|coverage|travel|parts|repair|diagnos|data recovery|password|business network|server)\b/.test(text);
  return asksAboutServices && !asksSomethingRisky;
}

function getLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function clean_(value, maxLength) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
