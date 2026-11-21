const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 4000;

const EMPTY_GEO = {
  ipCountry: "",
  ipRegion: "",
  ipCity: "",
  country: "",
  region: "",
  city: "",
  latitude: null,
  longitude: null,
};

function isPrivateIp(ip) {
  const value = String(ip || "").replace(/^::ffff:/, "");
  if (!value || value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("10.")) return true;
  if (value.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  return false;
}

function toCoord(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeGeo({
  country = "",
  region = "",
  city = "",
  latitude = null,
  longitude = null,
} = {}) {
  const countryName = String(country || "").slice(0, 120);
  const regionName = String(region || "").slice(0, 120);
  const cityName = String(city || "").slice(0, 120);
  return {
    ipCountry: countryName,
    ipRegion: regionName,
    ipCity: cityName,
    country: countryName,
    region: regionName,
    city: cityName,
    latitude: toCoord(latitude),
    longitude: toCoord(longitude),
  };
}

function hasLocation(data) {
  return Boolean(data?.country || data?.region || data?.city);
}

/** Prefer full region names over two-letter codes when the API exposes both. */
function pickRegionName(region, regionName, regionCode) {
  const primary = String(region || "").trim();
  const fullName = String(regionName || "").trim();
  const code = String(regionCode || "").trim();
  if (primary.length > 2) return primary;
  if (fullName.length > 2) return fullName;
  return primary || code;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`IP geo lookup failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function primaryLookupUrl(ip) {
  const configured = process.env.IP_GEO_API_URL?.trim();
  if (configured) {
    const base = configured.replace(/\/$/, "");
    // Legacy ipapi.co-style base: {base}/{ip}/json/
    if (/ipapi\.co/i.test(base)) {
      return `${base}/${encodeURIComponent(ip)}/json/`;
    }
    // Generic base ending with host only → treat as ipwho-style {base}/{ip}
    return `${base}/${encodeURIComponent(ip)}`;
  }
  return `https://ipwho.is/${encodeURIComponent(ip)}`;
}

async function lookupPrimary(ip) {
  const json = await fetchJson(primaryLookupUrl(ip));

  // ipapi.co shape
  if (json && (json.country_name || json.country) && !("success" in json)) {
    if (json.error) {
      throw new Error(json.reason || "IP geo error");
    }
    return normalizeGeo({
      country: json.country_name || json.country,
      region: pickRegionName(json.region, json.regionName, json.region_code),
      city: json.city,
      latitude: json.latitude,
      longitude: json.longitude,
    });
  }

  // ipwho.is shape
  if (json && json.success === false) {
    throw new Error(json.message || "ipwho.is lookup failed");
  }
  return normalizeGeo({
    country: json.country || json.country_name,
    region: pickRegionName(json.region, json.regionName, json.region_code),
    city: json.city,
    latitude: json.latitude ?? json.lat,
    longitude: json.longitude ?? json.lon,
  });
}

async function lookupIpApiFallback(ip) {
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,lat,lon`;
  const json = await fetchJson(url);
  if (!json || json.status !== "success") {
    throw new Error(json?.message || "ip-api.com lookup failed");
  }
  return normalizeGeo({
    country: json.country,
    region: json.regionName,
    city: json.city,
    latitude: json.lat,
    longitude: json.lon,
  });
}

/**
 * Resolve country / region / city from client IP.
 * Primary: IP_GEO_API_URL override or ipwho.is; fallback: ip-api.com.
 */
export async function lookupIpGeolocation(ip) {
  const cleanIp = String(ip || "")
    .replace(/^::ffff:/, "")
    .trim();

  if (!cleanIp || isPrivateIp(cleanIp)) {
    return { ...EMPTY_GEO };
  }

  const cached = cache.get(cleanIp);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    let data = null;
    try {
      data = await lookupPrimary(cleanIp);
    } catch (error) {
      console.warn("[ip-geo] primary", error.message || error);
    }

    if (!hasLocation(data)) {
      try {
        data = await lookupIpApiFallback(cleanIp);
      } catch (error) {
        console.warn("[ip-geo] fallback", error.message || error);
      }
    }

    if (!hasLocation(data)) {
      return { ...EMPTY_GEO };
    }

    cache.set(cleanIp, { at: Date.now(), data });
    return data;
  } catch (error) {
    console.warn("[ip-geo]", error.message || error);
    return { ...EMPTY_GEO };
  }
}
