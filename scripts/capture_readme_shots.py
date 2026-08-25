"""Capture LexCloud UI frames for the README showcase. Not part of the runtime."""

from __future__ import annotations

import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
OUT = ROOT / "docs" / "screenshots"
PORT = 4177
URL = f"http://127.0.0.1:{PORT}/index.html"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def log_message(self, format, *args):
        return


def seed_rag(page):
    page.evaluate(
        """() => {
          setMode("rag");
          state.doc.file = { name: "Simple-1-Page-Residential-Lease-Agreement.pdf" };
          state.doc.ready = true;
          state.doc.documentName = "uploads/demo-lease.pdf";
          $("dropLabel").textContent = "Simple-1-Page-Residential-Lease-Agreement.pdf";
          $("queryInput").value = "Who are the parties, and what is the lease period?";
          paintDocStatus();
          $("listenBtn").disabled = false;
        }"""
    )
    page.evaluate(
        """async () => {
          await renderAnswer(`Parties and term

The lease is between **Aarav Mehta** (landlord) and **Diya Sharma** (tenant) for the flat at 12, Lake View Road, Bengaluru.

| Field | Clause |
|---|---|
| Term | 11 months from 1 April 2026 |
| Rent | Rs 28,000 per month, payable by the 5th |
| Deposit | Two months' rent, refundable |
| Notice | 30 days written notice by either party |

Grounded in the uploaded PDF — LexCloud is not substituting for a lawyer.`, { instant: true });
        }"""
    )


def seed_translate(page):
    page.evaluate(
        """() => {
          setMode("translate");
          state.doc.file = { name: "Simple-1-Page-Residential-Lease-Agreement.pdf" };
          state.doc.ready = true;
          state.doc.documentName = "uploads/demo-lease.pdf";
          $("dropLabel").textContent = "Simple-1-Page-Residential-Lease-Agreement.pdf";
          $("langSelect").value = "hi";
          paintDocStatus();
          showProgress("Full document translated");
        }"""
    )
    page.evaluate(
        """async () => {
          await renderAnswer(
            "यह पट्टा करार मकान मालिक आरव मेहता और किरायेदार दिया शर्मा के बीच है। अवधि 1 अप्रैल 2026 से ग्यारह महीने है। मासिक किराया 28,000 रुपये है, जो प्रत्येक माह की 5 तारीख तक देय है। जमानत दो महीने के किराए के बराबर है।",
            { translation: true, instant: true }
          );
        }"""
    )


def seed_chat(page):
    page.evaluate(
        """() => {
          setMode("chat");
          $("queryInput").value = "What is the difference between a lease and a licence under Indian law?";
          $("listenBtn").disabled = false;
        }"""
    )
    page.evaluate(
        """async () => {
          await renderAnswer(`Lease vs licence

A **lease** under the Transfer of Property Act, 1882 creates an interest in immovable property for a term. A **licence** under the Easements Act, 1882 is only permission to do something on the land — it does not create a transferable interest.

| Test | Lease | Licence |
|---|---|---|
| Exclusive possession | Usually yes | Usually no |
| Interest in land | Yes | No |
| Transferable | Generally yes | Personal to the licensee |

This is general Indian-law chat. Upload a PDF in RAG if you want answers grounded in a specific instrument.`, { instant: true });
        }"""
    )


def seed_recorder(page):
    page.evaluate(
        """() => {
          setMode("rag");
          state.doc.file = { name: "Simple-1-Page-Residential-Lease-Agreement.pdf" };
          state.doc.ready = true;
          state.doc.documentName = "uploads/demo-lease.pdf";
          $("dropLabel").textContent = "Simple-1-Page-Residential-Lease-Agreement.pdf";
          $("queryInput").value = "Summarise the lock-in and notice period";
          paintDocStatus();
          state.recording = true;
          setRecordUi();
          const canvas = $("wave");
          canvas.classList.remove("hidden");
          const ctx = canvas.getContext("2d");
          const w = canvas.width;
          const h = canvas.height;
          ctx.fillStyle = "#0b1210";
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = "#d4af6a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let x = 0; x < w; x += 1) {
            const y = h / 2 + Math.sin(x / 18) * (18 + 22 * Math.abs(Math.sin(x / 70)));
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }"""
    )
    page.evaluate(
        """async () => {
          await renderAnswer("Recording. Speak your question, then press Stop — Whisper fills the box automatically.", { instant: true });
        }"""
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": 1280, "height": 900},
            device_scale_factor=2,
        )
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1200)

        seed_rag(page)
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "rag.jpg"), full_page=True, type="jpeg", quality=82)

        page.screenshot(
            path=str(OUT / "amplify.jpg"),
            full_page=False,
            type="jpeg",
            quality=82,
            clip={"x": 0, "y": 0, "width": 1280, "height": 720},
        )

        seed_translate(page)
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "translate.jpg"), full_page=True, type="jpeg", quality=82)

        seed_chat(page)
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "chat.jpg"), full_page=True, type="jpeg", quality=82)

        seed_recorder(page)
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "recorder.jpg"), full_page=True, type="jpeg", quality=82)

        browser.close()
    httpd.shutdown()
    print("wrote", list(OUT.glob("*.jpg")))


if __name__ == "__main__":
    main()
