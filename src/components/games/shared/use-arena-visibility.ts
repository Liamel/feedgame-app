import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

interface UseArenaVisibilityOptions {
  rootMargin?: string;
  threshold?: number;
}

interface ArenaVisibilityState {
  hostRef: MutableRefObject<HTMLDivElement | null>;
  stageReady: boolean;
  isNearViewport: boolean;
}

export function useArenaVisibility(
  options: UseArenaVisibilityOptions = {},
): ArenaVisibilityState {
  const { rootMargin = "220px", threshold = 0.001 } = options;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hasObserver =
    typeof window !== "undefined" &&
    typeof window.IntersectionObserver !== "undefined";

  const [stageReady, setStageReady] = useState(() => !hasObserver);
  const [isNearViewport, setIsNearViewport] = useState(() => !hasObserver);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasObserver) {
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        const nextEntry = entries[0];
        if (!nextEntry) {
          return;
        }
        const visible =
          nextEntry.isIntersecting || nextEntry.intersectionRatio > 0;
        setIsNearViewport(visible);
        if (visible) {
          setStageReady(true);
        }
      },
      {
        root: null,
        rootMargin,
        threshold,
      },
    );

    observer.observe(host);
    return () => observer.disconnect();
  }, [hasObserver, rootMargin, threshold]);

  return {
    hostRef,
    stageReady,
    isNearViewport,
  };
}
