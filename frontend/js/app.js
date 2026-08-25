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
  reviewing: false,
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
}

function typeAnswer(text) {
  const el = $("answer");
  el.classList.remove("is-empty");
  el.classList.add("caret");
  el.textContent = "";
  let i = 0;
  const tick = () => {
    i += Math.max(1, Math.round(text.length / 180));
    el.textContent = text.slice(0, i);
    if (i < text.length) {
      requestAnimationFrame(tick);
    } else {
      el.classList.remove("caret");
      state.lastAnswer = text;
      $("listenBtn").disabled = !text;
    }
  };
  tick();
}

function setProgress(pct) {
  $("uploadProgress").style.width = `${pct}%`;
}

function setRecordUi() {
  $("recordBtn").textContent = state.recording ? "Stop" : state.reviewing ? "Re-record" : "Record";
  $("recordBtn").classList.toggle("is-live", state.recording);
  $("discardBtn").classList.toggle("hidden", !state.reviewing);
  $("submitAudioBtn").classList.toggle("hidden", !state.reviewing);
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
    setDocStatus("is-busy", info.status === "PROCESSING" ? "Textract running" : info.status || "Waiting");
  });
  state.documentReady = true;
  setDocStatus("is-ready", "Document ready");
}

async function ask() {
  if (state.busy) return;
  try {
    setBusy(true);
    if (state.mode === "chat") {
      const query = $("queryInput").value.trim();
      if (!query) {
        typeAnswer("Type a legal question, or record one.");
        return;
      }
      typeAnswer("Consulting the general desk…");
      const res = await LexCloudApi.query({
        document_name: "GENERAL_QUERY",
        query,
      });
      typeAnswer(res.answer || "No answer returned.");
      return;
    }
    if (!state.documentReady || !state.documentName) {
      typeAnswer("Upload a PDF and wait until the document is ready.");
      return;
    }
    if (state.mode === "translate") {
      typeAnswer("Translating the extracted text…");
      const res = await LexCloudApi.query({
        document_name: state.documentName,
        query: "FETCH_FULL_TRANSLATION",
        target_language: $("langSelect").value,
      });
      typeAnswer(res.answer || "No translation returned.");
      return;
    }
    const query = $("queryInput").value.trim();
    if (!query) {
      typeAnswer("Ask a question about the uploaded document.");
      return;
    }
    typeAnswer("Retrieving clauses and drafting an opinion…");
    const res = await LexCloudApi.query({
      document_name: state.documentName,
      query,
    });
    typeAnswer(res.answer || "No answer returned.");
  } catch (err) {
    typeAnswer(err.message || String(err));
  } finally {
    setBusy(false);
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
    typeAnswer(err.message);
  }
});
$("pdfInput").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    await ingestPdf(file);
  } catch (err) {
    setDocStatus("", "Upload failed");
    typeAnswer(err.message);
  }
});

$("askBtn").addEventListener("click", ask);

$("recordBtn").addEventListener("click", async () => {
  try {
    if (state.recording) {
      await LexCloudRecorder.stop();
      state.recording = false;
      state.reviewing = true;
      setRecordUi();
      return;
    }
    await LexCloudRecorder.start();
    state.recording = true;
    state.reviewing = false;
    setRecordUi();
  } catch (err) {
    typeAnswer(`Microphone unavailable: ${err.message}`);
  }
});

$("discardBtn").addEventListener("click", () => {
  LexCloudRecorder.discard();
  state.reviewing = false;
  setRecordUi();
});

$("submitAudioBtn").addEventListener("click", async () => {
  const blob = LexCloudRecorder.currentBlob();
  if (!blob) return;
  try {
    typeAnswer("Transcribing with Whisper…");
    const res = await LexCloudApi.transcribe(blob);
    $("queryInput").value = res.transcription || "";
    state.reviewing = false;
    setRecordUi();
    if (!$("queryInput").value) {
      typeAnswer("Whisper returned empty text. Try a shorter, clearer clip.");
    } else {
      typeAnswer("Transcription ready. Edit it if needed, then ask.");
    }
  } catch (err) {
    typeAnswer(err.message);
  }
});

$("listenBtn").addEventListener("click", async () => {
  if (!state.lastAnswer) return;
  try {
    const res = await LexCloudApi.speak(state.lastAnswer);
    const player = $("ttsPlayer");
    player.src = `data:audio/mpeg;base64,${res.audioBase64}`;
    player.classList.remove("hidden");
    await player.play();
  } catch (err) {
    typeAnswer(err.message);
  }
});

setMode("rag");
setRecordUi();
if (!LexCloudApi.baseUrl() || LexCloudApi.baseUrl().includes("YOUR_API_ID")) {
  typeAnswer("Frontend is ready. Deploy the API, then set apiBaseUrl in js/config.js (Amplify injects this in production).");
}
