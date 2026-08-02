import { useEffect, useState } from "react";

/** Seconds remaining until `deadline` (epoch ms), ticking four times a second. */
export function useCountdown(deadline: number | null): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (deadline === null) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  return remaining;
}
