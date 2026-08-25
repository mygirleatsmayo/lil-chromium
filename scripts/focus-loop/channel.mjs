// LILFOCUS control channel (issue #30).
//
// The two halves of one duplex link to the extension:
//
//   out  a relay socket line — the private diagnostic control documented in
//        docs/PROTOCOL.md. The host validates it and forwards only operations
//        that contract defines.
//   in   a loopback HTTP collector the extension posts its records to. Its URL
//        is never sent: the extension derives it from the run's port and id, so
//        this module and the seam have to agree on the same shape.
//
// Opening a channel changes nothing on screen. That is what lets the run prove
// the seam is live during preflight, before it touches a single window.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const STATE_DIR = path.join(os.homedir(), ".lilchromium");
const CONTROL_TYPE = "lil-focus-trace";

export function socketPath(browser) {
  return path.join(STATE_DIR, `relay-${browser}.sock`);
}

export function relayIsUp(browser) {
  return fs.existsSync(socketPath(browser));
}

function sendToRelay(browser, message) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath(browser));
    socket.on("error", reject);
    socket.on("connect", () => socket.end(JSON.stringify(message) + "\n", () => resolve()));
  });
}

/** Disarm `browser`'s seam without opening a channel. Used by `cleanup`. */
export function disarmRelay(browser) {
  return sendToRelay(browser, { type: CONTROL_TYPE, op: "disarm" });
}

/**
 * Open the run's channel: start the collector, then return the four control
 * operations bound to this run. Nothing is armed until `arm()` is called.
 */
export async function openChannel({ browser, port, runId, onRecord }) {
  const collectorPath = `/t/${runId}`;
  const server = http.createServer((req, res) => {
    // Only this run's own path is accepted, so a forgotten worker still armed
    // for an earlier run cannot post into this run's trace.
    if (req.method !== "POST" || req.url !== collectorPath) {
      res.writeHead(req.method === "POST" ? 404 : 405).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        onRecord(JSON.parse(body));
      } catch (_) {
        // A malformed record must not take the collector down mid-run.
      }
      res.writeHead(204).end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const send = (message) => sendToRelay(browser, { type: CONTROL_TYPE, ...message });
  return {
    endpoint: `http://127.0.0.1:${port}${collectorPath}`,
    arm: (ttlMs) => send({ op: "arm", runId, port, ttlMs }),
    disarm: () => send({ op: "disarm" }),
    snapshot: (label) => send({ op: "snapshot", label }),
    closeLil: (windowId) => send({ op: "close-lil", runId, windowId }),
    async close() {
      await send({ op: "disarm" }).catch(() => {});
      server.close();
    },
  };
}
