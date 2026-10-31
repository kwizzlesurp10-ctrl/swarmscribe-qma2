import {
  allAgentIds,
  getCachedAgent,
  humanizeId,
  loadAgent,
  loadCatalog,
  prefetchAgents,
} from "./prompts.js";
import { highlightHtml, renderMarkdown } from "./lib/markdown.js";
import { createZip, downloadBytes } from "./lib/zip.js";
import { fuseAgents, pickChaosPair, pickSmartPartner } from "./lib/fusion.js";
import { addFusion, loadFusions, removeFusion } from "./lib/fusions-store.js";

const catalog = await loadCatalog();
const ALL_IDS = allAgentIds(catalog);
const agentIdSet = new Set(ALL_IDS);

const rail = document.getElementById("rail");
const railSearch = document.getElementById("rail-search");
const nameEl = document.getElementById("agent-name");
const metaEl = document.getElementById("agent-meta");
const promptEl = document.getElementById("prompt");
const promptMdEl = document.getElementById("prompt-md");
const toast = document.getElementById("toast");
const gauge = document.getElementById("gauge");
const gaugeN = document.getElementById("gauge-n");
const pinBtn = document.getElementById("pin-agent");
const viewRenderedBtn = document.getElementById("view-rendered");
const viewSourceBtn = document.getElementById("view-source");

/** @type {{ id: string, name: string, class: string, performative: string, inject: string, heat: string, prompt: string } | null} */
let current = null;
let heat = 17;
let filterQuery = "";
let viewMode = "rendered";
let searchIndexReady = false;
/** @type {Set<string>} */
let favorites = loadFavorites();
let fusionMode = "smart";
/** @type {Record<string, unknown> | null} */
let lastFusion = null;
/** @type {[Record<string, unknown>, Record<string, unknown>] | null} */
let lastPair = null;

function loadFavorites() {
  try {
    const raw = localStorage.getItem("swarmscribe:favorites");
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(
    "swarmscribe:favorites",
    JSON.stringify([...favorites])
  );
}

function setHeat(n) {
  heat = Math.max(8, Math.min(48, Math.round(n)));
  gauge.style.setProperty("--heat", String(heat));
  gaugeN.textContent = heat + "%";
}

let toastTimer = 0;
function toastMsg(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  toast.setAttribute("aria-hidden", "false");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
    toast.setAttribute("aria-hidden", "true");
  }, 2200);
}

function agentMeta(agent) {
  if (!agent) return humanizeId("coordinator");
  return agent.name || humanizeId(agent.id);
}

function agentMatchesFilter(agent, qLower) {
  if (!qLower) return true;
  const hay = [
    agent.id,
    agent.name,
    agent.class,
    agent.performative,
    agent.inject,
    agent.heat,
    agent.prompt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(qLower);
}

function getVisibleAgentButtons() {
  return [...rail.querySelectorAll("button.agent")];
}

function renderRail() {
  rail.innerHTML = "";
  const qLower = filterQuery.toLowerCase();
  const filtering = filterQuery.length > 0;

  const favAgents = [...favorites]
    .map((id) => getCachedAgent(id))
    .filter(Boolean)
    .filter((a) => agentMatchesFilter(a, qLower));

  if (favAgents.length) {
    appendRailGroup({
      id: "pinned",
      label: "Pinned",
      agents: favAgents,
      open: true,
      isPinnedGroup: true,
    });
  }

  for (const cat of catalog.categories) {
    const agentsInCat = cat.agents
      .map((id) => getCachedAgent(id))
      .filter(Boolean)
      .filter((a) => agentMatchesFilter(a, qLower));

    const stubIds = cat.agents.filter(
      (id) => !getCachedAgent(id) && (!filtering || id.toLowerCase().includes(qLower))
    );

    if (!agentsInCat.length && !stubIds.length && filtering) continue;

    const section = document.createElement("details");
    section.className = "rail-group";
    section.dataset.category = cat.id;
    const hashCat = parseCategoryHash();
    section.open =
      filtering ||
      cat.id === "qma2-core" ||
      hashCat === cat.id ||
      section.dataset.category === currentCategoryId();

    const summary = document.createElement("summary");
    summary.className = "rail-group-head";
    summary.innerHTML = `<span>${escapeHtml(cat.label)}</span><span class="count">${agentsInCat.length + stubIds.length}</span>`;
    summary.addEventListener("click", () => {
      location.hash = `#category/${cat.id}`;
    });
    section.appendChild(summary);

    const list = document.createElement("div");
    list.className = "rail-group-list";

    for (const a of agentsInCat) {
      list.appendChild(makeAgentButton(a));
    }
    for (const id of stubIds) {
      list.appendChild(makeAgentButton({ id, name: humanizeId(id), class: "…" }));
    }

    section.appendChild(list);
    rail.appendChild(section);

    section.addEventListener("toggle", () => {
      if (section.open) {
        location.hash = `#category/${cat.id}`;
        void prefetchAgents(cat.agents.slice(0, 24));
      }
    });
  }

  if (!rail.children.length) {
    const empty = document.createElement("p");
    empty.className = "rail-empty";
    empty.textContent = "No agents match your search.";
    rail.appendChild(empty);
  }
}

function appendRailGroup({ id, label, agents, open, isPinnedGroup }) {
  const section = document.createElement("details");
  section.className = "rail-group rail-group-pinned";
  section.dataset.category = id;
  section.open = open;

  const summary = document.createElement("summary");
  summary.className = "rail-group-head";
  summary.innerHTML = `<span>${escapeHtml(label)}</span><span class="count">${agents.length}</span>`;
  section.appendChild(summary);

  const list = document.createElement("div");
  list.className = "rail-group-list";
  for (const a of agents) {
    list.appendChild(makeAgentButton(a, isPinnedGroup));
  }
  section.appendChild(list);
  rail.appendChild(section);
}

function makeAgentButton(a, pinnedGroup = false) {
  const b = document.createElement("button");
  b.className = "agent" + (current && a.id === current.id ? " on" : "");
  b.type = "button";
  b.role = "option";
  b.dataset.agentId = a.id;
  b.setAttribute("aria-selected", current && a.id === current.id ? "true" : "false");
  const q = filterQuery.trim();
  const nameHtml = q ? highlightHtml(a.name || humanizeId(a.id), q) : escapeHtml(a.name || humanizeId(a.id));
  const classText = a.class || "…";
  b.innerHTML = `<b>${nameHtml}</b><span>${escapeHtml(classText)}</span>`;
  if (favorites.has(a.id) && !pinnedGroup) {
    b.dataset.pinned = "true";
  }
  b.onclick = () => select(a.id);
  return b;
}

function currentCategoryId() {
  for (const cat of catalog.categories) {
    if (cat.agents.includes(current?.id)) return cat.id;
  }
  return "qma2-core";
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updatePinUi() {
  const pinned = current && favorites.has(current.id);
  pinBtn.setAttribute("aria-pressed", pinned ? "true" : "false");
  pinBtn.querySelector("span").textContent = pinned ? "★" : "☆";
  pinBtn.title = pinned ? "Unpin" : "Pin favorite";
}

function setViewMode(mode) {
  viewMode = mode;
  const rendered = mode === "rendered";
  viewRenderedBtn.classList.toggle("on", rendered);
  viewSourceBtn.classList.toggle("on", !rendered);
  viewRenderedBtn.setAttribute("aria-pressed", rendered ? "true" : "false");
  viewSourceBtn.setAttribute("aria-pressed", !rendered ? "true" : "false");
  promptMdEl.hidden = !rendered;
  promptEl.hidden = rendered;
}

function renderPromptBody() {
  if (!current) return;
  const q = filterQuery.trim();
  const text = current.prompt || "";
  if (q) {
    promptEl.innerHTML = highlightHtml(text, q);
  } else {
    promptEl.textContent = text;
  }
  promptMdEl.innerHTML = renderMarkdown(text);
}

async function select(id, { updateHash = true } = {}) {
  if (!agentIdSet.has(id)) id = ALL_IDS[0];
  try {
    current = await loadAgent(id);
  } catch {
    toastMsg("Could not load agent");
    return;
  }

  nameEl.textContent = current.name;
  metaEl.textContent = `${current.class} · ${current.performative} · inject: ${current.inject}`;
  renderPromptBody();
  updatePinUi();
  renderRail();

  if (updateHash) {
    const next = `#${id}`;
    if (location.hash !== next) history.pushState(null, "", next);
  }

  document.title = `${current.name} · SwarmScribe`;
}

async function ensureSearchIndex() {
  if (searchIndexReady) return;
  searchIndexReady = true;
  toastMsg("Indexing prompts…");
  await prefetchAgents(ALL_IDS, 10);
  renderRail();
  if (current) renderPromptBody();
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    setHeat(heat - 2);
    toastMsg(label);
  } catch {
    toastMsg("Copy blocked — select text manually");
  }
}

function enhance(raw) {
  const line = raw.trim();
  if (!line) return "";
  const lower = line.toLowerCase();
  let role = "Researcher";
  if (/swarm|orchestrat|multi.?agent/.test(lower)) role = "Coordinator";
  else if (/plan|roadmap/.test(lower)) role = "Planner";
  else if (/build|code|execut/.test(lower)) role = "Executor";
  else if (/metric|roi|analy/.test(lower)) role = "Analyst";
  else if (/review|critic|qa/.test(lower)) role = "Critic";
  else if (/mcp|a2a|protocol/.test(lower)) role = "Protocol Specialist";
  else if (/write|copy|listing/.test(lower)) role = "Writer";
  else if (/trace|observ/.test(lower)) role = "Observability Tracer";
  else if (/agent|prompt/.test(lower)) role = "specialist matching the ask";

  return `# ${line.split(/[.!?]/)[0].slice(0, 72)}

**Quick capture:** ${line}

**QMA² Pulse:** intent routed to **${role}**. Heat target < 20%.

**Expanded brief**
This request is treated as production work for Elite Agent Agency_QMA² v2.1. Protocols in force: MCP for tools, A2A (JSON-RPC 2.0 + FIPA-ACL) for handoff, ACP for state.

**Recommended swarm slice**
1. Researcher — verify facts and date sources.
2. Planner — smallest plan that ships in ≤3 cycles.
3. Executor — one artifact, then stop.
4. Critic — PASS / PATCHES / REFUSE.
5. Writer — one user-facing voice.

**Actionable next step**
Copy the **${role}** system prompt from the vault and paste it as the runtime system instruction. Feed this capture as the first user message.

**Assumptions**
- Professional / operator context
- No invented prices, statutes, or file claims
- Degrade with explicit bounds if Pulse > 40%

**Tags:** #qma2 #swarmscribe #${role.toLowerCase().replace(/\s+/g, "-")}
**Heat score:** ${heat}%`;
}

function parseAgentHash() {
  const h = location.hash.replace(/^#/, "");
  if (!h) return null;
  if (h.startsWith("category/")) return null;
  if (h.startsWith("agent/")) {
    const id = h.slice("agent/".length);
    return agentIdSet.has(id) ? id : null;
  }
  return agentIdSet.has(h) ? h : null;
}

function parseCategoryHash() {
  const h = location.hash.replace(/^#/, "");
  if (h.startsWith("category/")) return h.slice("category/".length);
  return null;
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function agentToMd(agent) {
  return `# ${agent.name}\n\n- **Class:** ${agent.class}\n- **Performative:** ${agent.performative}\n- **Inject:** ${agent.inject}\n- **Heat:** ${agent.heat}\n\n---\n\n${agent.prompt}\n`;
}

async function exportVaultJson() {
  toastMsg("Preparing JSON export…");
  await prefetchAgents(ALL_IDS, 12);
  const agents = ALL_IDS.map((id) => getCachedAgent(id)).filter(Boolean);
  const payload = { catalog, agents, exportedAt: new Date().toISOString() };
  downloadText(
    "swarmscribe-vault.json",
    JSON.stringify(payload, null, 2),
    "application/json"
  );
  toastMsg("Vault JSON downloaded");
}

async function exportVaultZip() {
  toastMsg("Preparing ZIP export…");
  await prefetchAgents(ALL_IDS, 12);
  const files = [
    {
      name: "catalog.json",
      data: JSON.stringify(catalog, null, 2),
    },
  ];
  for (const id of ALL_IDS) {
    const agent = getCachedAgent(id);
    if (agent) {
      files.push({
        name: `agents/${id}.json`,
        data: JSON.stringify(agent, null, 2),
      });
      files.push({
        name: `agents/${id}.md`,
        data: agentToMd(agent),
      });
    }
  }
  const zip = createZip(files);
  downloadBytes(zip, "swarmscribe-vault.zip");
  toastMsg("Vault ZIP downloaded");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("swarmscribe:theme", theme);
  document
    .getElementById("theme-toggle")
    .setAttribute(
      "aria-label",
      theme === "light" ? "Switch to dark theme" : "Switch to light theme"
    );
}

function initTheme() {
  const stored = localStorage.getItem("swarmscribe:theme");
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
}

function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
}

function setActiveTab(tab) {
  const tabs = [
    ["vault", document.getElementById("tab-vault"), document.getElementById("vault")],
    ["enhance", document.getElementById("tab-enhance"), document.getElementById("enhance")],
    ["fusion", document.getElementById("tab-fusion"), document.getElementById("fusion")],
  ];
  for (const [name, btn, panel] of tabs) {
    const on = name === tab;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    panel.hidden = !on;
  }
}


function focusAgentByOffset(delta) {
  const buttons = getVisibleAgentButtons();
  if (!buttons.length) return;
  const idx = buttons.findIndex((b) => b.classList.contains("on"));
  let next = idx + delta;
  if (next < 0) next = buttons.length - 1;
  if (next >= buttons.length) next = 0;
  buttons[next].focus();
}

railSearch.addEventListener("input", () => {
  filterQuery = railSearch.value.trim();
  if (filterQuery.length > 1) void ensureSearchIndex();
  renderRail();
  if (current) renderPromptBody();
});

railSearch.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const first = getVisibleAgentButtons()[0];
    first?.focus();
  }
});

document.addEventListener("keydown", (e) => {
  const tag = (e.target instanceof HTMLElement && e.target.tagName) || "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;

  if (e.key === "/" && !typing) {
    e.preventDefault();
    railSearch.focus();
    railSearch.select();
  }

  if (e.key === "t" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    toggleTheme();
  }

  if (e.key === "Escape" && document.activeElement === railSearch) {
    railSearch.value = "";
    filterQuery = "";
    renderRail();
    if (current) renderPromptBody();
  }

  if (document.activeElement?.matches?.("button.agent")) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusAgentByOffset(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusAgentByOffset(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = document.activeElement.dataset.agentId;
      if (id) void select(id);
    }
  }
});

document.getElementById("copy-sys").onclick = () => {
  if (current) void copy(current.prompt, "System prompt copied");
};
document.getElementById("copy-md").onclick = () => {
  if (current) void copy(agentToMd(current), "Markdown copied");
};
document.getElementById("download-md").onclick = () => {
  if (!current) return;
  downloadText(`${current.id}.md`, agentToMd(current), "text/markdown");
  toastMsg("Markdown file downloaded");
};
document.getElementById("download-json").onclick = () => {
  if (!current) return;
  downloadText(`${current.id}.json`, JSON.stringify(current, null, 2), "application/json");
  toastMsg("JSON file downloaded");
};

pinBtn.onclick = () => {
  if (!current) return;
  if (favorites.has(current.id)) favorites.delete(current.id);
  else favorites.add(current.id);
  saveFavorites();
  updatePinUi();
  renderRail();
  toastMsg(favorites.has(current.id) ? "Pinned" : "Unpinned");
};

viewRenderedBtn.onclick = () => setViewMode("rendered");
viewSourceBtn.onclick = () => setViewMode("source");

document.getElementById("tab-vault").onclick = () => setActiveTab("vault");
document.getElementById("tab-enhance").onclick = () => setActiveTab("enhance");
document.getElementById("tab-fusion").onclick = () => {
  setActiveTab("fusion");
  void ensureFusionPool();
  renderFusionList();
};

function fusionAgentToMd(fusion) {
  return `# ${fusion.name}\n\n- **Class:** ${fusion.class}\n- **Parents:** ${fusion.parentNames?.join(" + ") || fusion.parents?.join(" + ")}\n- **Mode:** ${fusion.mode}\n\n---\n\n${fusion.prompt}\n`;
}

async function ensureFusionPool(min = 24) {
  const loaded = ALL_IDS.filter((id) => getCachedAgent(id)).length;
  if (loaded >= min) return;
  await prefetchAgents(ALL_IDS, 10);
}

function renderFusionParents(a, b) {
  const wrap = document.getElementById("fusion-parents");
  wrap.innerHTML = `<h3>Parents</h3>
    <div class="parent-cards">
      <article class="parent-card"><h4>${escapeHtml(a.name)}</h4><p>${escapeHtml(a.class)} · ${escapeHtml(a.id)}</p></article>
      <span class="parent-plus" aria-hidden="true">⚡</span>
      <article class="parent-card"><h4>${escapeHtml(b.name)}</h4><p>${escapeHtml(b.class)} · ${escapeHtml(b.id)}</p></article>
    </div>`;
}

function setFusionActionsEnabled(on) {
  for (const id of [
    "fusion-reroll",
    "fusion-copy",
    "fusion-dl-md",
    "fusion-dl-json",
    "fusion-save",
    "fusion-refine",
  ]) {
    document.getElementById(id).disabled = !on;
  }
}

function showFusionResult(fusion, { chaosReveal = false } = {}) {
  lastFusion = fusion;
  document.getElementById("fusion-name").textContent = fusion.name;
  document.getElementById("fusion-meta").textContent = `${fusion.class} · compatibility ${fusion.compatibility}/100 · ${fusion.mode} fusion`;
  document.getElementById("fusion-md").innerHTML = renderMarkdown(fusion.prompt);
  document.getElementById("fusion-rationale").textContent = fusion.rationale;
  setFusionActionsEnabled(true);

  const reveal = document.getElementById("chaos-reveal");
  if (chaosReveal) {
    reveal.hidden = false;
    reveal.classList.remove("active");
    void reveal.offsetWidth;
    reveal.classList.add("active");
    window.setTimeout(() => {
      reveal.classList.remove("active");
    }, 1400);
  } else {
    reveal.hidden = true;
  }
}

async function runFusion({ reroll = false } = {}) {
  await ensureFusionPool();
  const agents = ALL_IDS.map((id) => getCachedAgent(id)).filter(Boolean);
  if (agents.length < 2) {
    toastMsg("Loading agents for fusion…");
    await prefetchAgents(ALL_IDS, 12);
  }
  const pool = ALL_IDS.map((id) => getCachedAgent(id)).filter(Boolean);
  if (pool.length < 2) {
    toastMsg("Need at least two agents loaded");
    return;
  }

  let pair = lastPair;
  if (!pair || !reroll) {
    if (fusionMode === "chaos") {
      pair = pickChaosPair(pool);
    } else {
      const useCurrent = document.getElementById("fusion-use-current").checked;
      const seed = useCurrent && current ? current : null;
      pair = pickSmartPartner(pool, seed, catalog);
    }
  } else if (reroll) {
    if (fusionMode === "chaos") {
      pair = pickChaosPair(pool);
    } else {
      const useCurrent = document.getElementById("fusion-use-current").checked;
      const seed = useCurrent && current ? current : lastPair?.[0] || null;
      const alt = pickSmartPartner(pool, seed, catalog);
      if (alt && alt[0]?.id === alt[1]?.id) {
        pair = pickChaosPair(pool.filter((p) => p.id !== seed?.id));
      } else {
        pair = alt;
      }
    }
  }

  if (!pair || pair.length < 2) {
    toastMsg("Could not pick a fusion pair");
    return;
  }

  lastPair = pair;
  renderFusionParents(pair[0], pair[1]);
  const fusion = fuseAgents(pair[0], pair[1], fusionMode, catalog);
  showFusionResult(fusion, { chaosReveal: fusionMode === "chaos" });
  setHeat(heat - 3);
  toastMsg(fusionMode === "chaos" ? "Chaos fusion complete 🎋" : "Smart fusion complete 🐼");
}

function renderFusionList() {
  const listEl = document.getElementById("fusion-list");
  const saved = loadFusions();
  listEl.innerHTML = "";
  if (!saved.length) {
    const li = document.createElement("li");
    li.className = "fusion-list-empty";
    li.textContent = "Saved hybrids appear here.";
    listEl.appendChild(li);
    return;
  }
  for (const f of saved) {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="fusion-saved-item"><b>${escapeHtml(f.name)}</b><span>${escapeHtml(f.mode)} · ${escapeHtml(f.parentNames?.join(" + ") || "")}</span></button><button type="button" class="fusion-remove" aria-label="Remove">×</button>`;
    li.querySelector(".fusion-saved-item").onclick = () => {
      showFusionResult(f);
      lastPair = f.parents?.map((id) => getCachedAgent(id)).filter(Boolean);
      if (lastPair?.length === 2) renderFusionParents(lastPair[0], lastPair[1]);
    };
    li.querySelector(".fusion-remove").onclick = () => {
      removeFusion(f.id);
      renderFusionList();
    };
    listEl.appendChild(li);
  }
}

document.getElementById("mode-smart").onclick = () => {
  fusionMode = "smart";
  document.getElementById("mode-smart").classList.add("on");
  document.getElementById("mode-chaos").classList.remove("on");
  document.getElementById("mode-smart").setAttribute("aria-selected", "true");
  document.getElementById("mode-chaos").setAttribute("aria-selected", "false");
  document.getElementById("fusion-hint").textContent =
    "Pick an optional seed agent from the vault (or none). We’ll find a compatible partner.";
  document.getElementById("fusion-use-current").disabled = false;
};
document.getElementById("mode-chaos").onclick = () => {
  fusionMode = "chaos";
  document.getElementById("mode-chaos").classList.add("on");
  document.getElementById("mode-smart").classList.remove("on");
  document.getElementById("mode-chaos").setAttribute("aria-selected", "true");
  document.getElementById("mode-smart").setAttribute("aria-selected", "false");
  document.getElementById("fusion-hint").textContent =
    "Two random vault prompts. Expect weird chemistry and a bamboo burst.";
  document.getElementById("fusion-use-current").checked = false;
  document.getElementById("fusion-use-current").disabled = true;
};

document.getElementById("fusion-run").onclick = () => void runFusion();
document.getElementById("fusion-reroll").onclick = () => void runFusion({ reroll: true });
document.getElementById("fusion-copy").onclick = () => {
  if (lastFusion) void copy(lastFusion.prompt, "Fused prompt copied");
};
document.getElementById("fusion-dl-md").onclick = () => {
  if (!lastFusion) return;
  downloadText(`${lastFusion.id}.md`, fusionAgentToMd(lastFusion), "text/markdown");
  toastMsg("Fusion markdown downloaded");
};
document.getElementById("fusion-dl-json").onclick = () => {
  if (!lastFusion) return;
  const { parentNames: _pn, compatibility: _c, rationale: _r, fusedAt: _fa, savedAt: _sa, ...agentShape } = lastFusion;
  downloadText(`${lastFusion.id}.json`, JSON.stringify(agentShape, null, 2), "application/json");
  toastMsg("Fusion JSON downloaded");
};
document.getElementById("fusion-save").onclick = () => {
  if (!lastFusion) return;
  addFusion(lastFusion);
  renderFusionList();
  toastMsg("Saved to My fusions");
};

document.getElementById("fusion-refine").onclick = async () => {
  if (!lastFusion) return;
  try {
    const res = await fetch("/api/refine-fusion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fusion: lastFusion }),
    });
    if (res.status === 501) {
      toastMsg("AI refine not configured (local fusion only)");
      return;
    }
    if (!res.ok) {
      toastMsg("Refine failed — keeping local fusion");
      return;
    }
    const data = await res.json();
    if (data.prompt) {
      lastFusion = { ...lastFusion, prompt: data.prompt };
      showFusionResult(lastFusion);
      toastMsg("Fusion refined");
    }
  } catch {
    toastMsg("Refine unavailable offline");
  }
};

document.getElementById("tab-enhance").onclick = () => setActiveTab("enhance");
document.getElementById("run-enhance").onclick = () => {
  const raw = document.getElementById("raw").value;
  const out = enhance(raw);
  document.getElementById("out").value = out || "Enter a line first.";
  if (out) setHeat(heat - 1);
};
document.getElementById("clear-raw").onclick = () => {
  document.getElementById("raw").value = "";
};
document.getElementById("copy-out").onclick = () => {
  void copy(document.getElementById("out").value, "Output copied");
};

document.getElementById("theme-toggle").onclick = () => toggleTheme();
document.getElementById("export-json").onclick = () => void exportVaultJson();
document.getElementById("export-zip").onclick = () => void exportVaultZip();

const exportMenu = document.getElementById("export-menu");
const exportBtn = document.getElementById("export-menu-btn");
exportBtn.onclick = () => {
  const open = exportMenu.hidden;
  exportMenu.hidden = !open;
  exportBtn.setAttribute("aria-expanded", open ? "true" : "false");
};
document.addEventListener("click", (e) => {
  if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) {
    exportMenu.hidden = true;
    exportBtn.setAttribute("aria-expanded", "false");
  }
});

window.addEventListener("hashchange", () => {
  const id = parseAgentHash();
  if (id && (!current || current.id !== id)) void select(id, { updateHash: false });
  renderRail();
});

initTheme();
setViewMode("rendered");
setActiveTab("vault");
renderFusionList();

const initialId = parseAgentHash() || "coordinator";
await prefetchAgents(catalog.categories.find((c) => c.id === "qma2-core")?.agents || [initialId]);
await select(initialId, { updateHash: !parseAgentHash() });
setHeat(17);

const idlePrefetch = () => void prefetchAgents(ALL_IDS, 6);
if ("requestIdleCallback" in window) {
  requestIdleCallback(idlePrefetch, { timeout: 4000 });
} else {
  setTimeout(idlePrefetch, 1500);
}
