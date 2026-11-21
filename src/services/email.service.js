import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SESClient,
  SendEmailCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";

const LOGO_CID = "solarvy-logo";
const LOGO_FALLBACK_URL = "https://www.solarvy.ng/email-logo.png";
const LOGO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/email-logo.png",
);

let sesClient = null;
let cachedLogoBase64 = null;
let logoLoadAttempted = false;

function getExplicitAwsCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

function getSesClient() {
  if (sesClient) return sesClient;
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  const credentials = getExplicitAwsCredentials();
  sesClient = new SESClient({
    region,
    ...(credentials ? { credentials } : {}),
  });
  return sesClient;
}

function isSesConfigured() {
  return Boolean(process.env.SES_FROM_EMAIL?.trim());
}

function isAwsCredentialError(error) {
  const msg = String(error?.message || error?.name || "");
  return /credentials|Credential|Could not load credentials|Unauthorized|UnrecognizedClient|InvalidClientTokenId|ExpiredToken/i.test(
    msg,
  );
}

function getLogoBase64() {
  if (logoLoadAttempted) return cachedLogoBase64;
  logoLoadAttempted = true;
  try {
    cachedLogoBase64 = readFileSync(LOGO_PATH).toString("base64");
  } catch (error) {
    console.warn(
      `[email] Missing logo asset at ${LOGO_PATH}; falling back to remote URL`,
      error?.message || error,
    );
    cachedLogoBase64 = null;
  }
  return cachedLogoBase64;
}

function buildOtpDigitCells(code) {
  const digits = String(code || "")
    .replace(/\D/g, "")
    .slice(0, 6)
    .padEnd(6, " ")
    .split("");
  return digits
    .map(
      (digit) => `
                  <td align="center" style="padding: 0 3px;">
                    <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                      <tr>
                        <td align="center" valign="middle" style="width: 40px; height: 48px; border: 1.5px solid #e8edf5; border-radius: 8px; background: #f8fafc; font-size: 22px; font-weight: 700; color: #1a2259; font-family: Arial, Helvetica, sans-serif;">
                          ${digit.trim() || "&nbsp;"}
                        </td>
                      </tr>
                    </table>
                  </td>`,
    )
    .join("");
}

function buildOtpHtml({ code, purpose, logoSrc }) {
  const action =
    purpose === "login"
      ? "log in to SolarVy"
      : "finish creating your SolarVy account";
  const title =
    purpose === "login" ? "Your login code" : "Verify your email";
  const digitCells = buildOtpDigitCells(code);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SolarVy verification code</title>
</head>
<body style="margin: 0; padding: 0; background: #f7f9fc; font-family: Arial, Helvetica, sans-serif; color: #1a2259;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background: #f7f9fc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width: 480px; background: #ffffff; border-radius: 14px; border: 1px solid #e8edf5; overflow: hidden;">
          <tr>
            <td style="height: 4px; background: #F5921E; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 28px 28px 8px; text-align: center;">
              <img src="${logoSrc}" alt="SolarVy" width="140" height="42" style="display: inline-block; max-width: 140px; height: auto; border: 0;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px 28px;">
              <h1 style="margin: 0 0 10px; font-size: 22px; line-height: 1.3; color: #1a2259; font-weight: 700; text-align: center;">
                ${title}
              </h1>
              <p style="margin: 0 0 24px; color: #5a6478; font-size: 14px; line-height: 1.5; text-align: center;">
                Use this code to ${action}. It expires in <strong style="color: #1a2259;">10 minutes</strong>.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                      <tr>
                        ${digitCells}
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin: 28px 0 0; color: #8a93a6; font-size: 12px; line-height: 1.5; text-align: center;">
                If you did not request this, you can ignore this email.
              </p>
              <p style="margin: 12px 0 0; color: #8a93a6; font-size: 12px; text-align: center;">
                <a href="https://solarvy.ng" style="color: #174c90; text-decoration: none;">solarvy.ng</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildOtpText({ code, purpose }) {
  return `SolarVy verification code: ${code}\n\nUse this code to ${
    purpose === "login"
      ? "log in to SolarVy"
      : "finish creating your SolarVy account"
  }. It expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.\n\nhttps://solarvy.ng`;
}

function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function chunkBase64(value) {
  return value.replace(/.{1,76}/g, "$&\r\n").trim();
}

function buildRawMime({
  from,
  to,
  subject,
  textBody,
  htmlBody,
  logoBase64,
}) {
  const altBoundary = `solarvy_alt_${Date.now()}`;
  const relBoundary = `solarvy_rel_${Date.now()}`;

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    textBody,
    "",
    `--${altBoundary}`,
    `Content-Type: multipart/related; boundary="${relBoundary}"`,
    "",
    `--${relBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlBody,
    "",
    `--${relBoundary}`,
    "Content-Type: image/png; name=\"email-logo.png\"",
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${LOGO_CID}>`,
    'Content-Disposition: inline; filename="email-logo.png"',
    "",
    chunkBase64(logoBase64),
    "",
    `--${relBoundary}--`,
    "",
    `--${altBoundary}--`,
    "",
  ].join("\r\n");
}

/**
 * Send a 6-digit OTP via AWS SES.
 * In non-production, if SES is not configured (or AWS keys are missing),
 * logs the code and returns { mocked: true }.
 */
export async function sendOtpEmail({ to, code, purpose }) {
  const fromEmail = process.env.SES_FROM_EMAIL?.trim();
  const fromName = process.env.SES_FROM_NAME?.trim() || "SolarVy";
  const subject =
    purpose === "login"
      ? "Your SolarVy login code"
      : "Your SolarVy verification code";

  if (!isSesConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email delivery is not configured (SES_FROM_EMAIL)");
    }
    console.log(
      `[email:dev] OTP for ${to} (${purpose}): ${code} — configure SES_FROM_EMAIL to send real email`,
    );
    return { mocked: true };
  }

  // Local/dev often has SES_FROM_EMAIL set for production parity but no AWS keys.
  // Prefer console OTP over a cryptic credential-chain failure.
  if (process.env.NODE_ENV !== "production" && !getExplicitAwsCredentials()) {
    console.log(
      `[email:dev] OTP for ${to} (${purpose}): ${code} — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to send via SES`,
    );
    return { mocked: true };
  }

  const source = `${fromName} <${fromEmail}>`;
  const textBody = buildOtpText({ code, purpose });
  const logoBase64 = getLogoBase64();

  let command;
  if (logoBase64) {
    const htmlBody = buildOtpHtml({
      code,
      purpose,
      logoSrc: `cid:${LOGO_CID}`,
    });
    const rawMessage = buildRawMime({
      from: source,
      to,
      subject,
      textBody,
      htmlBody,
      logoBase64,
    });
    command = new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rawMessage, "utf8") },
    });
  } else {
    const htmlBody = buildOtpHtml({
      code,
      purpose,
      logoSrc: LOGO_FALLBACK_URL,
    });
    command = new SendEmailCommand({
      Source: source,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: textBody, Charset: "UTF-8" },
          Html: { Data: htmlBody, Charset: "UTF-8" },
        },
      },
    });
  }

  try {
    await getSesClient().send(command);
  } catch (error) {
    if (isAwsCredentialError(error)) {
      const err = new Error(
        "Email delivery is unavailable: AWS credentials are not configured on the server",
      );
      err.status = 503;
      err.cause = error;
      throw err;
    }
    throw error;
  }
  return { mocked: false };
}

function getSiteBaseUrl() {
  return process.env.WEBSITE_URL?.trim()?.replace(/\/$/, "") || "https://www.solarvy.ng";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDetailRows(details = []) {
  return details
    .filter((item) => item?.value)
    .map(
      (item) => `
        <tr>
          <td style="padding: 0 0 12px; color: #5a6478; font-size: 13px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
            ${escapeHtml(item.label)}
          </td>
          <td style="padding: 0 0 12px 18px; color: #1a2259; font-size: 13px; line-height: 1.5; font-weight: 700; text-align: right; font-family: Arial, Helvetica, sans-serif;">
            ${escapeHtml(item.value)}
          </td>
        </tr>`,
    )
    .join("");
}

function buildProjectEmailHtml({
  title,
  preheader,
  introLines = [],
  detailRows = [],
  ctaLabel = "",
  ctaUrl = "",
  note = "",
  logoSrc,
}) {
  const introHtml = introLines
    .filter(Boolean)
    .map(
      (line) => `
        <p style="margin: 0 0 14px; color: #5a6478; font-size: 14px; line-height: 1.7; font-family: Arial, Helvetica, sans-serif;">
          ${escapeHtml(line)}
        </p>`,
    )
    .join("");

  const detailHtml = detailRows.length
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin: 8px 0 0; padding: 18px; border: 1px solid #e8edf5; border-radius: 14px; background: #f8fafc;">
        ${buildDetailRows(detailRows)}
      </table>`
    : "";

  const ctaHtml =
    ctaLabel && ctaUrl
      ? `
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin: 26px 0 0;">
        <tr>
          <td align="center" style="border-radius: 12px; background: #F5921E;">
            <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; padding: 14px 22px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; font-family: Arial, Helvetica, sans-serif;">
              ${escapeHtml(ctaLabel)}
            </a>
          </td>
        </tr>
      </table>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background: #f7f9fc; font-family: Arial, Helvetica, sans-serif; color: #1a2259;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
    ${escapeHtml(preheader || title)}
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background: #f7f9fc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width: 560px; background: #ffffff; border-radius: 14px; border: 1px solid #e8edf5; overflow: hidden;">
          <tr>
            <td style="height: 4px; background: #F5921E; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 28px 28px 8px; text-align: center;">
              <img src="${logoSrc}" alt="SolarVy" width="140" height="42" style="display: inline-block; max-width: 140px; height: auto; border: 0;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px 28px;">
              <h1 style="margin: 0 0 14px; font-size: 24px; line-height: 1.3; color: #1a2259; font-weight: 700;">
                ${escapeHtml(title)}
              </h1>
              ${introHtml}
              ${detailHtml}
              ${ctaHtml}
              ${
                note
                  ? `<p style="margin: 22px 0 0; color: #8a93a6; font-size: 12px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">
                ${escapeHtml(note)}
              </p>`
                  : ""
              }
              <p style="margin: 12px 0 0; color: #8a93a6; font-size: 12px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">
                SolarVy will continue to show the latest project activity inside your project space.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildProjectEmailText({
  title,
  introLines = [],
  detailRows = [],
  ctaLabel = "",
  ctaUrl = "",
  note = "",
}) {
  const detailText = detailRows
    .filter((item) => item?.value)
    .map((item) => `${item.label}: ${item.value}`)
    .join("\n");

  return [
    `SolarVy`,
    ``,
    title,
    ``,
    ...introLines.filter(Boolean),
    detailText ? `\n${detailText}` : "",
    ctaLabel && ctaUrl ? `\n${ctaLabel}: ${ctaUrl}` : "",
    note ? `\n${note}` : "",
    `\n${getSiteBaseUrl()}/projects`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendBrandedEmail({
  to,
  subject,
  title,
  preheader,
  introLines,
  detailRows,
  ctaLabel,
  ctaUrl,
  note,
}) {
  const fromEmail = process.env.SES_FROM_EMAIL?.trim();
  const fromName = process.env.SES_FROM_NAME?.trim() || "SolarVy";

  if (!fromEmail) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email delivery is not configured (SES_FROM_EMAIL)");
    }
    console.log(`[email:dev] ${subject} -> ${to}`);
    return { mocked: true };
  }

  if (process.env.NODE_ENV !== "production" && !getExplicitAwsCredentials()) {
    console.log(`[email:dev] ${subject} -> ${to}`);
    return { mocked: true };
  }

  const source = `${fromName} <${fromEmail}>`;
  const logoBase64 = getLogoBase64();
  const logoSrc = logoBase64 ? `cid:${LOGO_CID}` : LOGO_FALLBACK_URL;
  const htmlBody = buildProjectEmailHtml({
    title,
    preheader,
    introLines,
    detailRows,
    ctaLabel,
    ctaUrl,
    note,
    logoSrc,
  });
  const textBody = buildProjectEmailText({
    title,
    introLines,
    detailRows,
    ctaLabel,
    ctaUrl,
    note,
  });

  let command;
  if (logoBase64) {
    const rawMessage = buildRawMime({
      from: source,
      to,
      subject,
      textBody,
      htmlBody,
      logoBase64,
    });
    command = new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rawMessage, "utf8") },
    });
  } else {
    command = new SendEmailCommand({
      Source: source,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: textBody, Charset: "UTF-8" },
          Html: { Data: htmlBody, Charset: "UTF-8" },
        },
      },
    });
  }

  try {
    await getSesClient().send(command);
  } catch (error) {
    if (isAwsCredentialError(error)) {
      const err = new Error(
        "Email delivery is unavailable: AWS credentials are not configured on the server",
      );
      err.status = 503;
      err.cause = error;
      throw err;
    }
    throw error;
  }

  return { mocked: false };
}

function projectsUrl(assessmentRef = "") {
  const base = getSiteBaseUrl();
  return assessmentRef ? `${base}/projects/${encodeURIComponent(assessmentRef)}` : `${base}/projects`;
}

export async function sendRequestIntroConfirmationEmail({
  to,
  fullName,
  installerName,
  assessmentRef,
  projectTimeline,
}) {
  return sendBrandedEmail({
    to,
    subject: "SolarVy received your installer introduction request",
    title: "Your installer introduction request is in",
    preheader: "SolarVy has recorded your request and your project team can continue tracking it in your project space.",
    introLines: [
      fullName
        ? `Hello ${fullName},`
        : "Hello,",
      "Thank you for requesting an introduction through SolarVy.",
      "We have recorded your request and the installer or SolarVy team will follow up using the contact details you provided.",
    ],
    detailRows: [
      { label: "Installer", value: installerName || "Matched installer" },
      { label: "Assessment", value: assessmentRef || "Saved in your project space" },
      { label: "Preferred timeline", value: projectTimeline || "Not provided" },
    ],
    ctaLabel: "Open project space",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to see this activity in your project space.",
  });
}

export async function sendExpertReviewConfirmationEmail({
  to,
  fullName,
  installerName,
  assessmentRef,
  reviewType,
  hasAttachment,
}) {
  return sendBrandedEmail({
    to,
    subject: "SolarVy received your expert review request",
    title: "Your expert review request is being prepared",
    preheader: "SolarVy has recorded your expert review request and saved it in your project space.",
    introLines: [
      fullName
        ? `Hello ${fullName},`
        : "Hello,",
      "We have received your expert review request.",
      "Our team can now review the installer information you submitted and any supporting file attached to the request.",
    ],
    detailRows: [
      { label: "Installer", value: installerName || "Installer review" },
      { label: "Assessment", value: assessmentRef || "Saved in your project space" },
      { label: "Review type", value: reviewType || "General review" },
      { label: "Attachment", value: hasAttachment ? "Included" : "Not included" },
    ],
    ctaLabel: "Open project space",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to see this activity in your project space.",
  });
}

export async function sendQuoteUploadConfirmationEmail({
  to,
  fullName,
  fileName,
  assessmentRef,
  location,
}) {
  return sendBrandedEmail({
    to,
    subject: "SolarVy received your uploaded quote",
    title: "Your quote has been uploaded",
    preheader: "SolarVy has saved your uploaded quote and linked it to your project activity.",
    introLines: [
      fullName
        ? `Hello ${fullName},`
        : "Hello,",
      "Your quote upload was received successfully.",
      "You can return to your SolarVy project space to keep track of the project and any next steps around installer review or financing.",
    ],
    detailRows: [
      { label: "File", value: fileName || "Uploaded quote" },
      { label: "Assessment", value: assessmentRef || "Saved in your project space" },
      { label: "Location", value: location || "Not provided" },
    ],
    ctaLabel: "Open project space",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to see this activity in your project space.",
  });
}

export async function sendFinancingConfirmationEmail({
  to,
  fullName,
  reference,
  partnerName,
  routeLabel,
  assessmentRef,
  amountToFinance,
}) {
  return sendBrandedEmail({
    to,
    subject: "SolarVy received your financing enquiry",
    title: "Your financing enquiry is now in progress",
    preheader: "SolarVy has sent your financing enquiry forward and saved the reference in your project space.",
    introLines: [
      fullName
        ? `Hello ${fullName},`
        : "Hello,",
      "Thank you for submitting a financing enquiry through SolarVy.",
      "Your request has been recorded and forwarded through the selected financing path for review.",
    ],
    detailRows: [
      { label: "Reference", value: reference || "Generated" },
      { label: "Partner", value: partnerName || "Financing partner" },
      { label: "Route", value: routeLabel || "Financing route" },
      { label: "Assessment", value: assessmentRef || "Saved in your project space" },
      {
        label: "Amount requested",
        value:
          amountToFinance != null && Number.isFinite(Number(amountToFinance))
            ? `NGN ${Math.round(Number(amountToFinance)).toLocaleString("en-NG")}`
            : "Not provided",
      },
    ],
    ctaLabel: "Open project space",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to keep tracking this enquiry in your project space.",
  });
}

export async function sendRequestIntroStatusUpdateEmail({
  to,
  fullName,
  installerName,
  assessmentRef,
  statusLabel,
}) {
  return sendBrandedEmail({
    to,
    subject: "SolarVy update on your installer introduction request",
    title: "There is an update on your introduction request",
    preheader:
      "SolarVy has recorded a status update on your installer introduction request.",
    introLines: [
      fullName ? `Hello ${fullName},` : "Hello,",
      "There is a new update on the installer introduction you requested through SolarVy.",
      "You can review the latest status any time in your project space.",
    ],
    detailRows: [
      { label: "Installer", value: installerName || "Matched installer" },
      {
        label: "Assessment",
        value: assessmentRef || "Saved in your project space",
      },
      { label: "Current status", value: statusLabel || "Updated" },
    ],
    ctaLabel: "View project update",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to see this activity in your project space.",
  });
}

export async function sendExpertReviewStatusUpdateEmail({
  to,
  fullName,
  installerName,
  assessmentRef,
  statusLabel,
}) {
  return sendBrandedEmail({
    to,
    subject: "SolarVy update on your expert review request",
    title: "There is an update on your expert review",
    preheader:
      "SolarVy has recorded a status update on your expert review request.",
    introLines: [
      fullName ? `Hello ${fullName},` : "Hello,",
      "There is a new update on the expert review you requested through SolarVy.",
      "You can review the latest status any time in your project space.",
    ],
    detailRows: [
      { label: "Installer", value: installerName || "Installer review" },
      {
        label: "Assessment",
        value: assessmentRef || "Saved in your project space",
      },
      { label: "Current status", value: statusLabel || "Updated" },
    ],
    ctaLabel: "View project update",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to see this activity in your project space.",
  });
}

export async function sendQuoteUploadStatusUpdateEmail({
  to,
  fullName,
  fileName,
  assessmentRef,
  statusLabel,
}) {
  return sendBrandedEmail({
    to,
    subject: "SolarVy update on your uploaded quote",
    title: "There is an update on your uploaded quote",
    preheader:
      "SolarVy has recorded a status update on the quote you uploaded.",
    introLines: [
      fullName ? `Hello ${fullName},` : "Hello,",
      "There is a new update on the quote you uploaded through SolarVy.",
      "You can review the latest status any time in your project space.",
    ],
    detailRows: [
      { label: "File", value: fileName || "Uploaded quote" },
      {
        label: "Assessment",
        value: assessmentRef || "Saved in your project space",
      },
      { label: "Current status", value: statusLabel || "Updated" },
    ],
    ctaLabel: "View project update",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to see this activity in your project space.",
  });
}

export async function sendFinancingStatusUpdateEmail({
  to,
  fullName,
  reference,
  partnerName,
  statusLabel,
  assessmentRef,
}) {
  return sendBrandedEmail({
    to,
    subject: `SolarVy financing update: ${reference || "your enquiry"}`,
    title: "There is an update on your financing enquiry",
    preheader: "SolarVy has recorded a financing status update for your project.",
    introLines: [
      fullName
        ? `Hello ${fullName},`
        : "Hello,",
      "There is a new update on your financing enquiry in SolarVy.",
      "Please review the latest status in your project space and continue with any next steps requested by the provider or SolarVy team.",
    ],
    detailRows: [
      { label: "Reference", value: reference || "Financing enquiry" },
      { label: "Partner", value: partnerName || "Financing partner" },
      { label: "Current status", value: statusLabel || "Updated" },
      { label: "Assessment", value: assessmentRef || "Saved in your project space" },
    ],
    ctaLabel: "View project update",
    ctaUrl: projectsUrl(assessmentRef),
    note:
      "If you submitted as a guest, open SolarVy from the same browser and device to see the same project activity.",
  });
}
