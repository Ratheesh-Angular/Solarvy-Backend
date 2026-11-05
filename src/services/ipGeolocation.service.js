const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function isPrivateIp(ip) {
  const value = String(ip || "").replace(/^::ffff:/, "");
  if (!value || value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("10.")) return true;
  if (value.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  return false;
}

/**
 * Resolve country / region / city from client IP.
 * Uses ipapi.co by default (no key required for light use).
 */
export async function lookupIpGeolocation(ip) {
  const cleanIp = String(ip || "")
    .replace(/^::ffff:/, "")
    .trim();

  if (!cleanIp || isPrivateIp(cleanIp)) {
    return {
      ipCountry: "",
      ipRegion: "",
      ipCity: "",
      country: "",
      region: "",
      city: "",
      latitude: null,
      longitude: null,
    };
  }

  const cached = cache.get(cleanIp);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const baseUrl =
    process.env.IP_GEO_API_URL?.trim() || "https://ipapi.co";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${baseUrl}/${encodeURIComponent(cleanIp)}/json/`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`IP geo lookup failed: ${response.status}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(json.reason || "IP geo error");
    }

    const data = {
      ipCountry: String(json.country_name || json.country || "").slice(0, 120),
      ipRegion: String(json.region || json.region_code || "").slice(0, 120),
      ipCity: String(json.city || "").slice(0, 120),
      country: String(json.country_name || json.country || "").slice(0, 120),
      region: String(json.region || "").slice(0, 120),
      city: String(json.city || "").slice(0, 120),
      latitude:
        typeof json.latitude === "number"
          ? json.latitude
          : Number.isFinite(Number(json.latitude))
            ? Number(json.latitude)
            : null,
      longitude:
        typeof json.longitude === "number"
          ? json.longitude
          : Number.isFinite(Number(json.longitude))
            ? Number(json.longitude)
            : null,
    };

    cache.set(cleanIp, { at: Date.now(), data });
    return data;
  } catch (error) {
    console.warn("[ip-geo]", error.message || error);
    return {
      ipCountry: "",
      ipRegion: "",
      ipCity: "",
      country: "",
      region: "",
      city: "",
      latitude: null,
      longitude: null,
    };
  }
}
