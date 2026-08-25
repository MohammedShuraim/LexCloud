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

function showFile(file) {
  state.file = file;
  state.documentName = file ? file.name : null;
  state.documentReady = Boolean(file);
  $("dropLabel").textContent = file ? file.name : "Drop a contract or statute, or browse";
  if (file) {
    setDocStatus("is-busy", "Selected locally");
    setProgress(12);
    window.setTimeout(() => {
      setProgress(100);
      setDocStatus("is-ready", "Ready to upload");
    }, 400);
  } else {
    setDocStatus("", "No document");
    setProgress(0);
  }
}

function setRecordUi() {
  $("recordBtn").textContent = state.recording ? "Stop" : state.reviewing ? "Re-record" : "Record";
  $("recordBtn").classList.toggle("is-live", state.recording);
  $("discardBtn").classList.toggle("hidden", !state.reviewing);
  $("submitAudioBtn").classList.toggle("hidden", !state.reviewing);
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
dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file && file.type === "application/pdf") showFile(file);
});
$("pdfInput").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) showFile(file);
});

$("askBtn").addEventListener("click", () => {
  const preview =
    state.mode === "translate"
      ? "Translation will run against the uploaded document once the API is connected."
      : "Connect the API to send this question to LexCloud.";
  typeAnswer(preview);
});

$("recordBtn").addEventListener("click", async () => {
  try {
    if (state.recording) {
      await LexCloudRecorder.stop();
      state.recording = false;
      state.reviewing = true;
      setRecordUi();
      typeAnswer("Recording captured. Discard it or use it as your question once Whisper is connected.");
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

$("submitAudioBtn").addEventListener("click", () => {
  const blob = LexCloudRecorder.currentBlob();
  if (!blob) return;
  $("queryInput").value = "(voice clip ready — transcription will fill this after Whisper is wired)";
  state.reviewing = false;
  setRecordUi();
});

$("listenBtn").addEventListener("click", () => {
  if (!state.lastAnswer) return;
  const player = $("ttsPlayer");
  player.classList.remove("hidden");
  typeAnswer(`${state.lastAnswer}\n\n(Polly playback will attach here once TTS is connected.)`);
});

setMode("rag");
setRecordUi();
