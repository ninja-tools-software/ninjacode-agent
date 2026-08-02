import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WhisperTranscriber,
  encodeWavPcm16,
  type SpawnedServer,
} from "./transcriber.js";

describe("encodeWavPcm16", () => {
  it("writes a valid RIFF/WAVE header for 16 kHz mono", () => {
    const pcm = new Int16Array([0, 1000, -1000]);
    const wav = encodeWavPcm16(pcm);
    const view = new DataView(wav.buffer);
    const ascii = (off: number, len: number) =>
      String.fromCharCode(...wav.subarray(off, off + len));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits/sample
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
    expect(new Int16Array(wav.buffer, 44)[1]).toBe(1000);
    expect(wav.length).toBe(44 + 6);
  });
});

interface FakeServer extends SpawnedServer {
  killed: boolean;
  exitCb?: () => void;
}

function makeFakes(transcript = "hello world") {
  const servers: FakeServer[] = [];
  const spawnImpl = (_binary: string, _args: string[]): SpawnedServer => {
    const server: FakeServer = {
      killed: false,
      kill() {
        this.killed = true;
        this.exitCb?.();
      },
      onExit(cb) {
        this.exitCb = cb;
      },
    };
    servers.push(server);
    return server;
  };
  const inferences: unknown[] = [];
  const fetchImpl: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/inference")) {
      inferences.push(init?.body);
      return new Response(JSON.stringify({ text: ` ${transcript} ` }), { status: 200 });
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  return { servers, spawnImpl, fetchImpl, inferences };
}

describe("WhisperTranscriber", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const opts = (fakes: ReturnType<typeof makeFakes>, extra: Record<string, unknown> = {}) => ({
    binaryPath: "/bin/whisper-server",
    modelPath: "/models/ggml-small.bin",
    spawnImpl: fakes.spawnImpl,
    fetchImpl: fakes.fetchImpl,
    pickPort: async () => 45_678,
    ...extra,
  });

  it("starts the server lazily, transcribes, and reuses the process", async () => {
    const fakes = makeFakes("bonjour le monde");
    const t = new WhisperTranscriber(opts(fakes));
    expect(t.state).toBe("idle");

    const text = await t.transcribe(new Int16Array(1600));
    expect(text).toBe("bonjour le monde");
    expect(t.state).toBe("ready");
    expect(fakes.servers.length).toBe(1);

    await t.transcribe(new Int16Array(1600));
    expect(fakes.servers.length).toBe(1);
    expect(fakes.inferences.length).toBe(2);
    t.dispose();
  });

  it("shuts down after the idle timeout and restarts on demand", async () => {
    const fakes = makeFakes();
    const t = new WhisperTranscriber(opts(fakes, { idleTimeoutMs: 1000 }));
    await t.transcribe(new Int16Array(1600));
    expect(t.state).toBe("ready");

    vi.advanceTimersByTime(1500);
    expect(t.state).toBe("idle");
    expect(fakes.servers[0]?.killed).toBe(true);

    await t.transcribe(new Int16Array(1600));
    expect(fakes.servers.length).toBe(2);
    expect(t.state).toBe("ready");
    t.dispose();
  });

  it("resets to idle if the server process dies unexpectedly", async () => {
    const fakes = makeFakes();
    const t = new WhisperTranscriber(opts(fakes));
    await t.transcribe(new Int16Array(1600));
    expect(t.state).toBe("ready");

    // Simulate a crash (exit without kill()).
    fakes.servers[0]!.exitCb?.();
    expect(t.state).toBe("idle");
    t.dispose();
  });

  it("rejects new work after dispose", async () => {
    const fakes = makeFakes();
    const t = new WhisperTranscriber(opts(fakes));
    t.dispose();
    await expect(t.transcribe(new Int16Array(1600))).rejects.toThrow("disposed");
  });

  it("surfaces server HTTP errors as typed failures", async () => {
    const fetchImpl: typeof fetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/inference")) return new Response("boom", { status: 500 });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const fakes = makeFakes();
    const t = new WhisperTranscriber(opts(fakes, { fetchImpl }));
    await expect(t.transcribe(new Int16Array(1600))).rejects.toThrow("HTTP 500");
    t.dispose();
  });
});
