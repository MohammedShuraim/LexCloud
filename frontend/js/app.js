const MODE_COPY = {
  rag: "Ask from an uploaded PDF. Answers stay inside the extracted text.",
  translate: "Translate the extracted document into a major Indian language.",
  chat: "General Indian-law questions. No PDF or vector lookup.",
};

const state = {
  mode: "rag",
  file: null,
  documentName: null,
  documentReady: false,
  lastAnswer: "",
  recording: false,
  transcribing: false,
  busy: false,
};

function $(id) {
  return document.getElementById(id);
}

function setDocStatus(kind, label) {
  const pill = $("docStatus");
  pill.classList.remove("is-ready", "is-busy");
  if (kind) pill.classList.add(kind);
  $("docStatusLabel").textContent = label;
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

function renderAnswer(text, options = {}) {
  const el = $("answer");
  const content = String(text || "");
  el.classList.remove("is-empty", "caret");
  el.classList.toggle("is-translation", Boolean(options.translation));
  if (!content) {
    el.classList.add("is-empty");
    el.textContent = "The bench is clear. Upload a document or ask a question.";
    state.lastAnswer = "";
    $("listenBtn").disabled = true;
    return;
  }
  el.innerHTML = options.translation ? formatPlainDocument(content) : formatAnswer(content);
  state.lastAnswer = content;
  $("listenBtn").disabled = !content;
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
  state.file = file;
  state.documentReady = false;
  state.documentName = null;
  $("dropLabel").textContent = file.name;
  setDocStatus("is-busy", "Uploading");
  setProgress(5);
  const meta = await LexCloudApi.requestUpload(file);
  await LexCloudApi.putFile(meta.uploadUrl, file, setProgress);
  state.documentName = meta.document_name;
  setDocStatus("is-busy", "Extracting text");
  setProgress(100);
  await LexCloudApi.waitForDocument(meta.document_name, (info) => {
    setDocStatus("is-busy", info.status === "PROCESSING" ? "Extracting text" : info.status || "Waiting");
  });
  state.documentReady = true;
  setDocStatus("is-ready", "Document ready");
}

async function translateDocument() {
  let offset = 0;
  const parts = [];
  showProgress("Translating the full document…");
  renderAnswer("Working through the document in order so nothing is dropped.", { translation: true });
  while (true) {
    const res = await LexCloudApi.query({
      document_name: state.documentName,
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
    renderAnswer(parts.join("\n\n"), { translation: true });
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
        renderAnswer("Type a legal question, or record one.");
        return;
      }
      renderAnswer("Consulting the general desk…");
      const res = await LexCloudApi.query({
        document_name: "GENERAL_QUERY",
        query,
      });
      renderAnswer(res.answer || "No answer returned.");
      return;
    }
    if (!state.documentReady || !state.documentName) {
      renderAnswer("Upload a PDF and wait until the document is ready.");
      return;
    }
    if (state.mode === "translate") {
      await translateDocument();
      return;
    }
    const query = $("queryInput").value.trim();
    if (!query) {
      renderAnswer("Ask a question about the uploaded document.");
      return;
    }
    renderAnswer("Retrieving clauses and drafting an opinion…");
    const res = await LexCloudApi.query({
      document_name: state.documentName,
      query,
    });
    renderAnswer(res.answer || "No answer returned.");
  } catch (err) {
    renderAnswer(err.message || String(err));
  } finally {
    setBusy(false);
    setRecordUi();
  }
}

async function transcribeBlob(blob) {
  if (!blob || !blob.size) {
    renderAnswer("No audio was captured. Press Record, speak, then press Stop.");
    return;
  }
  state.transcribing = true;
  setRecordUi();
  try {
    renderAnswer("Transcribing your recording…");
    const res = await LexCloudApi.transcribe(blob);
    const text = (res.transcription || "").trim();
    $("queryInput").value = text;
    if (!text) {
      renderAnswer("Whisper returned empty text. Try a shorter, clearer clip.");
      return;
    }
    if (state.mode === "translate") {
      renderAnswer(`Heard: “${text}”\n\nChoose a language and press Translate document.`);
    } else {
      renderAnswer(`Heard: “${text}”\n\nPress Ask LexCloud to send this question.`);
    }
  } catch (err) {
    renderAnswer(err.message || String(err));
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
    renderAnswer(err.message);
  }
});
$("pdfInput").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    await ingestPdf(file);
  } catch (err) {
    setDocStatus("", "Upload failed");
    renderAnswer(err.message);
  }
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
    renderAnswer(`Microphone unavailable: ${err.message}`);
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
    renderAnswer(err.message);
  }
});

setMode("rag");
setRecordUi();
if (!LexCloudApi.baseUrl() || LexCloudApi.baseUrl().includes("YOUR_API_ID")) {
  renderAnswer("Frontend is ready. Deploy the API, then set apiBaseUrl in js/config.js (Amplify injects this in production).");
}
