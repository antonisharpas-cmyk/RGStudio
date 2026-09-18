"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A member's photograph, or the plain user mark when there is none.
 *
 * The photo comes from an authenticated route, so it cannot go through the
 * image optimiser — a bare <img> with the private cache headers the route sets
 * is the right thing here.
 */
export function UserAvatar({
  hasPhoto,
  name,
  version = 0,
  className,
}: {
  hasPhoto: boolean;
  name: string;
  /** Bump to force a reload after a new photo is uploaded. */
  version?: number;
  className?: string;
}) {
  /* If the photo cannot be fetched or decoded — deleted in another tab, a
     corrupt upload — show the mark rather than the browser's broken-image
     icon, which looks like the site is broken rather than like an empty
     avatar. */
  const [failed, setFailed] = useState(false);
  const showPhoto = hasPhoto && !failed;

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-mocha-200 bg-cream-200",
        className,
      )}
    >
      {showPhoto ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={version}
          src={`/api/profile/avatar?v=${version}`}
          alt={name}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-[58%] w-[58%] text-clay/70"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <circle cx="12" cy="8" r="3.6" />
          <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
        </svg>
      )}
    </span>
  );
}
