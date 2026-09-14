export function formatAssessmentId(id) {
  return `SV-${String(id).padStart(4, "0")}`;
}

export function parseAssessmentIdParam(value) {
  if (!value) return NaN;
  const normalized = String(value).trim().toUpperCase();
  const match = normalized.match(/^SV-(\d+)$/);
  if (match) {
    return Number(match[1]);
  }
  return Number(normalized);
}
