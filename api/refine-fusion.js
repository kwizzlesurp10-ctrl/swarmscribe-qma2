/**
 * Optional serverless refine step.
 * Priority: OpenRouter (OPENROUTER_API_KEY) → OpenAI (OPENAI_API_KEY / FUSION_REFINE_API_KEY).
 * Degrades with 501 when no key — client shows a local-only toast.
 */

const MAX_PROMPT_CHARS = 24_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateByIp = new Map();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_REFERER = "https://swarmscribe-qma2.vercel.app";
const OPENROUTER_TITLE = "SwarmScribe";
const DEFAULT_OPENROUTER_MODEL =
  "meta-llama/llama-3.3-70b-instruct:free";

const SYSTEM_MESSAGE =
  "Polish the following fused agent system prompt: keep structure, dedupe rules, preserve parent credits. Return markdown only.";

/**
 * @param {import('http').IncomingMessage} req
 */
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/**
 * @param {string} ip
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = rateByIp.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateByIp.set(ip, bucket);
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return { ok: true };
}

/**
 * @param {string} url
 * @param {string} apiKey
 * @param {Record<string, string>} extraHeaders
 * @param {string} model
 * @param {string} userContent
 */
async function chatCompletion(url, apiKey, extraHeaders, model, userContent) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_MESSAGE },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { ok: false, status: response.status, detail: text.slice(0, 300) };
  }

  const data = await response.json();
  const refined = data.choices?.[0]?.message?.content?.trim();
  if (!refined) {
    return { ok: false, status: 502, detail: "empty_response" };
  }
  return { ok: true, prompt: refined };
}

/**
 * @param {string} prompt
 */
function resolveProvider(prompt) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    return {
      url: OPENROUTER_URL,
      key: openRouterKey,
      model:
        process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      headers: {
        "HTTP-Referer": OPENROUTER_REFERER,
        Referer: OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
      },
    };
  }

  const openAiKey =
    process.env.OPENAI_API_KEY || process.env.FUSION_REFINE_API_KEY;
  if (openAiKey) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      key: openAiKey,
      model: process.env.FUSION_REFINE_MODEL || "gpt-4o-mini",
      headers: {},
    };
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = clientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res.status(429).json({
      error: "rate_limited",
      message: `Too many refine requests. Retry in ${rate.retryAfterSec}s.`,
    });
    return;
  }

  const provider = resolveProvider();
  if (!provider) {
    res.status(501).json({
      error: "not_configured",
      message:
        "Set OPENROUTER_API_KEY (recommended) or OPENAI_API_KEY / FUSION_REFINE_API_KEY to enable AI refine.",
    });
    return;
  }

  const { fusion } = req.body || {};
  if (!fusion?.prompt || typeof fusion.prompt !== "string") {
    res.status(400).json({ error: "missing fusion payload" });
    return;
  }

  if (fusion.prompt.length > MAX_PROMPT_CHARS) {
    res.status(413).json({
      error: "payload_too_large",
      message: `Prompt exceeds ${MAX_PROMPT_CHARS} characters.`,
    });
    return;
  }

  try {
    const result = await chatCompletion(
      provider.url,
      provider.key,
      provider.headers,
      provider.model,
      fusion.prompt
    );

    if (!result.ok) {
      res.status(502).json({
        error: "upstream_failed",
        detail: result.detail,
      });
      return;
    }

    res.status(200).json({ prompt: result.prompt });
  } catch (err) {
    res.status(500).json({ error: "refine_failed", message: String(err) });
  }
}
