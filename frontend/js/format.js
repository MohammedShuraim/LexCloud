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

function formatAnswer(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const lines = text.split("\n");
  const out = [];
  let list = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      list = closeList(out, list);
      continue;
    }
    if (/^---+$/.test(line)) {
      list = closeList(out, list);
      out.push("<hr />");
      continue;
    }
    const atx = line.match(/^(#{1,3})\s+(.+)$/);
    if (atx) {
      list = closeList(out, list);
      const level = Math.min(atx[1].length + 1, 4);
      out.push(`<h${level}>${inlineMarkdown(atx[2].replace(/\*\*/g, ""))}</h${level}>`);
      continue;
    }
    const numberedTitle = line.match(/^\*\*(\d+\.\s+[^:*]+):?\*\*:?\s*(.*)$/);
    if (numberedTitle) {
      list = closeList(out, list);
      out.push(`<h3>${inlineMarkdown(numberedTitle[1])}</h3>`);
      if (numberedTitle[2]) out.push(`<p>${inlineMarkdown(numberedTitle[2])}</p>`);
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
      continue;
    }
    list = closeList(out, list);
    out.push(`<p>${inlineMarkdown(line)}</p>`);
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
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
