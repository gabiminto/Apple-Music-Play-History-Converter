import { SignJWT, importPKCS8 } from "jose";

const APPLE_MUSIC_BASE_URL = "https://api.music.apple.com/v1";
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

let cachedDeveloperToken: { token: string; exp: number } | null = null;
let cachedSigningKey: Promise<CryptoKey> | null = null;

export interface Env {
  APPLE_MUSIC_TEAM_ID: string;
  APPLE_MUSIC_KEY_ID: string;
  APPLE_MUSIC_PRIVATE_KEY: string;
  PROXY_ACCESS_KEY?: string;
  PROXY_ENABLED?: string;
  REQUESTS_PER_MINUTE?: string;
  DEVELOPER_TOKEN_TTL_SECONDS?: string;
  RATE_LIMITER: DurableObjectNamespace;
}

type JsonValue = Record<string, unknown> | unknown[];

function jsonResponse(body: JsonValue, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function normalizeStorefront(storefront: string | null | undefined): string {
  const normalized = (storefront ?? "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : "us";
}

export function sanitizeLimit(limitRaw: string | null | undefined): number {
  const parsed = Number.parseInt((limitRaw ?? "").trim(), 10);
  if (Number.isNaN(parsed)) {
    return 5;
  }
  return Math.max(1, Math.min(25, parsed));
}

export function parseIsrcCodes(codesRaw: string | null | undefined): string[] {
  if (!codesRaw) {
    return [];
  }

  const unique = new Set<string>();
  for (const raw of codesRaw.split(",")) {
    const normalized = raw.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (ISRC_PATTERN.test(normalized)) {
      unique.add(normalized);
    }
    if (unique.size >= 25) {
      break;
    }
  }

  return [...unique];
}

export function shouldRequireProxyKey(proxyKey: string | null | undefined): boolean {
  return (proxyKey ?? "").trim().length > 0;
}

function parseBoundedInt(
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizePem(pemRaw: string): string {
  return pemRaw.includes("\\n") ? pemRaw.replace(/\\n/g, "\n") : pemRaw;
}

async function getSigningKey(env: Env): Promise<CryptoKey> {
  if (!cachedSigningKey) {
    cachedSigningKey = importPKCS8(normalizePem(env.APPLE_MUSIC_PRIVATE_KEY), "ES256");
  }
  return cachedSigningKey;
}

async function getDeveloperToken(env: Env, forceRefresh = false): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && cachedDeveloperToken && now < (cachedDeveloperToken.exp - 60)) {
    return cachedDeveloperToken.token;
  }

  const ttlSeconds = parseBoundedInt(
    env.DEVELOPER_TOKEN_TTL_SECONDS,
    3600,
    300,
    180 * 24 * 60 * 60,
  );
  const exp = now + ttlSeconds;

  const privateKey = await getSigningKey(env);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_MUSIC_KEY_ID })
    .setIssuer(env.APPLE_MUSIC_TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);

  cachedDeveloperToken = { token, exp };
  return token;
}

function isProxyEnabled(env: Env): boolean {
  return (env.PROXY_ENABLED ?? "true").toLowerCase() !== "false";
}

function isProxyAuthorized(request: Request, env: Env): boolean {
  if (!shouldRequireProxyKey(env.PROXY_ACCESS_KEY)) {
    return true;
  }
  return request.headers.get("x-proxy-key") === env.PROXY_ACCESS_KEY;
}

async function applyRateLimit(request: Request, env: Env): Promise<Response | null> {
  const limit = parseBoundedInt(env.REQUESTS_PER_MINUTE, 120, 10, 5000);
  if (!env.RATE_LIMITER || limit <= 0) {
    return null;
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const id = env.RATE_LIMITER.idFromName("global");
  const stub = env.RATE_LIMITER.get(id);
  const checkResponse = await stub.fetch("https://rate-limit/check", {
    method: "POST",
    body: JSON.stringify({ ip, limit }),
  });

  if (!checkResponse.ok) {
    // Fail open if limiter has issues.
    return null;
  }

  const payload = (await checkResponse.json()) as {
    allowed: boolean;
    remaining: number;
    resetMs: number;
  };
  if (payload.allowed) {
    return null;
  }

  return jsonResponse(
    {
      error: "rate_limited",
      message: "Too many requests",
      resetMs: payload.resetMs,
    },
    429,
    {
      "retry-after": String(Math.max(1, Math.ceil(payload.resetMs / 1000))),
    },
  );
}

async function fetchAppleMusic(pathWithQuery: string, env: Env): Promise<Response> {
  const token = await getDeveloperToken(env);
  const headers = new Headers({
    authorization: `Bearer ${token}`,
  });

  let upstream = await fetch(`${APPLE_MUSIC_BASE_URL}${pathWithQuery}`, {
    method: "GET",
    headers,
  });

  if (upstream.status === 401) {
    const refreshed = await getDeveloperToken(env, true);
    headers.set("authorization", `Bearer ${refreshed}`);
    upstream = await fetch(`${APPLE_MUSIC_BASE_URL}${pathWithQuery}`, {
      method: "GET",
      headers,
    });
  }

  const bodyText = await upstream.text();
  if (!upstream.ok) {
    return jsonResponse(
      {
        error: "apple_music_upstream_error",
        status: upstream.status,
        details: bodyText.slice(0, 1000),
      },
      upstream.status,
    );
  }

  return new Response(bodyText, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120",
    },
  });
}

async function handleSearch(url: URL, env: Env): Promise<Response> {
  const term = (url.searchParams.get("term") ?? "").trim();
  if (!term) {
    return jsonResponse({ error: "Missing query parameter: term" }, 400);
  }

  const storefront = normalizeStorefront(url.searchParams.get("storefront"));
  const types = (url.searchParams.get("types") ?? "songs").trim() || "songs";
  const limit = sanitizeLimit(url.searchParams.get("limit"));

  const params = new URLSearchParams({
    term,
    types,
    limit: String(limit),
  });

  return fetchAppleMusic(`/catalog/${storefront}/search?${params.toString()}`, env);
}

async function handleIsrc(url: URL, env: Env): Promise<Response> {
  const storefront = normalizeStorefront(url.searchParams.get("storefront"));
  const isrcCodes = parseIsrcCodes(url.searchParams.get("codes"));
  if (isrcCodes.length === 0) {
    return jsonResponse({ error: "Missing or invalid query parameter: codes" }, 400);
  }

  const params = new URLSearchParams({
    "filter[isrc]": isrcCodes.join(","),
  });
  return fetchAppleMusic(`/catalog/${storefront}/songs?${params.toString()}`, env);
}

async function handleSongLookup(pathname: string, url: URL, env: Env): Promise<Response> {
  const storefront = normalizeStorefront(url.searchParams.get("storefront"));
  const songId = pathname.replace(/^\/v1\/songs\//, "").trim();
  if (!songId) {
    return jsonResponse({ error: "Missing song id" }, 400);
  }
  return fetchAppleMusic(`/catalog/${storefront}/songs/${songId}`, env);
}

async function handleAlbumLookup(pathname: string, url: URL, env: Env): Promise<Response> {
  const storefront = normalizeStorefront(url.searchParams.get("storefront"));
  const albumId = pathname.replace(/^\/v1\/albums\//, "").trim();
  if (!albumId) {
    return jsonResponse({ error: "Missing album id" }, 400);
  }
  return fetchAppleMusic(`/catalog/${storefront}/albums/${albumId}?include=tracks`, env);
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    if (!isProxyEnabled(env)) {
      return jsonResponse({ error: "Proxy disabled" }, 503);
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "apple-music-proxy" });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    if (!isProxyAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const limited = await applyRateLimit(request, env);
    if (limited) {
      return limited;
    }

    if (url.pathname === "/v1/search") {
      return handleSearch(url, env);
    }
    if (url.pathname === "/v1/isrc") {
      return handleIsrc(url, env);
    }
    if (url.pathname.startsWith("/v1/songs/")) {
      return handleSongLookup(url.pathname, url, env);
    }
    if (url.pathname.startsWith("/v1/albums/")) {
      return handleAlbumLookup(url.pathname, url, env);
    }
    if (url.pathname === "/v1/test") {
      return fetchAppleMusic("/catalog/us/search?term=beatles&types=songs&limit=1", env);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};

export class RateLimiterDO {
  private readonly counts = new Map<string, number>();
  private currentMinute = -1;

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const payload = (await request.json()) as { ip?: string; limit?: number };
    const ip = (payload.ip ?? "unknown").trim();
    const limit = typeof payload.limit === "number" ? payload.limit : 120;

    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    if (currentMinute !== this.currentMinute) {
      this.counts.clear();
      this.currentMinute = currentMinute;
    }
    const key = `${ip}:${currentMinute}`;

    const currentCount = this.counts.get(key) ?? 0;
    const nextCount = currentCount + 1;
    this.counts.set(key, nextCount);

    const resetMs = 60000 - (now % 60000);
    const allowed = nextCount <= limit;
    const remaining = Math.max(0, limit - nextCount);
    return jsonResponse({ allowed, remaining, resetMs });
  }
}

export default worker;
