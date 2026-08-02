/**
 * Lifecycle + client for a local whisper.cpp `whisper-server` process.
 *
 * The server is spawned lazily on first transcription (model loads once into
 * RAM), reused across segments, and shut down after an idle period to release
 * memory. No native Node module is involved — we spawn a plain binary, so
 * there is no Electron ABI concern.
 *
 * This module must stay free of `vscode` imports so it is unit-testable.
 */

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

const VOICE_WAV_SAMPLE_RATE = 16_000;

/** Encode mono little-endian int16 PCM as a WAV file body. */
export function encodeWavPcm16(pcm: Int16Array, sampleRate = VOICE_WAV_SAMPLE_RATE): Uint8Array {
  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataLen, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

type TranscriberState = "idle" | "starting" | "ready";

export interface SpawnedServer {
  kill: () => void;
  onExit: (cb: () => void) => void;
}

interface WhisperTranscriberOptions {
  binaryPath: string;
  modelPath: string;
  /** whisper.cpp language code, or "auto". */
  language?: string;
  /** Shut the server down after this much inactivity. */
  idleTimeoutMs?: number;
  /** Server startup deadline. */
  startTimeoutMs?: number;
  /** Injectable for tests. */
  spawnImpl?: (binaryPath: string, args: string[]) => SpawnedServer;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests (defaults to a free ephemeral port). */
  pickPort?: () => Promise<number>;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function spawnServerProcess(binaryPath: string, args: string[]): SpawnedServer {
  const child: ChildProcess = spawn(binaryPath, args, { stdio: "ignore" });
  return {
    kill: () => child.kill(),
    onExit: (cb) => child.once("exit", cb),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class WhisperTranscriber {
  private serverState: TranscriberState = "idle";
  private server: SpawnedServer | null = null;
  private port = 0;
  private startPromise: Promise<void> | null = null;
  /** Serialize transcriptions: whisper-server handles one inference at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  private readonly language: string;
  private readonly idleTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly spawnImpl: (binaryPath: string, args: string[]) => SpawnedServer;
  private readonly fetchImpl: typeof fetch;
  private readonly pickPort: () => Promise<number>;

  constructor(private readonly opts: WhisperTranscriberOptions) {
    this.language = opts.language ?? "auto";
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 120_000;
    this.startTimeoutMs = opts.startTimeoutMs ?? 30_000;
    this.spawnImpl = opts.spawnImpl ?? spawnServerProcess;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.pickPort = opts.pickPort ?? getFreePort;
  }

  get state(): TranscriberState {
    return this.serverState;
  }

  /** Transcribe one PCM segment (16 kHz mono int16). Returns trimmed text. */
  async transcribe(pcm: Int16Array): Promise<string> {
    if (this.disposed) throw new Error("transcriber disposed");
    const run = this.queue.then(async () => {
      await this.ensureServer();
      return this.requestInference(pcm);
    });
    // Keep the chain alive even if this job fails.
    this.queue = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.scheduleIdleShutdown();
    }
  }

  private async ensureServer(): Promise<void> {
    if (this.serverState === "ready") return;
    if (!this.startPromise) {
      this.startPromise = this.startServer().catch((err) => {
        this.shutdown();
        throw err;
      });
    }
    await this.startPromise;
  }

  private async startServer(): Promise<void> {
    this.serverState = "starting";
    this.port = await this.pickPort();
    this.server = this.spawnImpl(this.opts.binaryPath, [
      "--model",
      this.opts.modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(this.port),
      "--language",
      this.language,
    ]);
    this.server.onExit(() => {
      // Crash or external kill: reset so the next transcribe() restarts it.
      if (!this.disposed) this.shutdown();
    });

    const deadline = Date.now() + this.startTimeoutMs;
    // Poll until the HTTP endpoint answers (model load can take seconds).
    for (;;) {
      if (this.disposed) throw new Error("transcriber disposed");
      try {
        const res = await this.fetchImpl(`http://127.0.0.1:${this.port}/`, { method: "GET" });
        if (res.status < 500) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        throw new Error("speech engine did not start in time");
      }
      await sleep(200);
    }
    this.serverState = "ready";
  }

  private async requestInference(pcm: Int16Array): Promise<string> {
    const wav = encodeWavPcm16(pcm);
    const form = new FormData();
    form.append("file", new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), "segment.wav");
    form.append("response_format", "json");
    form.append("temperature", "0");
    const res = await this.fetchImpl(`http://127.0.0.1:${this.port}/inference`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new Error(`speech engine error: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  }

  private scheduleIdleShutdown(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.shutdown(), this.idleTimeoutMs);
    // Do not hold the extension host open just for the idle timer.
    this.idleTimer.unref?.();
  }

  /** Stop the server process; the transcriber stays usable (restarts on demand). */
  shutdown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.startPromise = null;
    this.serverState = "idle";
    if (this.server) {
      const server = this.server;
      this.server = null;
      server.kill();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.shutdown();
  }
}
