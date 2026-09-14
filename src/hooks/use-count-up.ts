import { useEffect, useRef, useState } from "react";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Animates a number from 0 to `target` with an ease-out curve. */
export function useCountUp(target: number, duration = 850, delay = 0) {
  const [value, setValue] = useState(target);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!Number.isFinite(target) || prefersReducedMotion()) {
      setValue(target);
      return;
    }

    setValue(0);
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start - delay;
      if (elapsed < 0) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration, delay]);

  return value;
}
