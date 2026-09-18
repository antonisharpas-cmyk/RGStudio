import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";

export function Section({
  id,
  tone = "cream",
  className,
  children,
}: {
  id?: string;
  tone?: "cream" | "sand" | "dark" | "white";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative overflow-hidden py-24 md:py-32",
        tone === "cream" && "bg-cream",
        tone === "white" && "bg-white",
        tone === "sand" && "bg-cream-200",
        tone === "dark" && "bg-mocha-600 text-cream/80 grain",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  body,
  align = "left",
  tone = "light",
  className,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && (
        <p
          className={cn(
            "eyebrow mb-5",
            tone === "dark" && "text-cream/50",
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          "h-display text-balance text-[2.4rem] leading-[1.08] sm:text-5xl md:text-[3.4rem]",
          tone === "dark" && "text-cream",
        )}
      >
        {title}
      </h2>
      {body && (
        <p
          className={cn(
            "mt-6 max-w-2xl text-[15px] leading-relaxed text-mocha-500",
            align === "center" && "mx-auto",
            tone === "dark" && "text-cream/65",
          )}
        >
          {body}
        </p>
      )}
    </Reveal>
  );
}
