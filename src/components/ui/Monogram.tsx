import { cn } from "@/lib/utils";

/**
 * The RG Pilates Studio mark, cut from the studio's own logo as an alpha mask.
 *
 * Rendered as a CSS mask over `currentColor`, so it recolours with the
 * surrounding text and the image stays in a cacheable file rather
 * than in the JavaScript bundle of every page that shows it.
 */
export function Monogram({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("monogram h-10 w-10", className)}
      style={style}
    />
  );
}
