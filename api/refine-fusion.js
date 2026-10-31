/**
 * Optional serverless refine step. Requires OPENAI_API_KEY on Vercel.
 * Degrades gracefully when unset — client should treat non-OK as "local only".
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.FUSION_REFINE_API_KEY;
  if (!apiKey) {
    res.status(501).json({
      error: "not_configured",
      message: "Set OPENAI_API_KEY (or FUSION_REFINE_API_KEY) to enable AI refine.",
    });
    return;
  }

  const { fusion } = req.body || {};
  if (!fusion?.prompt) {
    res.status(400).json({ error: "missing fusion payload" });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.FUSION_REFINE_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "Polish the following fused agent system prompt: keep structure, dedupe rules, preserve parent credits. Return markdown only.",
          },
          { role: "user", content: fusion.prompt },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ error: "upstream_failed", detail: text.slice(0, 200) });
      return;
    }

    const data = await response.json();
    const refined = data.choices?.[0]?.message?.content?.trim();
    if (!refined) {
      res.status(502).json({ error: "empty_response" });
      return;
    }

    res.status(200).json({ prompt: refined });
  } catch (err) {
    res.status(500).json({ error: "refine_failed", message: String(err) });
  }
}
