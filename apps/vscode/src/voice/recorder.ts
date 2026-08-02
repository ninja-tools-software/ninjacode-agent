/**
 * Host-side microphone capture for voice dictation.
 *
 * VS Code / Cursor webviews are sandboxed iframes without a `microphone`
 * Permissions-Policy, so `navigator.mediaDevices.getUserMedia()` is rejected
 * there regardless of the OS-level permission. We therefore capture audio in
 * the extension host by spawning a native recorder (`sox`, falling back to
 * `ffmpeg`) that streams raw 16 kHz mono int16 PCM on stdout. On macOS the
 * child process inherits the editor app's microphone entitlement, so the OS
 * permission the user granted to VS Code / Cursor actually applies.
 *
 * Endpointing (silence-based segmentation) happens here so the host can
 * transcribe finished segments eagerly while the user keeps speaking.
 *
 * This module must stay free of `vscode` imports so it is unit-testable.
 */

import { spawn } from "node:child_process";

export const RECORDER_SAMPLE_RATE = 16_000;
/** Analyze audio in ~128 ms frames (2048 samples @ 16 kHz). */
export const RECORDER_FRAME_SAMPLES = 2_048;
const RECORDER_FRAME_MS = (RECORDER_FRAME_SAMPLES / RECORDER_SAMPLE_RATE) * 1000;

/** Root-mean-square level of an int16 frame, normalized to [0, 1]. */
export function rmsLevelInt16(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i]! / 0x8000;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

interface EndpointerOptions {
  /** Silence duration that closes a segment. */
  silenceMs?: number;
  /** RMS level below which a frame counts as silence. */
  threshold?: number;
  /** Minimum accumulated speech before a segment can end (filters clicks). */
  minSpeechMs?: number;
}

type EndpointerEvent = "speech" | "silence" | "segment_end";

/**
 * Energy-based endpointing: after at least `minSpeechMs` of speech, a run of
 * `silenceMs` of low-energy frames closes the current segment.
 */
export class Endpointer {
  private readonly silenceMs: number;
  private readonly threshold: number;
  private readonly minSpeechMs: number;
  private speechMs = 0;
  private silenceRunMs = 0;

  constructor(opts: EndpointerOptions = {}) {
    this.silenceMs = opts.silenceMs ?? 600;
    this.threshold = opts.threshold ?? 0.012;
    this.minSpeechMs = opts.minSpeechMs ?? 250;
  }

  /** `threshold` overrides the default for this frame (used for adaptive VAD). */
  push(rms: number, durationMs: number, threshold = this.threshold): EndpointerEvent {
    if (rms >= threshold) {
      this.speechMs += durationMs;
      this.silenceRunMs = 0;
      return "speech";
    }
    this.silenceRunMs += durationMs;
    if (this.speechMs >= this.minSpeechMs && this.silenceRunMs >= this.silenceMs) {
      this.reset();
      return "segment_end";
    }
    return "silence";
  }

  reset(): void {
    this.speechMs = 0;
    this.silenceRunMs = 0;
  }
}

interface RecorderCommand {
  command: string;
  args: string[];
}

/**
 * Raw-PCM sox invocation reading the default input device (`-d`) to stdout.
 * A small `--buffer` keeps writes frequent so the live level meter stays smooth
 * instead of arriving in large infrequent bursts.
 */
function soxCommand(): RecorderCommand {
  return {
    command: "sox",
    args: [
      "-q",
      "--buffer",
      "2048",
      "-d",
      "-t",
      "raw",
      "-b",
      "16",
      "-e",
      "signed-integer",
      "-r",
      String(RECORDER_SAMPLE_RATE),
      "-c",
      "1",
      "-",
    ],
  };
}

/**
 * Best-effort ffmpeg fallback (default input device) per platform.
 * `-flush_packets 1` (+ `-fflags nobuffer`) disables ffmpeg's ~32 KB output
 * buffering so PCM streams to stdout in real time — otherwise the level meter
 * updates only every ~1 s and looks frozen.
 */
function ffmpegCommand(platform: NodeJS.Platform): RecorderCommand | null {
  const head = ["-hide_banner", "-loglevel", "quiet", "-fflags", "nobuffer"];
  const tail = [
    "-ac",
    "1",
    "-ar",
    String(RECORDER_SAMPLE_RATE),
    "-f",
    "s16le",
    "-flush_packets",
    "1",
    "-",
  ];
  switch (platform) {
    case "darwin":
      return { command: "ffmpeg", args: [...head, "-f", "avfoundation", "-i", ":default", ...tail] };
    case "linux":
      return { command: "ffmpeg", args: [...head, "-f", "alsa", "-i", "default", ...tail] };
    default:
      // Windows dshow needs an explicit device name; no safe generic default.
      return null;
  }
}

/**
 * Ordered capture commands to try. A user-provided `commandLine` (split on
 * whitespace) takes precedence; otherwise sox is preferred, then ffmpeg.
 */
export function recorderCandidates(platform: NodeJS.Platform, commandLine?: string): RecorderCommand[] {
  const override = commandLine?.trim();
  if (override) {
    const parts = override.split(/\s+/);
    return [{ command: parts[0]!, args: parts.slice(1) }];
  }
  const candidates: RecorderCommand[] = [soxCommand()];
  const ffmpeg = ffmpegCommand(platform);
  if (ffmpeg) candidates.push(ffmpeg);
  return candidates;
}

/** Minimal view of a spawned recorder process, so tests can inject a fake. */
export interface RecorderProcess {
  onData(cb: (chunk: Uint8Array) => void): void;
  onError(cb: (err: Error) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

function spawnRecorderProcess(command: string, args: string[]): RecorderProcess {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
  return {
    onData: (cb) => child.stdout?.on("data", (b: Buffer) => cb(b)),
    onError: (cb) => child.on("error", cb),
    onExit: (cb) => child.once("exit", (code) => cb(code)),
    kill: () => {
      child.stdout?.removeAllListeners();
      child.kill();
    },
  };
}

interface MicRecorderOptions extends EndpointerOptions {
  /** Full override command line (must emit raw s16le mono 16 kHz on stdout). */
  commandLine?: string;
  platform?: NodeJS.Platform;
  /** Cadence of the level meter emission, decoupled from data arrival. */
  levelIntervalMs?: number;
  /** Per-tick decay of the meter level between audio frames (0-1). */
  levelDecay?: number;
  /** Absolute floor for the adaptive speech threshold. */
  minThreshold?: number;
  /** Speech threshold as a multiple of the tracked noise floor. */
  noiseFactor?: number;
  /** Force-close a segment after this much audio, so partials keep flowing
   * even without a detected pause (0 disables). */
  maxSegmentMs?: number;
  /** Injectable for tests. */
  spawnImpl?: (command: string, args: string[]) => RecorderProcess;
}

interface MicRecorderHandlers {
  /** A silence-delimited (or final) speech segment: 16 kHz mono int16 PCM. */
  onSegment: (pcm: Int16Array) => void;
  /** RMS level in [0, 1], emitted per ~128 ms frame (drives the UI meter). */
  onLevel: (rms: number) => void;
  /** Capture could not start or died: `message` is user-facing. */
  onError: (message: string) => void;
}

const RECORDER_NOT_FOUND =
  "no microphone recorder found. Install `sox` (macOS: `brew install sox`) or `ffmpeg`, " +
  "or set the `ninjacode.voice.recorderCommand` setting to a command that outputs raw " +
  "16 kHz mono 16-bit PCM on stdout.";

/**
 * Spawns a native recorder, splits its PCM stream into frames, runs endpointing,
 * and emits complete speech segments. Falls back through candidate commands when
 * a binary is missing (ENOENT) or exits before producing any audio.
 */
export class MicRecorder {
  private readonly candidates: RecorderCommand[];
  private readonly spawnImpl: (command: string, args: string[]) => RecorderProcess;
  private readonly endpointer: Endpointer;
  private readonly levelIntervalMs: number;
  private readonly levelDecay: number;
  private readonly minThreshold: number;
  private readonly noiseFactor: number;
  private readonly maxSegmentSamples: number;

  private handlers: MicRecorderHandlers | null = null;
  private proc: RecorderProcess | null = null;
  private stopped = false;
  private carry: Int16Array = new Int16Array(0);
  private byteRemainder: number | null = null;
  private segmentChunks: Int16Array[] = [];
  private segmentSamples = 0;
  private segmentHadSpeech = false;
  /** Rolling noise-floor estimate: drops instantly to quiet frames, rises slowly. */
  private noiseFloor = 0;
  /** Latest peak level, emitted on a steady cadence with decay for a smooth meter. */
  private currentLevel = 0;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: MicRecorderOptions = {}) {
    this.candidates = recorderCandidates(opts.platform ?? process.platform, opts.commandLine);
    this.spawnImpl = opts.spawnImpl ?? spawnRecorderProcess;
    this.levelIntervalMs = opts.levelIntervalMs ?? 40;
    this.levelDecay = opts.levelDecay ?? 0.5;
    this.minThreshold = opts.minThreshold ?? 0.012;
    this.noiseFactor = opts.noiseFactor ?? 2.2;
    const maxSegmentMs = opts.maxSegmentMs ?? 4500;
    this.maxSegmentSamples =
      maxSegmentMs > 0 ? Math.round((maxSegmentMs / 1000) * RECORDER_SAMPLE_RATE) : 0;
    this.endpointer = new Endpointer(opts);
  }

  start(handlers: MicRecorderHandlers): void {
    this.handlers = handlers;
    // Emit the level on a fixed cadence (with decay) rather than per audio
    // frame: recorders deliver PCM in uneven bursts, so a data-driven meter
    // stutters. This keeps the UI meter smooth regardless of chunking.
    this.levelTimer = setInterval(() => {
      this.handlers?.onLevel(this.currentLevel);
      this.currentLevel *= this.levelDecay;
    }, this.levelIntervalMs);
    this.levelTimer.unref?.();
    this.tryCandidate(0);
  }

  private tryCandidate(index: number): void {
    if (this.stopped) return;
    if (index >= this.candidates.length) {
      this.handlers?.onError(RECORDER_NOT_FOUND);
      return;
    }
    const { command, args } = this.candidates[index]!;
    const proc = this.spawnImpl(command, args);
    this.proc = proc;
    let producedData = false;
    let advanced = false;

    const advance = () => {
      if (advanced) return;
      advanced = true;
      this.tryCandidate(index + 1);
    };

    proc.onData((chunk) => {
      if (this.stopped) return;
      producedData = true;
      this.onBytes(chunk);
    });
    proc.onError((err) => {
      if (this.stopped) return;
      // Missing binary: fall through to the next candidate.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        advance();
        return;
      }
      if (!producedData) {
        advance();
        return;
      }
      this.handlers?.onError(`audio capture failed (${err.message})`);
    });
    proc.onExit(() => {
      if (this.stopped || producedData) return;
      // Exited before emitting audio (e.g. wrong device): try the next command.
      advance();
    });
  }

  private onBytes(chunk: Uint8Array): void {
    let bytes = chunk;
    // Stitch a leftover odd byte from the previous chunk onto this one.
    if (this.byteRemainder !== null) {
      const merged = new Uint8Array(chunk.length + 1);
      merged[0] = this.byteRemainder;
      merged.set(chunk, 1);
      bytes = merged;
      this.byteRemainder = null;
    }
    const usableLen = bytes.length - (bytes.length % 2);
    if (usableLen < bytes.length) this.byteRemainder = bytes[bytes.length - 1]!;
    if (usableLen === 0) return;

    // Copy into an aligned buffer: pooled Buffers are not 2-byte aligned.
    const aligned = new Uint8Array(usableLen);
    aligned.set(bytes.subarray(0, usableLen));
    const samples = new Int16Array(aligned.buffer, 0, usableLen >> 1);
    this.onSamples(samples);
  }

  private onSamples(samples: Int16Array): void {
    let data: Int16Array;
    if (this.carry.length === 0) {
      data = samples;
    } else {
      data = new Int16Array(this.carry.length + samples.length);
      data.set(this.carry, 0);
      data.set(samples, this.carry.length);
    }
    let off = 0;
    while (data.length - off >= RECORDER_FRAME_SAMPLES) {
      const frame = data.slice(off, off + RECORDER_FRAME_SAMPLES);
      off += RECORDER_FRAME_SAMPLES;
      const rms = rmsLevelInt16(frame);
      // Fast attack: the meter jumps to peaks; the timer handles the release.
      if (rms > this.currentLevel) this.currentLevel = rms;
      this.segmentChunks.push(frame);
      this.segmentSamples += frame.length;

      // Adaptive threshold: track the noise floor (drop instantly to quiet
      // frames, rise slowly toward louder ones) and require speech to stand a
      // factor above it. Without this a raw mic (no noise suppression) keeps the
      // level above a fixed threshold, so pauses are never detected and no
      // partial is emitted until stop(). The slow rise keeps sustained speech
      // from inflating the floor and cutting itself off.
      if (rms < this.noiseFloor) this.noiseFloor = rms;
      else this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
      const threshold = Math.max(this.minThreshold, this.noiseFloor * this.noiseFactor);

      if (rms >= threshold) this.segmentHadSpeech = true;
      if (this.endpointer.push(rms, RECORDER_FRAME_MS, threshold) === "segment_end") {
        this.emitSegment();
      } else if (this.maxSegmentSamples > 0 && this.segmentSamples >= this.maxSegmentSamples) {
        // No natural pause yet: flush anyway so partials keep flowing.
        this.emitSegment();
      }
    }
    this.carry = off === 0 ? data : data.slice(off);
  }

  private emitSegment(): void {
    const chunks = this.segmentChunks;
    const total = this.segmentSamples;
    const hadSpeech = this.segmentHadSpeech;
    this.segmentChunks = [];
    this.segmentSamples = 0;
    this.segmentHadSpeech = false;
    // Skip silence-only runs: whisper hallucinates on them.
    if (!hadSpeech || total === 0) return;
    const merged = new Int16Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    this.handlers?.onSegment(merged);
  }

  /** Stop capture, release the microphone, and flush the final segment. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.levelTimer) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    // Fold the sub-frame carry into the pending segment before flushing.
    if (this.carry.length > 0) {
      this.segmentChunks.push(this.carry);
      this.segmentSamples += this.carry.length;
      const threshold = Math.max(this.minThreshold, this.noiseFloor * this.noiseFactor);
      if (rmsLevelInt16(this.carry) >= threshold) this.segmentHadSpeech = true;
      this.carry = new Int16Array(0);
    }
    this.emitSegment();
    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      proc.kill();
    }
    this.handlers = null;
  }
}
