import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

let sesClient = null;

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

function getEmailAssetBaseUrl() {
  const override = process.env.EMAIL_ASSET_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");

  const fromEnv = process.env.FRONTEND_URL || "";
  const origins = fromEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const httpsOrigin = origins.find((o) => /^https:\/\//i.test(o));
  if (httpsOrigin) return httpsOrigin.replace(/\/$/, "");
  if (origins[0]) return origins[0].replace(/\/$/, "");
  return "https://solarvy.ng";
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

function buildOtpHtml({ code, purpose }) {
  const action =
    purpose === "login"
      ? "log in to SolarVy"
      : "finish creating your SolarVy account";
  const title =
    purpose === "login" ? "Your login code" : "Verify your email";
  const logoUrl = `${getEmailAssetBaseUrl()}/email-logo.png`;
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
              <img src="${logoUrl}" alt="SolarVy" width="140" height="42" style="display: inline-block; max-width: 140px; height: auto; border: 0;" />
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
  const command = new SendEmailCommand({
    Source: source,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: {
          Data: `SolarVy verification code: ${code}\n\nUse this code to ${
            purpose === "login"
              ? "log in to SolarVy"
              : "finish creating your SolarVy account"
          }. It expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.\n\nhttps://solarvy.ng`,
          Charset: "UTF-8",
        },
        Html: {
          Data: buildOtpHtml({ code, purpose }),
          Charset: "UTF-8",
        },
      },
    },
  });

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
