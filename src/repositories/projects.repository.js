import { getPool } from "../config/database.js";
import { formatAssessmentId, parseAssessmentIdParam } from "../utils/assessmentId.js";
import { normalizeFinancingStatus } from "./financingEnquiry.repository.js";
import { isUuid } from "../utils/requestMeta.js";

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function maybeText(value) {
  const trimmed = text(value);
  return trimmed || null;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeProjectLeadStatus(value) {
  const raw = text(value);
  if (
    raw === "submitted" ||
    raw === "in_progress" ||
    raw === "awaiting_customer" ||
    raw === "completed"
  ) {
    return raw;
  }
  return "submitted";
}

function pushTimeline(target, item) {
  if (!item.timestamp) return;
  target.push(item);
}

function byNewest(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function normalizeInstaller(match) {
  if (!match || typeof match !== "object") return null;
  const row = match;
  const installerName = text(row.installerName);
  if (!installerName) return null;
  return {
    installerName,
    cardNumber: toNumberOrNull(row.cardNumber),
    matchPct: toNumberOrNull(row.matchPct),
    matchTier: maybeText(row.matchTier),
    bestSuitedFor: maybeText(row.bestSuitedFor),
    coverage: maybeText(row.coverage),
    strengths: maybeText(row.strengths),
    pricing: maybeText(row.pricing),
    response: maybeText(row.response),
  };
}

function buildAssessmentProject(row) {
  const form = row.form_data || {};
  const results = row.results || {};
  const installers = Array.isArray(results.installerMatches)
    ? results.installerMatches.map(normalizeInstaller).filter(Boolean)
    : [];

  return {
    assessmentId: row.id,
    assessmentRef: formatAssessmentId(row.id),
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
    latestActivityAt: isoOrNull(row.updated_at || row.created_at),
    location: {
      city: maybeText(form.city || results.city),
      state: maybeText(form.state),
      country: maybeText(form.country || results.country),
    },
    propertyType: maybeText(results.propertyType || form.propertyType),
    powerSetup: maybeText(results.powerSetup || form.powerSetup),
    objective: maybeText(results.objective || form.mainObjective),
    inputMethod: maybeText(form.inputMethod),
    snapshot: {
      recommendedSolarKwp: toNumberOrNull(results.recommendedSolarKwp),
      recommendedBatteryKwh: toNumberOrNull(results.recommendedBatteryKwh),
      estimatedSystemCost: toNumberOrNull(results.estimatedSystemCost),
      netAnnualSavings: toNumberOrNull(results.netAnnualSavings),
      simplePaybackYears: toNumberOrNull(results.simplePaybackYears),
      primaryRecommendation: maybeText(results.primaryRecommendation),
      confidenceNote: maybeText(results.confidenceNote),
      calculationError: maybeText(results.calculationError),
    },
    installers: {
      viewedAt: null,
      count: installers.length,
      bestMatch: installers[0] || null,
      items: installers,
    },
    progress: {
      resultsViewed: false,
      pdfDownloaded: false,
      installersViewed: false,
      requestedIntro: false,
      requestedExpertReview: false,
      uploadedQuote: false,
      requestedFinancing: false,
    },
    requestIntros: [],
    expertReviews: [],
    quoteUploads: [],
    financing: [],
    timeline: [],
  };
}

function normalizeRequestIntro(row) {
  return {
    id: row.id,
    installerName: text(row.installer_name) || "Matched installer",
    projectTimeline: maybeText(row.project_timeline),
    email: maybeText(row.email),
    submittedAt: isoOrNull(row.created_at),
    status: normalizeProjectLeadStatus(row.status),
  };
}

function normalizeExpertReview(row) {
  return {
    id: row.id,
    installerName: text(row.installer_name) || "Installer review",
    reviewType: maybeText(row.review_type),
    projectLocation: maybeText(row.project_location),
    hasAttachment: Boolean(text(row.storage_path)),
    submittedAt: isoOrNull(row.created_at),
    status: normalizeProjectLeadStatus(row.status),
  };
}

function normalizeQuoteUpload(row) {
  return {
    id: row.id,
    fileName: text(row.original_name) || "Uploaded quote",
    location: maybeText(row.location),
    submittedAt: isoOrNull(row.created_at),
    status: normalizeProjectLeadStatus(row.status),
  };
}

function normalizeFinancing(row) {
  const status = normalizeFinancingStatus(row.status);
  return {
    id: row.id,
    reference: text(row.reference),
    routeLabel: text(row.route_label),
    partnerName: text(row.partner_name),
    amountToFinance: toNumberOrNull(row.amount_to_finance),
    submittedAt: isoOrNull(row.created_at),
    status,
    statusUpdatedAt: isoOrNull(row.status_updated_at),
  };
}

function applyActivityToProject(project, events) {
  for (const event of events) {
    const eventType = text(event.event_type);
    const createdAt = isoOrNull(event.created_at);
    if (!createdAt) continue;

    if (eventType === "results_viewed" || eventType === "assessment_completed") {
      project.progress.resultsViewed = true;
    }
    if (eventType === "pdf_download") {
      project.progress.pdfDownloaded = true;
    }
    if (eventType === "matched_installers_viewed") {
      project.progress.installersViewed = true;
      if (!project.installers.viewedAt) {
        project.installers.viewedAt = createdAt;
      }
    }
  }
}

function attachProjectActions(project, rowsByType) {
  const intros = rowsByType.requestIntros || [];
  const reviews = rowsByType.expertReviews || [];
  const quotes = rowsByType.quoteUploads || [];
  const financing = rowsByType.financing || [];

  project.requestIntros = intros.map(normalizeRequestIntro).sort(byNewest);
  project.expertReviews = reviews.map(normalizeExpertReview).sort(byNewest);
  project.quoteUploads = quotes.map(normalizeQuoteUpload).sort(byNewest);
  project.financing = financing.map(normalizeFinancing).sort(byNewest);

  project.progress.requestedIntro = project.requestIntros.length > 0;
  project.progress.requestedExpertReview = project.expertReviews.length > 0;
  project.progress.uploadedQuote = project.quoteUploads.length > 0;
  project.progress.requestedFinancing = project.financing.length > 0;

  pushTimeline(project.timeline, {
    kind: "assessment",
    title: "Assessment submitted",
    description: "Your SolarVy assessment was created.",
    timestamp: project.createdAt,
    status: "completed",
  });

  if (project.progress.resultsViewed) {
    pushTimeline(project.timeline, {
      kind: "assessment",
      title: "Results ready",
      description: "Your assessment results were viewed.",
      timestamp: project.updatedAt || project.createdAt,
      status: "completed",
    });
  }

  if (project.progress.installersViewed) {
    pushTimeline(project.timeline, {
      kind: "installers",
      title: "Matched installers viewed",
      description: "You reviewed installers matched to this assessment.",
      timestamp: project.installers.viewedAt,
      status: "completed",
    });
  }

  for (const row of project.requestIntros) {
    pushTimeline(project.timeline, {
      kind: "request_intro",
      title: "Introduction requested",
      description: `SolarVy received your introduction request for ${row.installerName}.`,
      timestamp: row.submittedAt,
      status: row.status,
    });
  }

  for (const row of project.expertReviews) {
    pushTimeline(project.timeline, {
      kind: "expert_review",
      title: "Expert review submitted",
      description: row.installerName
        ? `You requested expert review for ${row.installerName}.`
        : "You requested an expert review.",
      timestamp: row.submittedAt,
      status: row.status,
    });
  }

  for (const row of project.quoteUploads) {
    pushTimeline(project.timeline, {
      kind: "quote_upload",
      title: "Quote uploaded",
      description: `${row.fileName} was added for this project.`,
      timestamp: row.submittedAt,
      status: row.status,
    });
  }

  for (const row of project.financing) {
    pushTimeline(project.timeline, {
      kind: "financing",
      title: "Financing enquiry submitted",
      description: row.reference
        ? `Reference ${row.reference} is currently ${row.status.replace(/_/g, " ")}.`
        : `Financing is currently ${row.status.replace(/_/g, " ")}.`,
      timestamp: row.statusUpdatedAt || row.submittedAt,
      status: row.status,
      reference: row.reference,
    });
  }

  project.timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const latestTimelineAt = project.timeline[0]?.timestamp || null;
  project.latestActivityAt = latestTimelineAt || project.latestActivityAt;
  project.latestFinancingStatus = project.financing[0]?.status || null;
}

function buildOtherActions(rowsByType, assessmentIds) {
  const withoutAssessment = (row) => !assessmentIds.has(Number(row.assessment_id || 0));

  return {
    requestIntros: (rowsByType.requestIntros || [])
      .filter((row) => !row.assessment_id || withoutAssessment(row))
      .map(normalizeRequestIntro)
      .sort(byNewest),
    expertReviews: (rowsByType.expertReviews || [])
      .filter((row) => !row.assessment_id || withoutAssessment(row))
      .map(normalizeExpertReview)
      .sort(byNewest),
    quoteUploads: (rowsByType.quoteUploads || [])
      .filter((row) => !row.assessment_id || withoutAssessment(row))
      .map(normalizeQuoteUpload)
      .sort(byNewest),
    financing: (rowsByType.financing || [])
      .filter((row) => !row.assessment_id || withoutAssessment(row))
      .map(normalizeFinancing)
      .sort(byNewest),
  };
}

async function getVisitorIdsForUser(pool, userId) {
  if (!isUuid(userId)) return [];
  const res = await pool.query(
    `SELECT id FROM visitors WHERE user_id = $1`,
    [userId],
  );
  return res.rows.map((r) => r.id).filter(isUuid);
}

export async function resolveProjectsViewer({ visitorId = null, userId = null } = {}) {
  const pool = getPool();

  if (isUuid(visitorId)) {
    const direct = await pool.query(
      `SELECT v.id, v.user_id, v.last_seen_at, u.full_name, u.email
       FROM visitors v
       LEFT JOIN users u ON u.id = v.user_id
       WHERE v.id = $1`,
      [visitorId],
    );
    const row = direct.rows[0];
    if (row && (!userId || !row.user_id || row.user_id === userId)) {
      // Prefer the account link on the visitor; otherwise honour an authenticated session.
      const resolvedUserId = row.user_id || (isUuid(userId) ? userId : null);

      if (resolvedUserId) {
        // Account viewer: aggregate activity across every browser/device the user has used.
        const visitorIds = await getVisitorIdsForUser(pool, resolvedUserId);
        if (!visitorIds.includes(row.id)) visitorIds.push(row.id);
        return {
          visitorId: row.id,
          visitorIds,
          userId: resolvedUserId,
          fullName: maybeText(row.full_name),
          email: maybeText(row.email),
          kind: "account",
          scope: "account",
          isGuest: false,
        };
      }

      // Guest viewer: scoped to just this browser/visitor.
      return {
        visitorId: row.id,
        visitorIds: [row.id],
        userId: null,
        fullName: maybeText(row.full_name),
        email: maybeText(row.email),
        kind: "guest",
        scope: "current_browser",
        isGuest: true,
      };
    }
  }

  if (!isUuid(userId)) return null;

  // Authenticated session with no matching visitor on this browser yet:
  // still aggregate across all of the user's known visitors.
  const linked = await pool.query(
    `SELECT v.id, v.user_id, v.last_seen_at, u.full_name, u.email
     FROM visitors v
     JOIN users u ON u.id = v.user_id
     WHERE v.user_id = $1
     ORDER BY v.last_seen_at DESC NULLS LAST, v.created_at DESC`,
    [userId],
  );
  const row = linked.rows[0];
  if (!row) return null;
  const visitorIds = linked.rows.map((r) => r.id).filter(isUuid);
  return {
    visitorId: row.id,
    visitorIds,
    userId: row.user_id || userId,
    fullName: maybeText(row.full_name),
    email: maybeText(row.email),
    kind: "account",
    scope: "account",
    isGuest: false,
  };
}

function emptyWorkspace() {
  return {
    summary: {
      totalProjects: 0,
      totalRequestIntros: 0,
      totalExpertReviews: 0,
      totalQuoteUploads: 0,
      totalFinancingEnquiries: 0,
    },
    projects: [],
    otherActions: {
      requestIntros: [],
      expertReviews: [],
      quoteUploads: [],
      financing: [],
    },
  };
}

/** Backward-compatible single-visitor entry point. */
export async function listProjectsForVisitor(visitorId) {
  return listProjectsForVisitors(isUuid(visitorId) ? [visitorId] : []);
}

export async function listProjectsForVisitors(visitorIds) {
  const ids = Array.isArray(visitorIds)
    ? Array.from(new Set(visitorIds.filter(isUuid)))
    : [];

  if (ids.length === 0) {
    return emptyWorkspace();
  }

  const pool = getPool();
  const [
    assessmentsRes,
    requestIntrosRes,
    expertReviewsRes,
    quoteUploadsRes,
    financingRes,
    activityRes,
  ] = await Promise.all([
    pool.query(
      `SELECT id, form_data, results, created_at, updated_at
       FROM assessments
       WHERE visitor_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids],
    ),
    pool.query(
      `SELECT *
       FROM request_intros
       WHERE visitor_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids],
    ),
    pool.query(
      `SELECT *
       FROM expert_reviews
       WHERE visitor_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids],
    ),
    pool.query(
      `SELECT *
       FROM quote_uploads
       WHERE visitor_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids],
    ),
    pool.query(
      `SELECT *
       FROM financing_enquiries
       WHERE visitor_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids],
    ),
    pool.query(
      `SELECT *
       FROM activity_events
       WHERE visitor_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids],
    ),
  ]);

  const projects = assessmentsRes.rows.map(buildAssessmentProject);
  const projectById = new Map(projects.map((project) => [project.assessmentId, project]));
  const assessmentIds = new Set(projects.map((project) => project.assessmentId));

  const activityByAssessment = new Map();
  for (const event of activityRes.rows) {
    const metadata = event.metadata || {};
    const eventAssessmentId =
      parseAssessmentIdParam(event.entity_type === "assessment" ? event.entity_id : metadata.assessmentId);
    if (!Number.isFinite(eventAssessmentId)) continue;
    const list = activityByAssessment.get(eventAssessmentId) || [];
    list.push(event);
    activityByAssessment.set(eventAssessmentId, list);
  }

  const rowsByType = {
    requestIntros: requestIntrosRes.rows,
    expertReviews: expertReviewsRes.rows,
    quoteUploads: quoteUploadsRes.rows,
    financing: financingRes.rows,
  };

  for (const project of projects) {
    applyActivityToProject(project, activityByAssessment.get(project.assessmentId) || []);

    attachProjectActions(project, {
      requestIntros: requestIntrosRes.rows.filter(
        (row) => Number(row.assessment_id) === project.assessmentId,
      ),
      expertReviews: expertReviewsRes.rows.filter(
        (row) => Number(row.assessment_id) === project.assessmentId,
      ),
      quoteUploads: quoteUploadsRes.rows.filter(
        (row) => Number(row.assessment_id) === project.assessmentId,
      ),
      financing: financingRes.rows.filter(
        (row) => Number(row.assessment_id) === project.assessmentId,
      ),
    });
  }

  projects.sort(
    (a, b) =>
      new Date(b.latestActivityAt || b.createdAt || 0).getTime() -
      new Date(a.latestActivityAt || a.createdAt || 0).getTime(),
  );

  return {
    summary: {
      totalProjects: projects.length,
      totalRequestIntros: requestIntrosRes.rows.length,
      totalExpertReviews: expertReviewsRes.rows.length,
      totalQuoteUploads: quoteUploadsRes.rows.length,
      totalFinancingEnquiries: financingRes.rows.length,
    },
    projects,
    otherActions: buildOtherActions(rowsByType, assessmentIds),
  };
}
