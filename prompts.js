export async function loadCatalog() {
  const res = await fetch("./agents/catalog.json");
  if (!res.ok) throw new Error("missing agents/catalog.json");
  return res.json();
}

export async function loadAgents(catalog) {
  const ids = catalog.categories.flatMap((c) => c.agents);
  const unique = [...new Set(ids)];

  const results = await Promise.allSettled(
    unique.map(async (id) => {
      const res = await fetch(`./agents/${id}.json`);
      if (!res.ok) throw new Error(`missing agent ${id}`);
      const agent = await res.json();
      return { ...agent, id: agent.id || id };
    })
  );

  const byId = new Map();
  for (const r of results) {
    if (r.status === "fulfilled") {
      byId.set(r.value.id, r.value);
    } else {
      console.warn("[SwarmScribe]", r.reason?.message || r.reason);
    }
  }

  const agents = [];
  for (const id of unique) {
    const agent = byId.get(id);
    if (agent) agents.push(agent);
  }

  if (!agents.length) throw new Error("no agents loaded");
  return agents;
}
