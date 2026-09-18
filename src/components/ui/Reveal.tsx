"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll-into-view fade + rise.
 *
 * Deliberately dependency-free: one shared IntersectionObserver and two CSS
 * classes. An animation library here would be pulled into every route by the
 * shared layout — around 150kB of JavaScript to fade some text in.
 *
 * Reduced motion is handled in globals.css, which shows the content outright.
 */

let observer: IntersectionObserver | null = null;
const seen = new WeakMap<Element, () => void>();

function watch(el: Element, onVisible: () => void) {
  if (typeof IntersectionObserver === "undefined") {
    onVisible();
    return () => {};
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          seen.get(entry.target)?.();
          observer!.unobserve(entry.target);
          seen.delete(entry.target);
        }
      },
      { rootMargin: "0px 0px -80px 0px", threshold: 0.01 },
    );
  }
  seen.set(el, onVisible);
  observer.observe(el);
  return () => {
    observer?.unobserve(el);
    seen.delete(el);
  };
}

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* Already on screen at mount (above the fold) — show without waiting. */
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setVisible(true);
      return;
    }
    return watch(el, () => setVisible(true));
  }, []);

  return { ref, visible };
}

export function Reveal({
  children,
  delay = 0,
  y = 24,
  id,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  /** For scroll targets — the account page jumps to its section row. */
  id?: string;
  className?: string;
}) {
  const { ref, visible } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      id={id}
      className={cn("reveal", visible && "is-visible", className)}
      style={
        {
          "--reveal-delay": `${delay * 1000}ms`,
          "--reveal-y": `${y}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/** Staggers its direct children — each child must be a <RevealItem>. */
export function RevealGroup({
  children,
  className,
  stagger = 0.09,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
}) {
  const { ref, visible } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={cn("reveal-group", visible && "is-visible", className)}
      style={
        { "--reveal-stagger": `${stagger * 1000}ms` } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function RevealItem({
  children,
  className,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  return (
    <div
      className={cn("reveal-item", className)}
      style={{ "--reveal-y": `${y}px` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
