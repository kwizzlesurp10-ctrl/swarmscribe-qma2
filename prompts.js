const IDS = [
  "coordinator",
  "researcher",
  "planner",
  "executor",
  "analyst",
  "critic",
  "protocol",
  "writer",
  "tracer"
];

export async function loadAgents() {
  return Promise.all(
    IDS.map(async (id) => {
      const res = await fetch(`./agents/${id}.json`);
      if (!res.ok) throw new Error("missing agent " + id);
      return res.json();
    })
  );
}
