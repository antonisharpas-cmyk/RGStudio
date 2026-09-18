import { cn } from "@/lib/utils";

/**
 * The little arrow on anything that opens.
 *
 * Lived inside `BookingsPanel`, and the moment the notices panel needed one it
 * was about to be copied. Two chevrons drawn slightly differently on two
 * screens of the same console is the kind of thing nobody reports and everybody
 * notices, so it moved here first.
 *
 * Points down. Callers rotate it 180 degrees when what it opens is open, which
 * keeps the "which way does it point when closed" decision in one place.
 */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 8"
      aria-hidden
      className={cn("h-2.5 w-2.5", className)}
    >
      <path
        d="M1 1l5 5 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
