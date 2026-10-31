/**
 * Client-side prompt fusion — deterministic, section-aware merging.
 */

const STOP = new Set(
  "a an the and or for to of in on at by with from as is are be this that you your our their it its".split(
    " "
  )
);

/**
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractKeywords(text) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  return new Set(words);
}

/**
 * @param {string} agentId
 * @param {{ categories: { id: string, agents: string[] }[] }} catalog
 */
export function categoryForAgent(agentId, catalog) {
  for (const cat of catalog.categories) {
    if (cat.agents.includes(agentId)) return cat.id;
  }
  return "unknown";
}

/**
 * @param {string} a
 * @param {string} b
 */
function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
}

/**
 * @param {Record<string, unknown>} agentA
 * @param {Record<string, unknown>} agentB
 * @param {{ categories: { id: string, label: string, agents: string[] }[] }} catalog
 */
export function scoreCompatibility(agentA, agentB, catalog) {
  if (agentA.id === agentB.id) return -1;
  let score = 0;
  const catA = categoryForAgent(agentA.id, catalog);
  const catB = categoryForAgent(agentB.id, catalog);
  if (catA === catB) score += 32;
  else if (catA === "qma2-core" || catB === "qma2-core") score += 12;

  if (agentA.class && agentA.class === agentB.class) score += 24;

  const perfA = String(agentA.performative || "").toLowerCase();
  const perfB = String(agentB.performative || "").toLowerCase();
  const perfTokens = new Set(
    [...perfA.split(/[^a-z]+/), ...perfB.split(/[^a-z]+/)].filter(Boolean)
  );
  if (perfA && perfB && (perfA.includes(perfB) || perfB.includes(perfA))) {
    score += 18;
  } else if (perfTokens.size < perfA.length + perfB.length) {
    score += 8;
  }

  const kwA = extractKeywords(`${agentA.name} ${agentA.prompt}`);
  const kwB = extractKeywords(`${agentB.name} ${agentB.prompt}`);
  score += Math.round(jaccard(kwA, kwB) * 28);

  const complementary =
    /orchestr|coord|plan|execut|research|critic|write|analy/i;
  if (
    complementary.test(String(agentA.class)) &&
    complementary.test(String(agentB.class)) &&
    agentA.class !== agentB.class
  ) {
    score += 10;
  }

  return score;
}

/**
 * @param {Record<string, unknown>[]} agents
 * @param {Record<string, unknown> | null} seed
 * @param {{ categories: { id: string, agents: string[] }[] }} catalog
 */
export function pickSmartPartner(agents, seed, catalog) {
  const pool = agents.filter((a) => !seed || a.id !== seed.id);
  if (!pool.length) return null;

  if (!seed) {
    let best = pool[0];
    let bestScore = -1;
    for (const candidate of pool) {
      const localBest = pool
        .filter((p) => p.id !== candidate.id)
        .map((p) => scoreCompatibility(candidate, p, catalog))
        .sort((x, y) => y - x)[0];
      if (localBest > bestScore) {
        bestScore = localBest;
        best = candidate;
      }
    }
    const partner = pool
      .filter((p) => p.id !== best.id)
      .map((p) => ({ p, s: scoreCompatibility(best, p, catalog) }))
      .sort((a, b) => b.s - a.s)[0]?.p;
    return partner ? [best, partner] : [best, pool[1] || best];
  }

  const ranked = pool
    .map((p) => ({ p, s: scoreCompatibility(seed, p, catalog) }))
    .sort((a, b) => b.s - a.s);
  return [seed, ranked[0]?.p || pool[0]];
}

/**
 * @param {Record<string, unknown>[]} agents
 * @param {() => number} rng
 */
export function pickChaosPair(agents, rng = Math.random) {
  if (agents.length < 2) return null;
  const i = Math.floor(rng() * agents.length);
  let j = Math.floor(rng() * (agents.length - 1));
  if (j >= i) j += 1;
  return [agents[i], agents[j]];
}

/**
 * @param {string} s
 */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {number} seed
 */
function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * @param {string} prompt
 */
function parseSections(prompt) {
  const lines = String(prompt).split("\n");
  /** @type {{ title: string, body: string[] }[]} */
  const sections = [{ title: "opening", body: [] }];
  for (const line of lines) {
    const hm = line.match(/^#{1,3}\s+(.+)/);
    if (hm) {
      sections.push({ title: hm[1].trim(), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }
  return sections;
}

/**
 * @param {string} line
 */
function normalizeRule(line) {
  return line.replace(/^[\s\-*\d.)]+/, "").trim().toLowerCase();
}

/**
 * @param {string[]} lines
 */
function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const key = normalizeRule(t);
    if (key.length < 8) {
      out.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @param {"smart"|"chaos"} mode
 * @param {{ categories: { id: string, label: string, agents: string[] }[] }} catalog
 * @param {() => number} [rng]
 */
export function fuseAgents(a, b, mode, catalog, rng = Math.random) {
  const score = scoreCompatibility(a, b, catalog);
  const seed = hashString(`${a.id}|${b.id}|${mode}`);
  const det = seededRng(seed);
  const roll = mode === "chaos" ? rng : det;

  const name = generateHybridName(a, b, mode, roll);
  const id = slugify(name);

  const sectionsA = parseSections(String(a.prompt));
  const sectionsB = parseSections(String(b.prompt));

  const identityLines = [
    `You are **${name}**, a fused specialist born from **${a.name}** (${a.class}) and **${b.name}** (${b.class}).`,
    `Operate with performatives **${a.performative}** × **${b.performative}** — one coherent voice, no warring personas.`,
    mode === "chaos"
      ? "Chaos fusion engaged: expect creative tension, cross-domain leaps, and delightfully uneven emphasis."
      : "Smart fusion engaged: complementary roles merged for a shippable hybrid workflow.",
  ];

  const objectiveBullets = dedupeLines([
    ...collectBullets(sectionsA, /objective|mission|workflow|mandatory|role/i),
    ...collectBullets(sectionsB, /objective|mission|workflow|mandatory|role/i),
    `- Honor the original ask from both parents: ${a.inject} · ${b.inject}`,
    `- Keep heat signature target below 20% unless both parents explicitly allow escalation.`,
  ]).slice(0, 14);

  const ruleLines = dedupeLines([
    ...collectBullets(sectionsA, /rule|protocol|must|never|always|rubric|truth/i),
    ...collectBullets(sectionsB, /rule|protocol|must|never|always|rubric|truth/i),
    "- Never fabricate facts, files, prices, or citations.",
    "- Fail closed: if fused instructions conflict, prefer safety, truth, and the user's explicit ask.",
  ]).slice(0, 18);

  if (mode === "chaos" && roll() > 0.55) {
    ruleLines.unshift(
      "- Chaos clause: occasionally prioritize the weirder parent's metaphor — but still ship usable output."
    );
  }

  const outputFormat = dedupeLines([
    ...collectBullets(sectionsA, /output|format|verdict|deliver|response/i),
    ...collectBullets(sectionsB, /output|format|verdict|deliver|response/i),
    "**Default output:** 1) fused verdict  2) heat note  3) actionable steps  4) assumptions",
  ]).slice(0, 8);

  const catA = catalog.categories.find((c) => c.agents.includes(a.id))?.label;
  const catB = catalog.categories.find((c) => c.agents.includes(b.id))?.label;

  const rationale =
    mode === "smart"
      ? `Matched **${a.name}** + **${b.name}** (compatibility ${score}/100). Categories: ${catA || "?"} × ${catB || "?"}. Shared DNA in class/performative keywords makes this pair cooperate instead of collide.`
      : `Chaos draw: **${a.name}** (${catA || "?"}) collided with **${b.name}** (${catB || "?"}). Compatibility ${score}/100 — lean into the friction.`;

  const mergedBody = [
    `# SYSTEM PROMPT — ${name.toUpperCase()}`,
    `**Fusion mode:** ${mode === "smart" ? "Smart Fusion 🐼" : "Chaos Fusion 🎋"}`,
    `**Parents:** ${a.name} + ${b.name}`,
    "",
    "## Fused identity",
    ...identityLines,
    "",
    "## Combined objectives",
    ...objectiveBullets.map((l) => (l.startsWith("-") ? l : `- ${l}`)),
    "",
    "## Reconciled rules",
    ...ruleLines.map((l) => (l.startsWith("-") ? l : `- ${l}`)),
    "",
    "## Unified output format",
    ...outputFormat.map((l) => (l.startsWith("-") ? l : `- ${l}`)),
    "",
    "## Parent excerpt — A",
    excerpt(String(a.prompt), 1200),
    "",
    "## Parent excerpt — B",
    excerpt(String(b.prompt), 1200),
    "",
    "## Why this fusion",
    rationale,
  ].join("\n");

  const hybrid = {
    id,
    name,
    class: `${a.class} × ${b.class}`.slice(0, 80),
    performative: `${a.performative} + ${b.performative}`.slice(0, 80),
    inject: `fused: ${a.inject} · ${b.inject}`.slice(0, 120),
    heat: pickHeat(a, b),
    prompt: mergedBody,
    parents: [a.id, b.id],
    parentNames: [a.name, b.name],
    mode,
    rationale,
    compatibility: score,
    fusedAt: new Date().toISOString(),
  };

  return hybrid;
}

/**
 * @param {{ title: string, body: string[] }[]} sections
 * @param {RegExp} hint
 */
function collectBullets(sections, hint) {
  const out = [];
  for (const sec of sections) {
    if (!hint.test(sec.title) && sec.title !== "opening") continue;
    for (const line of sec.body) {
      const t = line.trim();
      if (!t) continue;
      if (/^[-*\d.]/.test(t)) out.push(t.replace(/^[-*]\s*/, "- "));
      else if (t.length > 20) out.push(`- ${t}`);
    }
  }
  if (!out.length) {
    for (const sec of sections) {
      for (const line of sec.body) {
        const t = line.trim();
        if (t.startsWith("-") || t.startsWith("*")) out.push(t.replace(/^\*\s*/, "- "));
      }
    }
  }
  return out;
}

/**
 * @param {string} text
 * @param {number} max
 */
function excerpt(text, max) {
  const slice = text.slice(0, max);
  return slice + (text.length > max ? "\n\n…" : "");
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
function pickHeat(a, b) {
  const heats = [a.heat, b.heat].filter(Boolean);
  return heats.length ? heats.join(" / ") : "Misalignment";
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @param {"smart"|"chaos"} mode
 * @param {() => number} roll
 */
function generateHybridName(a, b, mode, roll) {
  const syllable = (name) => {
    const parts = String(name).replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0].slice(0, 4)}${parts[1].slice(0, 4)}`;
    }
    return name.slice(0, 6);
  };

  const chaosPrefixes = ["Bamboo", "Neon", "Gore", "Quantum", "Shadow", "Hyper"];
  const chaosSuffixes = ["Panda", "Fusion", "Lich", "Forge", "Swarm", "Echo"];

  if (mode === "chaos") {
    const pre = chaosPrefixes[Math.floor(roll() * chaosPrefixes.length)];
    const suf = chaosSuffixes[Math.floor(roll() * chaosSuffixes.length)];
    return `${pre}${suf} ${syllable(a.name)}×${syllable(b.name)}`.replace(/\s+/g, " ").trim();
  }

  const merged = `${syllable(a.name)}-${syllable(b.name)} Panda`;
  return merged.charAt(0).toUpperCase() + merged.slice(1);
}

/**
 * @param {string} name
 */
export function slugify(name) {
  return (
    "fusion-" +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48)
  );
}
