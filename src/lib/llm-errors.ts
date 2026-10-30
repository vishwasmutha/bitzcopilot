/* Plain-language reasons for a failed model call. No imports, so it can be tested on its own. */

export type LlmFailure = { status: number; hint: string };

/** Turns an HTTP status and the provider's error text into something the owner can act on. */
export function explainLlmFailure(provider: "openai" | "gemini", status: number, body: string): LlmFailure {
  const text = (body || "").toLowerCase();
  const modelVar = provider === "gemini" ? "GEMINI_MODEL" : "OPENAI_MODEL";
  let hint: string;
  if (status === 401 || status === 403 || /api key not valid|invalid api key|permission denied|incorrect api key/.test(text)) {
    hint = "The key was rejected. Check it was copied in full, has no spaces or quotes, and is enabled for this API.";
  } else if (status === 404 || /not found|no longer available|is not supported|deprecated/.test(text)) {
    hint = `The model was not found or has been retired. Set ${modelVar} in .env.local to a model your key can use.`;
  } else if (status === 429 || /quota|rate limit|resource_exhausted|too many requests/.test(text)) {
    hint = "The free quota or rate limit was reached. Wait a minute and try again, or use another key.";
  } else if (status === 400) {
    hint = `The provider rejected the request. This is often a wrong ${modelVar} or an unsupported setting.`;
  } else if (status >= 500) {
    hint = "The provider is having a problem. Try again shortly.";
  } else {
    hint = `The provider returned HTTP ${status}.`;
  }
  return { status, hint };
}

/** First readable line of a provider error body, with anything that looks like a key removed. */
export function safeSnippet(body: string, max = 160): string {
  const clean = (body || "")
    .replace(/(key|token|bearer)[=:\s"']+[A-Za-z0-9._-]{16,}/gi, "$1=[hidden]")
    .replace(/\b(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}
