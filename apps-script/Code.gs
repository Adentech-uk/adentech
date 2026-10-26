/**
 * AdenTech lead intake automation.
 *
 * DEPLOYMENT:
 * 1. Create a project at https://script.google.com/
 * 2. Paste this file into Code.gs.
 * 3. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * 4. Copy the deployed /exec URL into FORM_ENDPOINT in index.html.
 * 5. Authorize Gmail access and test with a quote and an enquiry.
 *
 * Each incoming request creates/reuses a Gmail label:
 *   AdenTech/Quotes
 *   AdenTech/Enquiries
 * It emails the business inbox a lead summary and sends the customer an acknowledgement.
 * The owner account is the Google account that deploys this web app.
 */

const QUOTE_LABEL = "AdenTech/Quotes";
const ENQUIRY_LABEL = "AdenTech/Enquiries";

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const kind = data.kind === "quote" ? "quote" : "enquiry";
    const name = clean_(data.name, 160);
    const email = clean_(data.email, 254);
    const message = clean_(data.details, 5000);

    if (!name || !email || !message || !/^\S+@\S+\.\S+$/.test(email)) {
      return output_({ ok: false, message: "Please provide a name, valid email and message." });
    }

    const owner = Session.getEffectiveUser().getEmail();
    if (!owner) throw new Error("No owner email is available. Deploy while signed in to the receiving Google account.");

    const labelName = kind === "quote" ? QUOTE_LABEL : ENQUIRY_LABEL;
    const label = getLabel_(labelName);
    const subject = kind === "quote" ? "Website quote request — " + name : "Website enquiry — " + name;
    const body = [
      "Type: " + (kind === "quote" ? "Quote request" : "General enquiry"),
      "Name: " + name,
      "Email: " + email,
      "Location: " + clean_(data.location, 200),
      "Equipment: " + clean_(data.equipment, 500),
      "Preferred timing: " + clean_(data.timing, 200),
      "Subject: " + clean_(data.subject, 250),
      "",
      "Message:",
      message,
      "",
      "Submitted from: " + clean_(data.page, 500)
    ].join("\n");

    GmailApp.sendEmail(owner, subject, body, { replyTo: email, name: "AdenTech Website" });
    const escapedSubject = subject.replace(/"/g, "");
    const threads = GmailApp.search('from:me to:me subject:"' + escapedSubject + '" newer_than:1d', 0, 10);
    if (threads.length) label.addToThread(threads[0]);

    const acknowledgement = kind === "quote"
      ? "Thanks for contacting AdenTech and requesting a quote. We’ve received your details and will review the equipment, location and work requested. If we need clarification, we’ll reply to this email. We’ll confirm the scope and price with you before any work begins.\n\nAdenTech"
      : "Thanks for contacting AdenTech. We’ve received your enquiry and will review your message. We’ll reply to this email as soon as we can.\n\nAdenTech";
    GmailApp.sendEmail(email, kind === "quote" ? "We’ve received your quote request" : "We’ve received your enquiry", acknowledgement, { name: "AdenTech" });

    return output_({ ok: true });
  } catch (err) {
    console.error(err);
    return output_({ ok: false, message: "Unable to process request right now." });
  }
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
