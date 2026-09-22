import { loadAgents } from "./prompts.js";

const AGENTS = await loadAgents();

const rail = document.getElementById("rail");
const nameEl = document.getElementById("agent-name");
const metaEl = document.getElementById("agent-meta");
const promptEl = document.getElementById("prompt");
const toast = document.getElementById("toast");
const gauge = document.getElementById("gauge");
const gaugeN = document.getElementById("gauge-n");

let current = AGENTS[0];
let heat = 17;

function setHeat(n) {
  heat = Math.max(8, Math.min(48, Math.round(n)));
  gauge.style.setProperty("--heat", String(heat));
  gaugeN.textContent = heat + "%";
}

function toastMsg(msg) {
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 1800);
}

function renderRail() {
  rail.innerHTML = "";
  AGENTS.forEach((a) => {
    const b = document.createElement("button");
    b.className = "agent" + (a.id === current.id ? " on" : "");
    b.type = "button";
    b.innerHTML = `<b>${a.name}</b><span>${a.class}</span>`;
    b.onclick = () => select(a.id);
    rail.appendChild(b);
  });
}

function select(id) {
  current = AGENTS.find((a) => a.id === id) || AGENTS[0];
  nameEl.textContent = current.name;
  metaEl.textContent = `${current.class} · ${current.performative} · inject: ${current.inject}`;
  promptEl.textContent = current.prompt;
  renderRail();
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

document.getElementById("copy-sys").onclick = () => copy(current.prompt, "System prompt copied");
document.getElementById("copy-md").onclick = () => copy(current.prompt, "Markdown copied");
document.getElementById("tab-vault").onclick = () => {
  document.getElementById("tab-vault").classList.add("on");
  document.getElementById("tab-enhance").classList.remove("on");
  document.getElementById("vault").style.display = "";
  document.getElementById("enhance").classList.remove("on");
};
document.getElementById("tab-enhance").onclick = () => {
  document.getElementById("tab-enhance").classList.add("on");
  document.getElementById("tab-vault").classList.remove("on");
  document.getElementById("vault").style.display = "none";
  document.getElementById("enhance").classList.add("on");
};
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
  copy(document.getElementById("out").value, "Output copied");
};

select(AGENTS[0].id);
setHeat(17);
