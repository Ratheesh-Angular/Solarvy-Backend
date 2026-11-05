import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

let sesClient = null;

function getSesClient() {
  if (sesClient) return sesClient;
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  sesClient = new SESClient({ region });
  return sesClient;
}

function isSesConfigured() {
  return Boolean(process.env.SES_FROM_EMAIL?.trim());
}

function buildOtpHtml({ code, purpose }) {
  const action =
    purpose === "login" ? "log in to SolarVy" : "finish creating your SolarVy account";
  return `<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; color: #1a2259; background: #f7f9fc; padding: 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e8edf5;">
      <tr>
        <td style="padding: 28px 24px;">
          <h1 style="margin: 0 0 12px; font-size: 20px;">SolarVy verification code</h1>
          <p style="margin: 0 0 16px; color: #5a6478; font-size: 14px;">
            Use this code to ${action}. It expires in 10 minutes.
          </p>
          <p style="margin: 0 0 8px; font-size: 32px; letter-spacing: 8px; font-weight: 700;">
            ${code}
          </p>
          <p style="margin: 24px 0 0; color: #8a93a6; font-size: 12px;">
            If you did not request this, you can ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Send a 6-digit OTP via AWS SES.
 * In non-production, if SES is not configured, logs the code and returns { mocked: true }.
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

  const source = `${fromName} <${fromEmail}>`;
  const command = new SendEmailCommand({
    Source: source,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: {
          Data: `Your SolarVy code is ${code}. It expires in 10 minutes.`,
          Charset: "UTF-8",
        },
        Html: {
          Data: buildOtpHtml({ code, purpose }),
          Charset: "UTF-8",
        },
      },
    },
  });

  await getSesClient().send(command);
  return { mocked: false };
}
