/**
 * Shared status vocabulary for customer "project actions"
 * (request intros, expert reviews, quote uploads).
 *
 * Kept in sync with the frontend PROJECT_ACTION_STATUS_LABELS in
 * Frontend/src/lib/adminApi.ts.
 */

export const PROJECT_ACTION_STATUSES = [
  "submitted",
  "in_progress",
  "awaiting_customer",
  "completed",
];

export function normalizeProjectActionStatus(status) {
  const raw = String(status || "").trim();
  return PROJECT_ACTION_STATUSES.includes(raw) ? raw : "submitted";
}

/** Customer-facing labels used in status update emails. */
export const PROJECT_ACTION_STATUS_EMAIL_LABELS = {
  submitted: "Received",
  in_progress: "In progress",
  awaiting_customer: "Action needed from you",
  completed: "Completed",
};

export function projectActionStatusEmailLabel(status) {
  const normalized = normalizeProjectActionStatus(status);
  return (
    PROJECT_ACTION_STATUS_EMAIL_LABELS[normalized] ||
    String(normalized).replace(/_/g, " ")
  );
}
