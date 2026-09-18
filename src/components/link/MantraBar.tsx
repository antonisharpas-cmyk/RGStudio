import { Monogram } from "@/components/ui/Monogram";
import { cn } from "@/lib/utils";

/**
 * A rail of the studio's lines, moving, with the mark between them.
 *
 * ---
 *
 * **This is the homepage marquee, not a new invention.**
 *
 * `HomeSections.tsx` already has exactly this: a cream band ruled top and
 * bottom, small letterspaced caps in `clay`, the monogram as the separator, and
 * the `animate-marquee` keyframes that carry it. That band is the studio's own
 * furniture and it is what the share card was asked to look like, so the
 * treatment is copied from it rather than approximated — same face, same size,
 * same `tracking-brand`, same mark.
 *
 * The differences are two: the phrases are three words rather than one, and the
 * lower rail runs the other way.
 *
 * ---
 *
 * **Why the list is repeated four times over.**
 *
 * The keyframe slides the row to `-50%` and starts again, which is seamless only
 * if the second half is an exact copy of the first. That is the easy part.
 *
 * The part that is not obvious: *one half must be wider than the widest screen
 * it will be seen on*. The homepage gets this for free with seven words. Three
 * short phrases do not — on a desktop, half of six items is narrower than the
 * viewport, so the row runs out and a blank stretch sails past before the loop
 * comes round. Two passes of the phrases per half, four in total, puts one half
 * beyond any plausible screen and the seam stays invisible.
 *
 * ---
 *
 * **Motion.**
 *
 * `prefers-reduced-motion` is already honoured globally in `globals.css`, which
 * neutralises every animation on the site including this one. Somebody with that
 * preference set sees a still rail of words, which is a perfectly good thing to
 * see and needs nothing added here.
 */

export function MantraBar({
  phrases,
  /** The lower rail travels the opposite way, so the two do not read as one. */
  reverse,
  /** Seconds for a full pass. Slow: this is read at a glance, not watched. */
  seconds = 34,
  className,
}: {
  phrases: readonly string[];
  reverse?: boolean;
  seconds?: number;
  className?: string;
}) {
  const half = [...phrases, ...phrases];
  const row = [...half, ...half];

  return (
    <div
      className={cn(
        "relative overflow-hidden border-y border-mocha-200/50 bg-cream-200 py-4",
        className,
      )}
    >
      <div
        className={cn(
          "flex w-max animate-marquee items-center gap-8 whitespace-nowrap",
          /* `animation-direction` rather than a second keyframe: the same
             `marquee` animation played backwards is exactly the other way, and
             a mirrored copy of the keyframes would be one more thing to keep in
             step with the first. */
          reverse && "[animation-direction:reverse]",
        )}
        style={{ animationDuration: `${seconds}s` }}
      >
        {row.map((phrase, i) => (
          <span key={`${phrase}-${i}`} className="flex items-center gap-8">
            <span className="text-[11px] uppercase tracking-brand text-clay">
              {phrase}
            </span>
            <Monogram className="h-4 w-4 shrink-0 text-clay/45" />
          </span>
        ))}
      </div>
    </div>
  );
}
