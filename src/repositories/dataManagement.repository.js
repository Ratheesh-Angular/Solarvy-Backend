import { getPool } from "../config/database.js";
import { deleteStoredFile } from "../services/fileStorage.service.js";

export const DATA_CLEAR_CATEGORIES = [
  "users",
  "guests",
  "assessments",
  "financing",
  "leads",
];

export async function getDataManagementCounts() {
  const pool = getPool();
  const [users, guests, assessments, financing, leads] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM users`),
    pool.query(`SELECT COUNT(*)::int AS count FROM visitors`),
    pool.query(`SELECT COUNT(*)::int AS count FROM assessments`),
    pool.query(`SELECT COUNT(*)::int AS count FROM financing_enquiries`),
    pool.query(
      `SELECT (
         (SELECT COUNT(*)::int FROM request_intros) +
         (SELECT COUNT(*)::int FROM expert_reviews) +
         (SELECT COUNT(*)::int FROM contact_messages) +
         (SELECT COUNT(*)::int FROM quote_uploads)
       ) AS count`,
    ),
  ]);

  return {
    users: users.rows[0]?.count ?? 0,
    guests: guests.rows[0]?.count ?? 0,
    assessments: assessments.rows[0]?.count ?? 0,
    financing: financing.rows[0]?.count ?? 0,
    leads: leads.rows[0]?.count ?? 0,
  };
}

async function clearUsers(client) {
  await client.query(`UPDATE visitors SET user_id = NULL WHERE user_id IS NOT NULL`);
  const otps = await client.query(`DELETE FROM email_otps`);
  const users = await client.query(`DELETE FROM users`);
  return {
    emailOtps: otps.rowCount ?? 0,
    users: users.rowCount ?? 0,
  };
}

async function clearGuests(client) {
  const events = await client.query(`DELETE FROM activity_events`);
  const sessions = await client.query(`DELETE FROM visitor_sessions`);
  const visitors = await client.query(`DELETE FROM visitors`);
  return {
    activityEvents: events.rowCount ?? 0,
    visitorSessions: sessions.rowCount ?? 0,
    visitors: visitors.rowCount ?? 0,
  };
}

async function clearAssessments(client) {
  const assessments = await client.query(`DELETE FROM assessments`);
  const drafts = await client.query(`DELETE FROM assessment_drafts`);
  return {
    assessments: assessments.rowCount ?? 0,
    assessmentDrafts: drafts.rowCount ?? 0,
  };
}

async function clearFinancing(client) {
  const financing = await client.query(`DELETE FROM financing_enquiries`);
  return {
    financingEnquiries: financing.rowCount ?? 0,
  };
}

async function clearLeads(client) {
  const pathsResult = await client.query(
    `SELECT storage_path AS path FROM expert_reviews WHERE storage_path <> ''
     UNION ALL
     SELECT storage_path AS path FROM quote_uploads WHERE storage_path <> ''`,
  );
  const storagePaths = pathsResult.rows
    .map((row) => String(row.path || "").trim())
    .filter(Boolean);

  const requestIntros = await client.query(`DELETE FROM request_intros`);
  const expertReviews = await client.query(`DELETE FROM expert_reviews`);
  const contactMessages = await client.query(`DELETE FROM contact_messages`);
  const quoteUploads = await client.query(`DELETE FROM quote_uploads`);

  return {
    storagePaths,
    deleted: {
      requestIntros: requestIntros.rowCount ?? 0,
      expertReviews: expertReviews.rowCount ?? 0,
      contactMessages: contactMessages.rowCount ?? 0,
      quoteUploads: quoteUploads.rowCount ?? 0,
    },
  };
}

/**
 * @param {"users"|"guests"|"assessments"|"financing"|"leads"} category
 */
export async function clearDataCategory(category) {
  if (!DATA_CLEAR_CATEGORIES.includes(category)) {
    const err = new Error("Unknown data category");
    err.status = 400;
    throw err;
  }

  const pool = getPool();
  const client = await pool.connect();
  let leadStoragePaths = [];

  try {
    await client.query("BEGIN");

    let deleted;
    if (category === "users") {
      deleted = await clearUsers(client);
    } else if (category === "guests") {
      deleted = await clearGuests(client);
    } else if (category === "assessments") {
      deleted = await clearAssessments(client);
    } else if (category === "financing") {
      deleted = await clearFinancing(client);
    } else {
      const leadResult = await clearLeads(client);
      leadStoragePaths = leadResult.storagePaths;
      deleted = leadResult.deleted;
    }

    await client.query("COMMIT");

    let filesDeleted = 0;
    if (category === "leads") {
      for (const storagePath of leadStoragePaths) {
        try {
          if (await deleteStoredFile(storagePath)) {
            filesDeleted += 1;
          }
        } catch (error) {
          console.warn(
            "[data-management] failed to delete file",
            storagePath,
            error.message || error,
          );
        }
      }
      deleted = { ...deleted, filesDeleted };
    }

    return { category, deleted };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}
