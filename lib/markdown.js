/** Minimal markdown → HTML (dependency-free, safe). */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safe = href.startsWith("http") ? href : "#";
    return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
  });
  return s;
}

/**
 * @param {string} source
 * @returns {string}
 */
export function renderMarkdown(source) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listType = null;

  function flushList() {
    if (listType) {
      out.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = null;
    }
  }

  for (const raw of lines) {
    const line = raw;

    if (line.startsWith("```")) {
      flushList();
      if (!inCode) {
        inCode = true;
        codeBuf = [];
      } else {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)[0].length;
      const text = line.replace(/^#{1,6}\s/, "");
      out.push(`<h${level}>${inlineMarkdown(text)}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (listType !== "ul") {
        flushList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") {
        flushList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  flushList();
  if (inCode && codeBuf.length) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }

  return out.join("\n");
}

/**
 * @param {string} text
 * @param {string} query
 * @returns {string}
 */
export function highlightHtml(text, query) {
  if (!query) return escapeHtml(text);
  const q = query.trim();
  if (!q) return escapeHtml(text);

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  let i = 0;
  let html = "";

  while (i < text.length) {
    const idx = lower.indexOf(qLower, i);
    if (idx === -1) {
      html += escapeHtml(text.slice(i));
      break;
    }
    html += escapeHtml(text.slice(i, idx));
    html += `<mark class="hit">${escapeHtml(text.slice(idx, idx + q.length))}</mark>`;
    i = idx + q.length;
  }
  return html;
}
