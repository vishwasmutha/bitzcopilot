export const TOKEN_KEY = "bc_token";

export function persistToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  const attrs = secure
    ? "Path=/; Max-Age=604800; SameSite=None; Secure"
    : "Path=/; Max-Age=604800; SameSite=Lax";
  document.cookie = `bizcopilot_token=${token}; ${attrs}`;
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = "bizcopilot_token=; Path=/; Max-Age=0";
}

/** Hard navigation so the proxy can attach the httpOnly cookie before the next render. */
export function goSignedIn(token: string, next = "/dashboard") {
  persistToken(token);
  const url = new URL(next, location.origin);
  url.searchParams.set("sid", token);
  window.location.assign(url.pathname + url.search);
}

export function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = readToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function authFetch(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: authHeaders(init.headers),
  });
}
