const MODE_COPY = {
  rag: "Ask from an uploaded PDF. Answers stay inside the extracted text.",
  translate: "Translate the extracted document into a major Indian language.",
  chat: "General Indian-law questions. No PDF or vector lookup.",
};

const state = {
  mode: "rag",
  documentName: null,
  documentReady: false,
  lastAnswer: "",
};

function $(id) {
  return document.getElementById(id);
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

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

$("askBtn").addEventListener("click", () => {
  const preview =
    state.mode === "translate"
      ? "Translation will run against the uploaded document once the API is connected."
      : "Connect the API to send this question to LexCloud.";
  typeAnswer(preview);
});

setMode("rag");
