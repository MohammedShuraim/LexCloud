function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function closeList(out, kind) {
  if (kind === "ul") out.push("</ul>");
  if (kind === "ol") out.push("</ol>");
  return null;
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.includes("|");
}

function isTableDivider(line) {
  if (!isTableRow(line) && !/^[\s|:-]+$/.test(line)) return false;
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function renderTable(rows) {
  if (!rows.length) return "";
  const head = rows[0];
  const body = rows.slice(1);
  const thead = `<thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<div class="table-wrap"><table>${thead}${tbody}</table></div>`;
}

function isSectionTitle(line, next) {
  if (!line || line.length < 8 || line.length > 86) return false;
  if (/[.!?]$/.test(line)) return false;
  if (/[|]/.test(line)) return false;
  if (/^[-*•\d]/.test(line)) return false;
  if (/\*\*/.test(line)) return false;
  const nextIsTable = next && isTableRow(next);
  const nextIsBody = next && (next.length > line.length || /[–—-]/.test(next));
  return nextIsTable || nextIsBody;
}

function htmlToBlocks(html) {
  const box = document.createElement("div");
  box.innerHTML = html;
  return Array.from(box.children).map((node) => node.outerHTML);
}

function formatAnswer(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const lines = text.split("\n");
  const out = [];
  let list = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const next = (lines[i + 1] || "").trim();

    if (!line) {
      list = closeList(out, list);
      i += 1;
      continue;
    }

    if (isTableRow(line) || isTableDivider(line)) {
      list = closeList(out, list);
      const rows = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (!current) break;
        if (isTableDivider(current)) {
          i += 1;
          continue;
        }
        if (!isTableRow(current)) break;
        rows.push(parseTableRow(current));
        i += 1;
      }
      if (rows.length) out.push(renderTable(rows));
      continue;
    }

    if (/^---+$/.test(line)) {
      list = closeList(out, list);
      out.push("<hr />");
      i += 1;
      continue;
    }

    const atx = line.match(/^(#{1,3})\s+(.+)$/);
    if (atx) {
      list = closeList(out, list);
      const level = Math.min(atx[1].length + 1, 4);
      out.push(`<h${level}>${inlineMarkdown(atx[2].replace(/\*\*/g, ""))}</h${level}>`);
      i += 1;
      continue;
    }

    const numberedTitle = line.match(/^\*\*(\d+\.\s+[^:*]+):?\*\*:?\s*(.*)$/);
    if (numberedTitle) {
      list = closeList(out, list);
      out.push(`<h3>${inlineMarkdown(numberedTitle[1])}</h3>`);
      if (numberedTitle[2]) out.push(`<p>${inlineMarkdown(numberedTitle[2])}</p>`);
      i += 1;
      continue;
    }

    if (isSectionTitle(line, next)) {
      list = closeList(out, list);
      out.push(`<h3>${inlineMarkdown(line)}</h3>`);
      i += 1;
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (list !== "ul") {
        list = closeList(out, list);
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      i += 1;
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      if (list !== "ol") {
        list = closeList(out, list);
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inlineMarkdown(numbered[1])}</li>`);
      i += 1;
      continue;
    }

    const def = line.match(/^(.{2,48}?)\s+[–—-]\s+(.+)$/);
    if (def) {
      list = closeList(out, list);
      out.push(
        `<p class="def"><strong>${inlineMarkdown(def[1])}</strong><span>${inlineMarkdown(def[2])}</span></p>`
      );
      i += 1;
      continue;
    }

    list = closeList(out, list);
    out.push(`<p>${inlineMarkdown(line)}</p>`);
    i += 1;
  }
  closeList(out, list);
  return out.join("");
}

function formatPlainDocument(text) {
  const parts = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!parts.length) {
    return `<p>${inlineMarkdown(text)}</p>`;
  }
  return parts
    .map((block) => `<p>${inlineMarkdown(block.replace(/\n/g, " "))}</p>`)
    .join("");
}

function plainForSpeech(text) {
  return String(text || "")
    .replace(/[#*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function friendlyError(err) {
  const msg = err && err.message ? err.message : String(err || "");
  if (/429/.test(msg)) {
    return "The legal model is busy right now (rate limit). Wait a few seconds, then ask again.";
  }
  if (/503|502/.test(msg)) {
    return "The model backend is briefly unavailable. Please try once more.";
  }
  return msg || "Something went wrong. Please try again.";
}
