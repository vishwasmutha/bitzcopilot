// Run with: npm run test:math
import assert from "node:assert/strict";
import * as e from "../src/lib/llm-errors.ts";

assert.match(e.explainLlmFailure("gemini", 400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').hint, /key was rejected/, "Gemini reports a bad key as 400");
assert.match(e.explainLlmFailure("openai", 401, "Incorrect API key provided").hint, /key was rejected/);
assert.match(e.explainLlmFailure("gemini", 403, "").hint, /key was rejected/);
assert.match(e.explainLlmFailure("gemini", 404, "models/gemini-2.0-flash is no longer available").hint, /GEMINI_MODEL/, "a retired model points at the env var");
assert.match(e.explainLlmFailure("openai", 404, "The model does not exist").hint, /OPENAI_MODEL/);
assert.match(e.explainLlmFailure("gemini", 429, "RESOURCE_EXHAUSTED quota").hint, /quota or rate limit/);
assert.match(e.explainLlmFailure("openai", 503, "").hint, /provider is having a problem/i);
assert.match(e.explainLlmFailure("gemini", 400, "unsupported value").hint, /rejected the request/);
assert.match(e.explainLlmFailure("openai", 418, "teapot").hint, /HTTP 418/);

// Snippets never echo a key back
const leaked = 'Invalid key=AIzaSyA1234567890abcdefghijklmnopqrstu in request, Bearer sk-abcdefghijklmnopqrstuvwx';
const s = e.safeSnippet(leaked);
assert.ok(!s.includes("AIzaSy") && !s.includes("sk-abcdef"), "keys are hidden: " + s);
assert.equal(e.safeSnippet("a".repeat(500), 50).length, 51, "long text is trimmed");
assert.equal(e.safeSnippet(""), "");

console.log("llm-errors: all checks passed");
