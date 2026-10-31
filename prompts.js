const agentCache = new Map();
/** @type {Map<string, Promise<import('./lib/types.js').Agent>>} */
const inflight = new Map();

/**
 * @param {string} id
 * @returns {string}
 */
export function humanizeId(id) {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * @returns {Promise<{ version: number, categories: { id: string, label: string, agents: string[] }[] }>}
 */
export async function loadCatalog() {
  const res = await fetch("./agents/catalog.json");
  if (!res.ok) throw new Error("missing agents/catalog.json");
  return res.json();
}

/**
 * @param {{ categories: { agents: string[] }[] }} catalog
 * @returns {string[]}
 */
export function allAgentIds(catalog) {
  const ids = catalog.categories.flatMap((c) => c.agents);
  return [...new Set(ids)];
}

/**
 * @param {string} id
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadAgent(id) {
  if (agentCache.has(id)) return agentCache.get(id);
  if (inflight.has(id)) return inflight.get(id);

  const promise = (async () => {
    const res = await fetch(`./agents/${id}.json`);
    if (!res.ok) throw new Error(`missing agent ${id}`);
    const agent = await res.json();
    const normalized = { ...agent, id: agent.id || id };
    agentCache.set(id, normalized);
    inflight.delete(id);
    return normalized;
  })();

  inflight.set(id, promise);
  return promise;
}

/**
 * @param {string} id
 * @returns {Record<string, unknown> | null}
 */
export function getCachedAgent(id) {
  return agentCache.get(id) || null;
}

/**
 * @param {string[]} ids
 * @param {number} [concurrency]
 */
export async function prefetchAgents(ids, concurrency = 8) {
  const queue = [...new Set(ids)];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id || agentCache.has(id)) continue;
      try {
        await loadAgent(id);
      } catch (err) {
        console.warn("[SwarmScribe]", err);
      }
    }
  });
  await Promise.all(workers);
}

/** @param {string[]} ids */
export async function loadAgentsEager(ids) {
  await prefetchAgents(ids, 12);
  return ids.map((id) => agentCache.get(id)).filter(Boolean);
}
