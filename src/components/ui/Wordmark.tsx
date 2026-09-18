import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The official lockup, extracted from the brand files supplied by the studio.
 * `tone="brown"` for light backgrounds, `tone="cream"` for dark ones.
 */
export function Wordmark({
  tone = "brown",
  className,
  priority,
}: {
  tone?: "brown" | "cream";
  className?: string;
  priority?: boolean;
}) {
  const cream = tone === "cream";
  return (
    <Image
      src={cream ? "/brand/wordmark-cream.png" : "/brand/wordmark-brown.png"}
      alt="RG Pilates Studio"
      width={560}
      height={cream ? 184 : 194}
      priority={priority}
      /* Rendered at ~130–200px. Without `sizes`, next/image would generate and
         serve the 1080w and 1920w variants of a 200px-wide logo. */
      sizes="200px"
      className={cn("h-auto w-[168px] select-none", className)}
    />
  );
}

export function WordmarkLink({
  tone = "brown",
  className,
  priority,
}: {
  tone?: "brown" | "cream";
  className?: string;
  priority?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label="RG Pilates Studio, home"
      className="shrink-0 transition-opacity duration-500 hover:opacity-70"
    >
      <Wordmark tone={tone} className={className} priority={priority} />
    </Link>
  );
}
