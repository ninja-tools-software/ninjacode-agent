import { describe, expect, it, vi } from "vitest";
import {
  Endpointer,
  MicRecorder,
  RECORDER_FRAME_SAMPLES,
  RECORDER_SAMPLE_RATE,
  recorderCandidates,
  rmsLevelInt16,
  type RecorderProcess,
} from "./recorder.js";

describe("rmsLevelInt16", () => {
  it("is 0 for an empty or silent frame", () => {
    expect(rmsLevelInt16(new Int16Array(0))).toBe(0);
    expect(rmsLevelInt16(new Int16Array(128))).toBe(0);
  });

  it("approaches 1 for a full-scale tone", () => {
    const frame = new Int16Array(128).fill(0x7fff);
    expect(rmsLevelInt16(frame)).toBeCloseTo(1, 2);
  });
});

describe("Endpointer", () => {
  it("closes a segment only after minSpeech then silence", () => {
    const ep = new Endpointer({ silenceMs: 300, minSpeechMs: 200, threshold: 0.1 });
    // Not enough speech yet: silence does not close.
    expect(ep.push(0.0, 100)).toBe("silence");
    expect(ep.push(0.5, 100)).toBe("speech");
    expect(ep.push(0.5, 100)).toBe("speech"); // 200ms speech accumulated
    expect(ep.push(0.0, 100)).toBe("silence");
    expect(ep.push(0.0, 100)).toBe("silence");
    expect(ep.push(0.0, 100)).toBe("segment_end"); // 300ms silence
  });

  it("lets a per-frame threshold override the default", () => {
    const ep = new Endpointer({ silenceMs: 300, minSpeechMs: 100, threshold: 0.5 });
    // 0.3 is below the default threshold (0.5) → silence.
    expect(ep.push(0.3, 100)).toBe("silence");
    // ...but counts as speech when the frame threshold is lowered.
    expect(ep.push(0.3, 100, 0.1)).toBe("speech");
  });
});

describe("recorderCandidates", () => {
  it("prefers sox then ffmpeg on macOS", () => {
    const cands = recorderCandidates("darwin");
    expect(cands[0]!.command).toBe("sox");
    expect(cands[1]!.command).toBe("ffmpeg");
    expect(cands[1]!.args).toContain("avfoundation");
  });

  it("omits ffmpeg on win32 (no safe default device)", () => {
    const cands = recorderCandidates("win32");
    expect(cands.map((c) => c.command)).toEqual(["sox"]);
  });

  it("uses the override command line verbatim", () => {
    const cands = recorderCandidates("darwin", "  rec -q -c 1 -r 16000 - ");
    expect(cands).toHaveLength(1);
    expect(cands[0]).toEqual({ command: "rec", args: ["-q", "-c", "1", "-r", "16000", "-"] });
  });
});

/** Controllable fake recorder process. */
class FakeProc implements RecorderProcess {
  killed = false;
  private dataCb: ((chunk: Uint8Array) => void) | null = null;
  private errCb: ((err: Error) => void) | null = null;
  private exitCb: ((code: number | null) => void) | null = null;
  onData(cb: (chunk: Uint8Array) => void) {
    this.dataCb = cb;
  }
  onError(cb: (err: Error) => void) {
    this.errCb = cb;
  }
  onExit(cb: (code: number | null) => void) {
    this.exitCb = cb;
  }
  kill() {
    this.killed = true;
  }
  emit(pcm: Int16Array) {
    this.dataCb?.(new Uint8Array(pcm.buffer.slice(0)));
  }
  emitRaw(bytes: Uint8Array) {
    this.dataCb?.(bytes);
  }
  fail(code: string) {
    const err = new Error(code) as NodeJS.ErrnoException;
    err.code = code;
    this.errCb?.(err);
  }
  exit(code: number | null) {
    this.exitCb?.(code);
  }
}

/** A frame of constant amplitude (int16). */
function frame(amp: number, samples = RECORDER_FRAME_SAMPLES): Int16Array {
  return new Int16Array(samples).fill(amp);
}

describe("MicRecorder", () => {
  it("emits a segment after speech followed by silence", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "darwin",
      silenceMs: 300,
      minSpeechMs: 200,
      threshold: 0.1,
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    const segments: Int16Array[] = [];
    rec.start({ onSegment: (s) => segments.push(s), onLevel: () => {}, onError: () => {} });

    const proc = procs[0]!;
    // 3 loud frames (~384ms speech), then enough silent frames to close (>=300ms).
    for (let i = 0; i < 3; i++) proc.emit(frame(0x6000));
    for (let i = 0; i < 4; i++) proc.emit(frame(0));

    expect(segments).toHaveLength(1);
    // Segment spans the loud frames plus the silence that closed it.
    expect(segments[0]!.length).toBeGreaterThanOrEqual(3 * RECORDER_FRAME_SAMPLES);
    rec.stop();
  });

  it("force-flushes a segment at the max duration when there is no pause", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "darwin",
      // Never close naturally on silence, so only the cap can emit.
      silenceMs: 100_000,
      minSpeechMs: 0,
      maxSegmentMs: 500, // ~8000 samples ≈ 4 frames
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    const segments: Int16Array[] = [];
    rec.start({ onSegment: (s) => segments.push(s), onLevel: () => {}, onError: () => {} });

    // Continuous speech, no silence: the cap must still emit a partial segment.
    for (let i = 0; i < 4; i++) procs[0]!.emit(frame(0x6000));
    expect(segments).toHaveLength(1);
    rec.stop();
  });

  it("adapts the threshold to the noise floor so pauses above minThreshold close a segment", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "darwin",
      silenceMs: 300,
      minSpeechMs: 200,
      // Defaults: minThreshold 0.012, noiseFactor 2.2.
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    const segments: Int16Array[] = [];
    rec.start({ onSegment: (s) => segments.push(s), onLevel: () => {}, onError: () => {} });

    // Loud speech (rms ≈ 0.4), then a return to moderate noise (rms ≈ 0.03).
    // 0.03 is ABOVE the fixed minThreshold (0.012) — a static threshold would
    // treat it as speech and never close — but it is below the adaptive
    // threshold (noise floor × 2.2), so the segment closes.
    const speech = Math.round(0.4 * 0x8000);
    const noise = Math.round(0.03 * 0x8000);
    for (let i = 0; i < 3; i++) procs[0]!.emit(frame(speech));
    for (let i = 0; i < 3; i++) procs[0]!.emit(frame(noise));

    expect(segments).toHaveLength(1);
    rec.stop();
  });

  it("emits the level on a steady cadence with decay, independent of chunking", () => {
    vi.useFakeTimers();
    try {
      const procs: FakeProc[] = [];
      const rec = new MicRecorder({
        platform: "darwin",
        threshold: 0.1,
        levelIntervalMs: 40,
        levelDecay: 0.5,
        spawnImpl: () => {
          const p = new FakeProc();
          procs.push(p);
          return p;
        },
      });
      const levels: number[] = [];
      rec.start({ onSegment: () => {}, onLevel: (l) => levels.push(l), onError: () => {} });

      // One loud burst raises the peak (fast attack)...
      procs[0]!.emit(frame(0x7fff));
      vi.advanceTimersByTime(40);
      expect(levels.at(-1)!).toBeGreaterThan(0.5);

      // ...then the meter decays on each tick even with no new audio.
      const afterBurst = levels.at(-1)!;
      vi.advanceTimersByTime(40);
      expect(levels.at(-1)!).toBeLessThan(afterBurst);

      rec.stop();
      const count = levels.length;
      vi.advanceTimersByTime(200);
      expect(levels.length).toBe(count); // no more emissions after stop
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not emit a segment for silence only", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "darwin",
      threshold: 0.1,
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    const segments: Int16Array[] = [];
    rec.start({ onSegment: (s) => segments.push(s), onLevel: () => {}, onError: () => {} });
    for (let i = 0; i < 10; i++) procs[0]!.emit(frame(0));
    rec.stop();
    expect(segments).toHaveLength(0);
  });

  it("flushes the trailing segment on stop and kills the process", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "darwin",
      threshold: 0.1,
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    const segments: Int16Array[] = [];
    rec.start({ onSegment: (s) => segments.push(s), onLevel: () => {}, onError: () => {} });
    procs[0]!.emit(frame(0x6000));
    procs[0]!.emit(frame(0x6000));
    rec.stop();
    expect(segments).toHaveLength(1);
    expect(procs[0]!.killed).toBe(true);
  });

  it("falls back to the next candidate when a binary is missing (ENOENT)", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "darwin",
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    rec.start({ onSegment: () => {}, onLevel: () => {}, onError: () => {} });
    expect(procs).toHaveLength(1); // sox
    procs[0]!.fail("ENOENT");
    expect(procs).toHaveLength(2); // ffmpeg
    rec.stop();
  });

  it("surfaces the not-found error after the last candidate fails", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "win32",
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    let errorMsg = "";
    rec.start({ onSegment: () => {}, onLevel: () => {}, onError: (m) => (errorMsg = m) });
    procs[0]!.fail("ENOENT");
    expect(errorMsg).toContain("no microphone recorder found");
    expect(errorMsg).toContain("recorderCommand");
    rec.stop();
  });

  it("reassembles int16 samples split across chunk boundaries (odd bytes)", () => {
    const procs: FakeProc[] = [];
    const rec = new MicRecorder({
      platform: "darwin",
      silenceMs: 300,
      minSpeechMs: 200,
      threshold: 0.1,
      spawnImpl: () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      },
    });
    const segments: Int16Array[] = [];
    rec.start({ onSegment: (s) => segments.push(s), onLevel: () => {}, onError: () => {} });

    // Build a loud frame as raw bytes, then feed it split on an odd boundary.
    const loud = frame(0x6000, RECORDER_FRAME_SAMPLES * 3);
    const raw = new Uint8Array(loud.buffer.slice(0));
    const proc = procs[0]!;
    proc.emitRaw(raw.subarray(0, 5)); // odd length
    proc.emitRaw(raw.subarray(5));
    for (let i = 0; i < 4; i++) proc.emit(frame(0));

    expect(segments).toHaveLength(1);
    rec.stop();
  });

  it("exposes a 16 kHz sample rate constant", () => {
    expect(RECORDER_SAMPLE_RATE).toBe(16_000);
  });
});
