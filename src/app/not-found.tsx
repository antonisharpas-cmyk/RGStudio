import Link from "next/link";
import { Monogram } from "@/components/ui/Monogram";

export default function NotFound() {
  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <Monogram className="h-12 w-12 text-clay/50" />
      <h1 className="h-display mt-10 text-4xl">This page has moved on.</h1>
      <p className="mt-4 text-sm text-mocha-500">
        The link is no longer here. The timetable, though, is exactly where you left it.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-mocha-600 px-6 py-3.5 text-[11px] uppercase tracking-widest text-cream transition hover:bg-mocha-700"
        >
          Home
        </Link>
        <Link
          href="/timetable"
          className="rounded-full border border-mocha-300 px-6 py-3.5 text-[11px] uppercase tracking-widest text-mocha-600 transition hover:border-mocha-600"
        >
          Timetable
        </Link>
      </div>
    </div>
  );
}
