/** Page keys assignable to staff admins (matches admin sidemenu). */
export const ADMIN_PAGE_KEYS = [
  "dashboard",
  "users",
  "assessments",
  "financing",
  "leads",
  "excel-template",
  "blogs",
  "blog-analytics",
  "bill-input",
  "recommendations",
];

export const ADMIN_PAGE_KEY_SET = new Set(ADMIN_PAGE_KEYS);

/**
 * Normalize a permissions payload into a unique list of known page keys.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const key = String(item || "").trim();
    if (!ADMIN_PAGE_KEY_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

/**
 * Parse permissions from a DB JSONB value.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parsePermissions(value) {
  if (Array.isArray(value)) return normalizePermissions(value);
  if (typeof value === "string") {
    try {
      return normalizePermissions(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}
