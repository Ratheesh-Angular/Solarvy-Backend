/** Normalize Nigeria phone to E.164 (+234XXXXXXXXXX). */
export function normalizeNigeriaPhone(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("234")) {
    digits = digits.slice(3);
  }
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!/^\d{10}$/.test(digits)) {
    return null;
  }

  return `+234${digits}`;
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}
