import test from "node:test";
import assert from "node:assert/strict";
import {
  fuseAgents,
  pickChaosPair,
  scoreCompatibility,
  slugify,
} from "../lib/fusion.js";

const catalog = {
  categories: [
    { id: "qma2-core", label: "Core", agents: ["a", "b"] },
    { id: "other", label: "Other", agents: ["c"] },
  ],
};

const agentA = {
  id: "a",
  name: "Coordinator",
  class: "Orchestration",
  performative: "delegate",
  inject: "every ask",
  heat: "Misalignment",
  prompt: "# Role\n- Plan work\n- Never lie\n## Output\n- Verdict",
};

const agentB = {
  id: "b",
  name: "Critic",
  class: "Quality Gate",
  performative: "refuse",
  inject: "ship gate",
  heat: "Verification",
  prompt: "# Rubric\n- Score 1-10\n- Never lie\n## Output\n- PASS or REFUSE",
};

test("compatibility favors complementary core pair", () => {
  const score = scoreCompatibility(agentA, agentB, catalog);
  assert.ok(score > 20);
});

test("fuseAgents produces hybrid shape", () => {
  const fusion = fuseAgents(agentA, agentB, "smart", catalog);
  assert.match(fusion.name, /Panda/i);
  assert.ok(fusion.prompt.includes("Fused identity"));
  assert.equal(fusion.parents.join(","), "a,b");
  assert.ok(slugify(fusion.name).startsWith("fusion-"));
});

test("chaos pair picks two distinct agents", () => {
  const agents = [agentA, agentB, { ...agentB, id: "c", name: "Writer" }];
  const pair = pickChaosPair(agents, () => 0.1);
  assert.notEqual(pair[0].id, pair[1].id);
});
