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
const SERVICE_AREA = "LOCAL_AREA_NOT_CONFIGURED";

// Owner-approved pricing rules.
const BASE_POSTCODE = "NW8";
const HOURLY_LABOUR_RATE = 20;
const MINIMUM_VISIT_CHARGE = 50;
const MINIMUM_BILLABLE_HOURS = 1;
const MILEAGE_RATE = 0.45; // GBP per mile, round trip
const VAT_REGISTERED = false;

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
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
    if (isQuote) {
      const location = clean_(data.location, 200);
      const fullAddress = clean_(data.fullAddress, 500);
      const equipment = clean_(data.equipment, 500);
      const deviceQuantity = Number(data.deviceQuantity);
      const jobType = clean_(data.jobType, 120);
      const badValue = /^(test|testing|asdf|qwerty|n\\/?a|none|unknown|xxx|123+|example)$/i;
      const ukPostcode = /^(GIR\s?0AA|(?:[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}))$/i;
      if (badValue.test(name) || badValue.test(message) || message.length < 20 ||
          badValue.test(equipment) || equipment.length < 3 ||
          !ukPostcode.test(location) ||
          fullAddress.length < 10 ||
          !/(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})/i.test(fullAddress) ||
          !/\d/.test(fullAddress) && !/\b(flat|apartment|unit|floor|house|building)\b/i.test(fullAddress) ||
          !isFinite(deviceQuantity) || Math.floor(deviceQuantity) !== deviceQuantity || deviceQuantity < 1 || deviceQuantity > 100 ||
          !jobType) {
        return output_({ ok: false, message: "Quote request needs a real name, valid UK postcode and full address, job type, equipment, device count and a useful job description. Placeholder/test submissions are not accepted." });
      }
      const addressPostcode = fullAddress.match(/(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})/i);
      if (!addressPostcode || addressPostcode[0].replace(/\s/g, "").toUpperCase() !== location.replace(/\s/g, "").toUpperCase()) {
        return output_({ ok: false, message: "The postcode in the full address must match the postcode field." });
      }
    }
    const label = getLabel_(isQuote ? QUOTE_LABEL : ENQUIRY_LABEL);
    const ticket = Utilities.getUuid().slice(0, 8).toUpperCase();
    const subject = (isQuote ? "[AdenTech Quote " : "[AdenTech Enquiry ") + ticket + "] " + name;
    const location = clean_(data.location, 200);
    const fullAddress = clean_(data.fullAddress, 500);
    const equipment = clean_(data.equipment, 500);
    const deviceQuantity = clean_(data.deviceQuantity, 20);
    const makeModel = clean_(data.makeModel, 300);
    const jobType = clean_(data.jobType, 120);
    const currentStatus = clean_(data.currentStatus, 1000);
    const accessParking = clean_(data.accessParking, 1000);
    const photoLink = safeUrl_(data.photoLink);
    const timing = clean_(data.timing, 200);
    const enquirySubject = clean_(data.subject, 250);
    const mapsUrl = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(BASE_POSTCODE) + "&destination=" + encodeURIComponent(fullAddress || location);
    const addressSearchUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress || location);
    const body = [
      "Reference: " + ticket,
      "Type: " + (isQuote ? "Quote request — owner approval required" : "General enquiry"),
      "Name: " + name,
      "Email: " + email,
      "Town / postcode: " + location,
      "Full service address: " + (fullAddress || "Not supplied"),
      "Equipment: " + equipment,
      "Device quantity: " + (deviceQuantity || "Not specified"),
      "Make / model: " + (makeModel || "Not supplied"),
      "Job type: " + (jobType || "Not specified"),
      "Current setup / status: " + (currentStatus || "Not supplied"),
      "Access / parking: " + (accessParking || "Not supplied"),
      "Photo link: " + (photoLink || "Not supplied"),
      "Preferred timing: " + timing,
      "Subject: " + enquirySubject,
      "",
      "Message:",
      message,
      "",
      "Submitted from: " + clean_(data.page, 500),
      isQuote ? "Google Maps address check (owner must confirm the exact pin/address): " + addressSearchUrl + "\\nTravel route (check route and round-trip miles before quoting): " + mapsUrl : ""
    ].join("\n");
    const notification = GmailApp.createDraft(owner, subject, body, {
      replyTo: email, name: BUSINESS_NAME + " Website"
    }).send();
    label.addToThread(notification.getThread());

    if (isQuote) {
      const estimate = calculateLabourEstimate_(data.estimatedHours);
      const quoteDraftBody = [
        "Hi " + name + ",",
        "",
        "Thanks for asking AdenTech for a quote (reference " + ticket + ").",
        "",
        "DRAFT QUOTE — OWNER REVIEW REQUIRED; DO NOT SEND UNTIL VERIFIED",
        "ADDRESS CHECK: Confirm the exact customer address/pin in Google Maps: " + addressSearchUrl,
        "SCOPE CHECK: Verify the Windows licence, whether data must be preserved/backed up, account access, device specifications and monitor connections before confirming duration or price.",
        "Labour: " + estimate.labourText,
        "Travel: To be confirmed after checking the route from " + BASE_POSTCODE + " and round-trip mileage (£" + MILEAGE_RATE.toFixed(2) + " per mile).",
        "Parts / materials: Not included; confirm requirements and cost before proceeding.",
        "VAT: Not charged (AdenTech is not VAT registered).",
        "Indicative labour amount: " + estimate.totalText,
        "Final price: To be confirmed after the job scope and travel are checked. No booking or work is confirmed by this estimate.",
        "",
        "Your request:",
        "Town / postcode: " + (location || "Not supplied"),
        "Service address: " + (fullAddress || "To be confirmed"),
        "Job type: " + (jobType || "Not specified"),
        "Equipment: " + (equipment || "Not specified"),
        "Quantity: " + (deviceQuantity || "Not specified"),
        "Make / model: " + (makeModel || "Not supplied"),
        "Current setup / status: " + (currentStatus || "Not supplied"),
        "Access / parking: " + (accessParking || "Not supplied"),
        "Requested work: " + message,
        "Preferred timing: " + (timing || "Not specified"),
        "",
        "We will confirm any travel costs, parts and additional work with you before work begins.",
        "",
        "Kind regards,",
        "AdenTech"
      ].join("\n");
      GmailApp.createDraft(email, "DRAFT — AdenTech quote for approval — " + ticket, quoteDraftBody, { name: BUSINESS_NAME });
      const customerSummary = [
        "Thanks for requesting a quote from AdenTech. We’ve received the details below.",
        "",
        "REFERENCE: " + ticket,
        "STATUS: Received — awaiting review. This email is not a confirmed quote or booking.",
        "",
        "YOUR REQUEST",
        "Name: " + name,
        "Email: " + email,
        "Town / postcode: " + (location || "Not supplied"),
        "Full service address: " + (fullAddress || "Not supplied"),
        "Job type: " + (jobType || "Not specified"),
        "Equipment: " + (equipment || "Not specified"),
        "Number of devices: " + (deviceQuantity || "Not specified"),
        "Make / model: " + (makeModel || "Not supplied"),
        "Current setup / condition: " + (currentStatus || "Not supplied"),
        "Requested work: " + message,
        "Access / parking: " + (accessParking || "Not supplied"),
        "Photo link: " + (photoLink || "Not supplied"),
        "Preferred timing: " + (timing || "Not specified"),
        "Google Maps address check: " + addressSearchUrl,
        "Travel route (check exact route and round-trip mileage): " + mapsUrl,
        "",
        "PRICING POLICY — SUBJECT TO REVIEW",
        "Minimum visit / labour charge: £" + MINIMUM_VISIT_CHARGE.toFixed(2) + " (first hour, subject to confirmed scope).",
        "Additional labour: £" + HOURLY_LABOUR_RATE.toFixed(2) + " per hour after the first hour.",
        "Travel: £" + MILEAGE_RATE.toFixed(2) + " per round-trip mile from " + BASE_POSTCODE + ", after the route is checked.",
        "Parts / materials: not included; confirmed separately before proceeding.",
        "VAT: not charged; AdenTech is not VAT registered.",
        "",
        "We have not assumed a job duration or calculated a travel amount yet. We’ll review the work, confirm the likely duration and route mileage, and agree the final price with you before any work begins.",
        "",
        "Kind regards,",
        "AdenTech"
      ].join("\n");
      GmailApp.sendEmail(email, "AdenTech quote request received — " + ticket, customerSummary, { name: BUSINESS_NAME });
      return output_({ ok: true, reference: ticket, workflow: "quote-awaiting-owner-approval" });
    }

    if (isSimpleServicesQuestion_(message, enquirySubject)) {
      const answer = "Hi " + name + ",\n\nThanks for contacting AdenTech. " + SERVICE_SUMMARY +
        "\n\nWe don’t publish fixed prices because the cost depends on the job. Please use the Get a Quote form with your town or postcode and details of the setup, and we’ll review it. Service coverage and availability are confirmed individually; no booking is confirmed by this email.\n\nKind regards,\nAdenTech";
      GmailApp.sendEmail(email, "AdenTech — services information — " + ticket, answer, { name: BUSINESS_NAME });
      return output_({ ok: true, reference: ticket, workflow: "simple-enquiry-auto-answered" });
    }
    GmailApp.sendEmail(email, "AdenTech received your enquiry — " + ticket,
      "Thanks for contacting AdenTech. We’ve received your enquiry and will review it before replying. We don’t want to guess about pricing, service coverage, availability or technical compatibility, so a member of the team will follow up.\n\nReference: " + ticket + "\n\nAdenTech",
      { name: BUSINESS_NAME });
    return output_({ ok: true, reference: ticket, workflow: "enquiry-escalated-for-review" });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return output_({ ok: false, message: "Unable to process request right now." });
  }
}

function calculateLabourEstimate_(requestedHours) {
  const hours = Number(requestedHours);
  if (!isFinite(hours) || hours <= 0) {
    return {
      labourText: "£" + MINIMUM_VISIT_CHARGE.toFixed(2) + " minimum visit/labour charge for the first hour; duration must be reviewed",
      totalText: "£" + MINIMUM_VISIT_CHARGE.toFixed(2) + " minimum labour amount for the first hour, before travel and parts; additional time may apply"
    };
  }
  const billableHours = Math.max(MINIMUM_BILLABLE_HOURS, hours);
  // The £50 minimum covers the first hour; additional hours are £20 each.
  const labour = Math.max(MINIMUM_VISIT_CHARGE, MINIMUM_VISIT_CHARGE + Math.max(0, billableHours - MINIMUM_BILLABLE_HOURS) * HOURLY_LABOUR_RATE);
  return {
    labourText: billableHours + " hour(s): £" + MINIMUM_VISIT_CHARGE.toFixed(2) + " first-hour minimum plus £" + HOURLY_LABOUR_RATE.toFixed(2) + " for each additional hour = £" + labour.toFixed(2),
    totalText: "£" + labour.toFixed(2) + " labour only, before travel and parts"
  };
}

function safeUrl_(value) {
  const url = clean_(value, 1000);
  return /^https:\/\//i.test(url) ? url : "";
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

/**
 * Browser health check. Open the deployed /exec URL to verify the deployment.
 * Website submissions are handled separately by doPost(e).
 */
function doGet() {
  const message = "AdenTech Quote and Enquiry endpoint is running. Submit enquiries through the website form.";
  return ContentService.createTextOutput(message)
    .setMimeType(ContentService.MimeType.TEXT);
}
