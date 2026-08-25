const LexCloudApi = (() => {
  function baseUrl() {
    const cfg = window.LEXCLOUD_CONFIG || {};
    return String(cfg.apiBaseUrl || "").replace(/\/$/, "");
  }

  function assertConfigured() {
    if (!baseUrl() || baseUrl().includes("YOUR_API_ID")) {
      throw new Error("Set frontend/js/config.js with the deployed ApiBaseUrl.");
    }
  }

  async function parseJson(res) {
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      data = { error: text || res.statusText };
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `Request failed (${res.status})`);
    }
    return data;
  }

  async function requestUpload(file) {
    assertConfigured();
    const res = await fetch(`${baseUrl()}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || "application/pdf",
      }),
    });
    return parseJson(res);
  }

  function putFile(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type || "application/pdf");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`S3 upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("S3 upload network error"));
      xhr.send(file);
    });
  }

  async function getDocument(documentName) {
    assertConfigured();
    const res = await fetch(
      `${baseUrl()}/document?document_name=${encodeURIComponent(documentName)}`
    );
    return parseJson(res);
  }

  async function waitForDocument(documentName, onTick) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const info = await getDocument(documentName);
      if (onTick) onTick(info);
      if (info.ready) return info;
      if (info.status === "FAILED") {
        throw new Error(info.error || "Textract failed to extract this PDF");
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error("Timed out waiting for document processing");
  }

  async function query(payload) {
    assertConfigured();
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await fetch(`${baseUrl()}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (err) {
        data = { error: text || res.statusText };
      }
      const busy = res.status === 429 || /429/.test(JSON.stringify(data));
      if (busy && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        lastError = new Error(data.error || "Groq API 429");
        continue;
      }
      if (!res.ok) {
        throw new Error(data.error || data.message || `Request failed (${res.status})`);
      }
      return data;
    }
    throw lastError || new Error("Groq API 429");
  }

  async function speak(text) {
    assertConfigured();
    const res = await fetch(`${baseUrl()}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return parseJson(res);
  }

  async function transcribe(blob) {
    assertConfigured();
    const form = new FormData();
    const name = blob.type && blob.type.includes("wav") ? "voice.wav" : "voice.webm";
    form.append("file", blob, name);
    const res = await fetch(`${baseUrl()}/transcribe`, {
      method: "POST",
      body: form,
    });
    return parseJson(res);
  }

  return {
    baseUrl,
    requestUpload,
    putFile,
    waitForDocument,
    query,
    speak,
    transcribe,
  };
})();
