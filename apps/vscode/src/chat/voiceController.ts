import * as vscode from "vscode";
import type { HostToWebview } from "../protocol.js";
import { ensureVoiceAssets, type VoiceAssets } from "../voice/download.js";
import { MicRecorder } from "../voice/recorder.js";
import { WhisperTranscriber } from "../voice/transcriber.js";

/** Release asset listing whisper-server binaries + ggml models per platform,
 * published from the public ninja-tools-software/ninjacode-voice repo.
 * Overridable via the `ninjacode.voice.manifestUrl` setting. */
const DEFAULT_VOICE_MANIFEST_URL =
  "https://github.com/ninja-tools-software/ninjacode-voice/releases/latest/download/voice-manifest.json";

/** Whisper emits non-speech markers like [BLANK_AUDIO] on silence; drop them. */
function cleanTranscript(text: string): string {
  return text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Voice dictation, host-side: webviews are sandboxed iframes without a microphone
 * Permissions-Policy, so capture happens here. Finished speech segments are
 * transcribed eagerly (local whisper.cpp) and streamed back as `voice_partial`,
 * then `voice_final` on stop.
 */
export class VoiceController {
  private transcriber?: WhisperTranscriber;
  private modelUsed?: string;
  private assets?: Promise<VoiceAssets>;
  private recorder?: MicRecorder;
  private segments: string[] = [];
  private jobs: Promise<void> = Promise.resolve();
  /** Bumped on cancel/stop so late transcription results are discarded. */
  private generation = 0;

  constructor(
    private readonly storageDir: string,
    private readonly post: (payload: HostToWebview) => void,
  ) {}

  dispose(): void {
    this.recorder?.stop();
    this.transcriber?.dispose();
  }

  private config(): { model: string; language: string; manifestUrl: string } {
    const cfg = vscode.workspace.getConfiguration("ninjacode");
    return {
      model: cfg.get<string>("voice.model") || "small",
      language: cfg.get<string>("voice.language") || "auto",
      manifestUrl: cfg.get<string>("voice.manifestUrl") || DEFAULT_VOICE_MANIFEST_URL,
    };
  }

  async start(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.segments = [];
    this.jobs = Promise.resolve();
    await vscode.commands.executeCommand("setContext", "ninjacode.voiceRecording", true);

    const commandLine = (
      vscode.workspace.getConfiguration("ninjacode").get<string>("voice.recorderCommand") || ""
    ).trim();
    const recorder = new MicRecorder(commandLine ? { commandLine } : {});
    this.recorder = recorder;
    recorder.start({
      onSegment: (pcm) => {
        if (generation === this.generation) this.transcribeSegment(pcm);
      },
      onLevel: (rms) => {
        if (generation === this.generation) this.post({ type: "voice_level", level: rms });
      },
      onError: (message) => {
        if (generation !== this.generation) return;
        this.post({ type: "voice_error", text: message });
        void this.cancel();
      },
    });

    // Segment transcription awaits readiness internally; awaiting here surfaces
    // download progress and setup failures to the user.
    try {
      await this.ensureReady();
      if (generation === this.generation) {
        this.post({ type: "voice_setup_progress", label: null });
      }
    } catch (e) {
      if (generation === this.generation) {
        this.post({ type: "voice_error", text: (e as Error).message });
        await this.cancel();
      }
    }
  }

  /** Download assets (first use) and create the transcriber. Reset if the model setting changed. */
  private async ensureReady(): Promise<WhisperTranscriber> {
    const { model, language, manifestUrl } = this.config();
    if (this.modelUsed !== model) {
      this.transcriber?.dispose();
      this.transcriber = undefined;
      this.assets = undefined;
      this.modelUsed = model;
    }
    if (!this.assets) {
      this.assets = ensureVoiceAssets({
        storageDir: this.storageDir,
        manifestUrl,
        model,
        onProgress: (label, percent) =>
          this.post({ type: "voice_setup_progress", label, percent }),
      });
      // A failed download must not poison later attempts.
      this.assets.catch(() => {
        this.assets = undefined;
      });
    }
    const assets = await this.assets;
    if (!this.transcriber) {
      this.transcriber = new WhisperTranscriber({
        binaryPath: assets.binaryPath,
        modelPath: assets.modelPath,
        language,
      });
    }
    return this.transcriber;
  }

  private joined(): string {
    return this.segments.filter((s) => s.length > 0).join(" ");
  }

  /** Enqueue eager transcription of one finished speech segment (16 kHz mono int16). */
  private transcribeSegment(segment: Int16Array): void {
    // Skip sub-300ms segments: too short for real speech, and whisper tends
    // to hallucinate on them.
    if (segment.length < 4_800) return;
    const generation = this.generation;
    const index = this.segments.length;
    this.segments.push("");
    this.jobs = this.jobs.then(async () => {
      if (generation !== this.generation) return;
      try {
        const transcriber = await this.ensureReady();
        const text = cleanTranscript(await transcriber.transcribe(segment));
        if (generation !== this.generation) return;
        this.segments[index] = text;
        this.post({ type: "voice_partial", text: this.joined() });
      } catch (e) {
        if (generation !== this.generation) return;
        this.post({ type: "voice_error", text: (e as Error).message });
      }
    });
  }

  async stop(): Promise<void> {
    await vscode.commands.executeCommand("setContext", "ninjacode.voiceRecording", false);
    // Stopping flushes the trailing segment synchronously via onSegment.
    this.recorder?.stop();
    this.recorder = undefined;
    const generation = this.generation;
    await this.jobs;
    if (generation !== this.generation) return;
    this.post({ type: "voice_final", text: this.joined() });
    this.segments = [];
  }

  async cancel(): Promise<void> {
    this.generation += 1;
    this.recorder?.stop();
    this.recorder = undefined;
    this.segments = [];
    await vscode.commands.executeCommand("setContext", "ninjacode.voiceRecording", false);
  }
}
