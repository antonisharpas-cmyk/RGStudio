"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll-linked motion: the child drifts and lifts slightly as the element
 * travels up the viewport, so the page keeps moving under the reader rather
 * than snapping into place once and going still.
 *
 * Like Reveal, this is deliberately dependency-free. One shared scroll
 * listener drives every instance on the page, positions are read in a single
 * rAF pass and written straight to a CSS custom property, so there is one
 * layout read and one style write per frame no matter how many of these are
 * mounted. A scroll-animation library in the shared layout would cost more
 * JavaScript than the whole site currently ships.
 *
 * `strength` is how far the child travels, in percent of its own height.
 * Reduced motion switches it off entirely.
 */

type Entry = { el: HTMLElement; strength: number; zoom: number };

const entries = new Set<Entry>();
let frame = 0;
let listening = false;

function measure() {
  frame = 0;
  const h = window.innerHeight || 1;
  for (const { el, strength, zoom } of entries) {
    const r = el.getBoundingClientRect();
    if (r.bottom < -h || r.top > h * 2) continue;
    /* -1 when the element sits a screen below the fold, +1 when a screen
       above it; 0 when its centre is centred. */
    const p = ((r.top + r.height / 2 - h / 2) / (h / 2 + r.height / 2)) * -1;
    const clamped = Math.max(-1, Math.min(1, p));
    el.style.setProperty("--px-shift", `${clamped * strength}%`);
    el.style.setProperty("--px-scale", `${1 + zoom * (1 - Math.abs(clamped))}`);
  }
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(measure);
}

function join(entry: Entry) {
  entries.add(entry);
  if (!listening) {
    listening = true;
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
  }
  schedule();
  return () => {
    entries.delete(entry);
    if (entries.size === 0) {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      listening = false;
    }
  };
}

export function Parallax({
  children,
  strength = 6,
  zoom = 0.06,
  className,
}: {
  children: ReactNode;
  /** Travel distance as a percentage of the element's own height. */
  strength?: number;
  /** Extra scale at the point the element is centred in the viewport. */
  zoom?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return join({ el, strength, zoom });
  }, [strength, zoom]);

  return (
    <div ref={ref} className={cn("parallax", className)}>
      {children}
    </div>
  );
}
