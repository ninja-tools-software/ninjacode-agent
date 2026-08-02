import { useEffect, useRef } from "react";

const BAR_WEIGHTS = [0.55, 0.85, 1, 0.8, 0.5];
/** Raw RMS from int16 mic input is tiny; this lifts speech to full amplitude. */
const LEVEL_GAIN = 90;

/**
 * Voice activity meter shown while dictating. The capture pipeline only reports
 * a scalar RMS level, so the bars are that level plus a per-bar wobble to read
 * as a spectrum. The animation runs on rAF against a ref, so the ~10 Hz level
 * updates don't re-render React.
 */
export function VoiceSpectrum({ level }: { level: number }) {
  const levelRef = useRef(level);
  levelRef.current = level;
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    let raf = 0;
    // Ease toward the latest sample each frame — fast attack, slower release —
    // so the meter stays fluid between host updates instead of stepping.
    let displayed = 0;
    const render = () => {
      const target = Math.min(1, levelRef.current * LEVEL_GAIN);
      displayed += (target - displayed) * (target > displayed ? 0.4 : 0.12);
      const t = performance.now() / 130;
      for (let i = 0; i < BAR_WEIGHTS.length; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        const wobble = 0.65 + 0.35 * Math.abs(Math.sin(t + i * 1.7));
        const scale = 0.14 + displayed * BAR_WEIGHTS[i]! * wobble * 0.86;
        el.style.transform = `scaleY(${Math.max(0.12, Math.min(1, scale))})`;
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="voice-spectrum" aria-hidden="true">
      {BAR_WEIGHTS.map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="voice-spectrum-bar"
        />
      ))}
    </div>
  );
}
