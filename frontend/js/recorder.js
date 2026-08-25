const LexCloudRecorder = (() => {
  const TARGET_RATE = 44100;
  const MAX_MS = 120000;

  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let raf = 0;
  let startedAt = 0;
  let blob = null;
  let maxTimer = 0;
  let onAutoStop = null;

  function canvas() {
    return document.getElementById("wave");
  }

  function draw() {
    const cvs = canvas();
    if (!cvs || !analyser) return;
    const ctx = cvs.getContext("2d");
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.strokeStyle = "#d4af6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const slice = cvs.width / data.length;
    for (let i = 0; i < data.length; i += 1) {
      const v = data[i] / 128.0;
      const y = (v * cvs.height) / 2;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    raf = requestAnimationFrame(draw);
  }

  async function start(options = {}) {
    blob = null;
    chunks = [];
    onAutoStop = options.onAutoStop || null;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TARGET_RATE,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
    sourceNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    mediaRecorder.start(200);
    startedAt = Date.now();
    canvas().classList.remove("hidden");
    draw();
    window.clearTimeout(maxTimer);
    maxTimer = window.setTimeout(async () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        const file = await stop();
        if (onAutoStop) onAutoStop(file);
      }
    }, MAX_MS);
  }

  function stop() {
    return new Promise((resolve) => {
      window.clearTimeout(maxTimer);
      if (!mediaRecorder) {
        resolve(blob);
        return;
      }
      mediaRecorder.onstop = () => {
        cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach((track) => track.stop());
        blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        if (audioCtx && audioCtx.state !== "closed") audioCtx.close();
        mediaRecorder = null;
        stream = null;
        resolve(blob);
      };
      if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
      else resolve(blob);
    });
  }

  function discard() {
    window.clearTimeout(maxTimer);
    blob = null;
    chunks = [];
    canvas().classList.add("hidden");
  }

  function currentBlob() {
    return blob;
  }

  function elapsedMs() {
    return startedAt ? Date.now() - startedAt : 0;
  }

  return { start, stop, discard, currentBlob, elapsedMs };
})();
