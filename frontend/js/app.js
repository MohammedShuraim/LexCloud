const MODE_COPY = {
  rag: "Ask from an uploaded PDF. This file is used only in RAG.",
  translate: "Translate a PDF into a major Indian language. Upload here is separate from RAG.",
  chat: "General Indian-law questions. Chat never reads a PDF.",
};

const DROP_HINT = {
  rag: "This file is used only for RAG questions.",
  translate: "This file is used only for translation.",
};

const state = {
  mode: "rag",
  docs: {
    rag: emptyDoc(),
    translate: emptyDoc(),
  },
  lastAnswer: "",
  recording: false,
  transcribing: false,
  busy: false,
  revealToken: 0,
};

function emptyDoc() {
  return { file: null, documentName: null, ready: false };
}

function $(id) {
  return document.getElementById(id);
}

function activeDoc() {
  if (state.mode === "chat") return null;
  return state.docs[state.mode];
}

function setDocStatus(kind, label) {
  const pill = $("docStatus");
  pill.classList.remove("is-ready", "is-busy");
  if (kind) pill.classList.add(kind);
  $("docStatusLabel").textContent = label;
}

function paintDocStatus() {
  if (state.mode === "chat") {
    setDocStatus("", "Chat only");
    return;
  }
  const doc = activeDoc();
  if (doc.ready) setDocStatus("is-ready", `${state.mode === "rag" ? "RAG" : "Translate"} ready`);
  else if (doc.documentName) setDocStatus("is-busy", "Extracting text");
  else setDocStatus("", "No document");
}

function setBusy(busy) {
  state.busy = busy;
  $("askBtn").disabled = busy;
  $("recordBtn").disabled = busy || state.transcribing;
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === mode);
  });
  $("modeCopy").textContent = MODE_COPY[mode];
  $("documentPanel").classList.toggle("hidden", mode === "chat");
  $("translatePanel").classList.toggle("hidden", mode !== "translate");
  $("queryPanel").classList.toggle("hidden", mode === "translate");
  $("askBtn").textContent = mode === "translate" ? "Translate document" : "Ask LexCloud";
  $("translateProgress").classList.add("hidden");
  const doc = activeDoc();
  if (doc && doc.file) $("dropLabel").textContent = doc.file.name;
  else $("dropLabel").textContent = "Drop a contract or statute, or browse";
  $("dropHint").textContent = DROP_HINT[mode] || "";
  paintDocStatus();
}

function showProgress(label) {
  const el = $("translateProgress");
  if (!label) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = label;
  el.classList.remove("hidden");
}

async function renderAnswer(text, options = {}) {
  const el = $("answer");
  const content = String(text || "");
  const token = ++state.revealToken;
  el.classList.remove("is-empty", "caret");
  el.classList.toggle("is-translation", Boolean(options.translation));
  if (!content) {
    el.classList.add("is-empty");
    el.textContent = "The bench is clear. Upload a document or ask a question.";
    state.lastAnswer = "";
    $("listenBtn").disabled = true;
    return;
  }
  state.lastAnswer = content;
  $("listenBtn").disabled = !content;
  const html = options.translation ? formatPlainDocument(content) : formatAnswer(content);
  if (options.instant || options.translation) {
    el.innerHTML = html;
    return;
  }
  const blocks = htmlToBlocks(html);
  el.innerHTML = "";
  for (const block of blocks) {
    if (token !== state.revealToken) return;
    const wrap = document.createElement("div");
    wrap.className = "answer-block";
    wrap.innerHTML = block;
    el.appendChild(wrap);
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
}

function setProgress(pct) {
  $("uploadProgress").style.width = `${pct}%`;
}

function setRecordUi() {
  if (state.transcribing) $("recordBtn").textContent = "Transcribing";
  else if (state.recording) $("recordBtn").textContent = "Stop";
  else $("recordBtn").textContent = "Record";
  $("recordBtn").classList.toggle("is-live", state.recording);
  $("recordBtn").disabled = state.busy || state.transcribing;
}

async function ingestPdf(file) {
  if (state.mode === "chat") return;
  const slot = state.mode;
  const doc = state.docs[slot];
  doc.file = file;
  doc.ready = false;
  doc.documentName = null;
  $("dropLabel").textContent = file.name;
  setDocStatus("is-busy", "Uploading");
  setProgress(5);
  const meta = await LexCloudApi.requestUpload(file);
  await LexCloudApi.putFile(meta.uploadUrl, file, setProgress);
  doc.documentName = meta.document_name;
  setDocStatus("is-busy", "Extracting text");
  setProgress(100);
  await LexCloudApi.waitForDocument(meta.document_name, (info) => {
    if (state.mode === slot) {
      setDocStatus("is-busy", info.status === "PROCESSING" ? "Extracting text" : info.status || "Waiting");
    }
  });
  doc.ready = true;
  if (state.mode === slot) paintDocStatus();
}

async function translateDocument() {
  const doc = state.docs.translate;
  let offset = 0;
  const parts = [];
  showProgress("Translating the full document…");
  await renderAnswer("Working through this Translate upload in order.", { translation: true, instant: true });
  while (true) {
    const res = await LexCloudApi.query({
      document_name: doc.documentName,
      query: "FETCH_FULL_TRANSLATION",
      target_language: $("langSelect").value,
      offset,
    });
    if (res.answer) parts.push(res.answer);
    const total = Number(res.total) || 0;
    const next = Number(res.next_offset) || offset;
    if (total) {
      const pct = Math.min(100, Math.round((next / total) * 100));
      showProgress(`Translated ${next.toLocaleString()} of ${total.toLocaleString()} characters (${pct}%)`);
    }
    await renderAnswer(parts.join("\n\n"), { translation: true, instant: true });
    if (res.done || next <= offset) break;
    offset = next;
  }
  showProgress("Full document translated");
}

async function ask() {
  if (state.busy) return;
  try {
    setBusy(true);
    showProgress("");
    if (state.mode === "chat") {
      const query = $("queryInput").value.trim();
      if (!query) {
        await renderAnswer("Type a legal question, or record one.", { instant: true });
        return;
      }
      await renderAnswer("Consulting the general desk…", { instant: true });
      const res = await LexCloudApi.query({
        document_name: "GENERAL_QUERY",
        query,
      });
      await renderAnswer(res.answer || "No answer returned.");
      return;
    }
    const doc = activeDoc();
    if (!doc || !doc.ready || !doc.documentName) {
      await renderAnswer(
        state.mode === "translate"
          ? "Upload a PDF in Translate. RAG uploads are not reused here."
          : "Upload a PDF in RAG. Translate uploads are not reused here.",
        { instant: true }
      );
      return;
    }
    if (state.mode === "translate") {
      await translateDocument();
      return;
    }
    const query = $("queryInput").value.trim();
    if (!query) {
      await renderAnswer("Ask a question about the RAG document.", { instant: true });
      return;
    }
    await renderAnswer("Retrieving clauses and drafting an opinion…", { instant: true });
    const res = await LexCloudApi.query({
      document_name: doc.documentName,
      query,
    });
    await renderAnswer(res.answer || "No answer returned.");
  } catch (err) {
    await renderAnswer(friendlyError(err), { instant: true });
  } finally {
    setBusy(false);
    setRecordUi();
  }
}

async function transcribeBlob(blob) {
  if (!blob || !blob.size) {
    await renderAnswer("No audio was captured. Press Record, speak, then press Stop.", { instant: true });
    return;
  }
  state.transcribing = true;
  setRecordUi();
  try {
    await renderAnswer("Transcribing your recording…", { instant: true });
    const res = await LexCloudApi.transcribe(blob);
    const text = (res.transcription || "").trim();
    $("queryInput").value = text;
    if (!text) {
      await renderAnswer("Whisper returned empty text. Try a shorter, clearer clip.", { instant: true });
      return;
    }
    if (state.mode === "translate") {
      await renderAnswer("Recording captured. Choose a language and press Translate document.", { instant: true });
    } else {
      await renderAnswer(`Heard: “${text}”\n\nPress Ask LexCloud to send this question.`, { instant: true });
    }
  } catch (err) {
    await renderAnswer(friendlyError(err), { instant: true });
  } finally {
    state.transcribing = false;
    LexCloudRecorder.discard();
    setRecordUi();
  }
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

const dropzone = $("dropzone");
["dragenter", "dragover"].forEach((name) => {
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-drag");
  });
});
["dragleave", "drop"].forEach((name) => {
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-drag");
  });
});
dropzone.addEventListener("drop", async (event) => {
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file || file.type !== "application/pdf") return;
  try {
    await ingestPdf(file);
  } catch (err) {
    setDocStatus("", "Upload failed");
    await renderAnswer(friendlyError(err), { instant: true });
  }
});
$("pdfInput").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    await ingestPdf(file);
  } catch (err) {
    setDocStatus("", "Upload failed");
    await renderAnswer(friendlyError(err), { instant: true });
  }
  event.target.value = "";
});

$("askBtn").addEventListener("click", ask);

$("recordBtn").addEventListener("click", async () => {
  try {
    if (state.transcribing) return;
    if (state.recording) {
      const blob = await LexCloudRecorder.stop();
      state.recording = false;
      setRecordUi();
      await transcribeBlob(blob);
      return;
    }
    await LexCloudRecorder.start({
      onAutoStop: async (blob) => {
        state.recording = false;
        setRecordUi();
        await transcribeBlob(blob);
      },
    });
    state.recording = true;
    setRecordUi();
  } catch (err) {
    state.recording = false;
    setRecordUi();
    await renderAnswer(`Microphone unavailable: ${err.message}`, { instant: true });
  }
});

$("listenBtn").addEventListener("click", async () => {
  if (!state.lastAnswer) return;
  try {
    const spoken = plainForSpeech(state.lastAnswer).slice(0, 2800);
    const res = await LexCloudApi.speak(spoken);
    const player = $("ttsPlayer");
    player.src = `data:audio/mpeg;base64,${res.audioBase64}`;
    player.classList.remove("hidden");
    await player.play();
  } catch (err) {
    await renderAnswer(friendlyError(err), { instant: true });
  }
});

setMode("rag");
setRecordUi();
if (!LexCloudApi.baseUrl() || LexCloudApi.baseUrl().includes("YOUR_API_ID")) {
  renderAnswer("Frontend is ready. Deploy the API, then set apiBaseUrl in js/config.js (Amplify injects this in production).", { instant: true });
}
