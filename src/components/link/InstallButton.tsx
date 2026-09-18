"use client";

import { useEffect, useState } from "react";

/**
 * "Install the app", on two platforms that disagree about what that means.
 *
 * ---
 *
 * **Android and desktop Chrome give us a real button.**
 *
 * The browser fires `beforeinstallprompt` when it decides the site is
 * installable. Caught and kept, it can be replayed later from a click, and the
 * native install sheet appears. That is a genuine one-tap install and it is the
 * good case.
 *
 * The event fires *once*, early, and often before this component has mounted —
 * so the listener has to be attached on mount and the event kept, and there is
 * no way to ask for it again if it is missed. It also never fires at all if the
 * app is already installed, which is one of the ways this button knows to stop
 * offering.
 *
 * ---
 *
 * **iOS gives us nothing, so it gets instructions.**
 *
 * Safari has no install API of any kind: on iOS the only route to the home
 * screen is Share, then "Add to Home Screen", done by hand. Nothing a website
 * can do will shorten that, and pretending otherwise produces a button that
 * appears to do nothing at all — which is worse than no button.
 *
 * So on iOS this becomes a short set of instructions, shown on tap, naming the
 * two things to look for. That is the honest version, and it is what every
 * installable site on iOS ends up doing.
 *
 * ---
 *
 * **Already installed is a third state.**
 *
 * Somebody opening this page *from* the installed app should not be offered the
 * app. `display-mode: standalone` says so, and the button removes itself rather
 * than going grey: a share page with a dead control on it looks broken.
 */

/** What Chrome hands over, which TypeScript's DOM types do not describe. */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallButton({
  label,
  installedLabel,
  iosTitle,
  iosSteps,
  className,
}: {
  label: string;
  installedLabel: string;
  iosTitle: string;
  /** Two or three lines. Kept as props so the page owns the wording. */
  iosSteps: string[];
  className?: string;
}) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);
  /**
   * Nothing is decided until the browser has been asked.
   *
   * Rendering the button on the server and correcting it on the client makes
   * the label flicker from "Install" to "Open in the app" on a phone that
   * already has it. One paint of nothing is better than one paint of a lie.
   */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true;

    /* iPadOS 13 and later report themselves as a Mac, so the touch check is
       what separates an iPad from a desktop. */
    const ios =
      /iphone|ipod|ipad/i.test(window.navigator.userAgent) ||
      (window.navigator.platform === "MacIntel" &&
        window.navigator.maxTouchPoints > 1);

    setInstalled(standalone);
    setIsIos(ios);
    setReady(true);

    const onBeforeInstall = (e: Event) => {
      /* Without this Chrome shows its own mini-infobar as well, and the page
         ends up asking twice. */
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    /* Fires after a successful install, including one done through the
       browser's own menu rather than this button. */
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /**
   * Space is reserved only while the answer is unknown.
   *
   * The first version reserved a button's height in every case that did not
   * render a button, which held the gap open permanently on any browser that
   * cannot install — and a share card with a hole in the middle of the stack
   * looks like something failed to load. Now the placeholder exists for the one
   * paint before the browser has been asked, which is what stops the stack
   * jumping, and after that the row either has a button in it or is not there.
   */
  if (!ready) return <div className="h-[52px]" aria-hidden />;

  if (installed) {
    return (
      <p className="py-3 text-center text-xs uppercase tracking-widest text-cream/45">
        {installedLabel}
      </p>
    );
  }

  const onClick = async () => {
    if (prompt) {
      await prompt.prompt();
      /* Whether they accepted or not, the event is spent: Chrome will not let
         the same one be replayed. `appinstalled` covers the accepted case. */
      setPrompt(null);
      return;
    }
    setShowIosHelp((v) => !v);
  };

  /* No native prompt and not iOS means a browser that will not install this —
     an in-app webview, Firefox on Android, a desktop browser without support.
     Instructions naming Safari's Share sheet would be wrong there, and there is
     no honest button to offer, so the row is left out entirely. */
  if (!prompt && !isIos) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={isIos ? showIosHelp : undefined}
        className="flex w-full items-center justify-center gap-3 rounded-full bg-cream px-6 py-3.5 text-xs uppercase tracking-widest text-mocha-800 transition-opacity duration-300 hover:opacity-85"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {label}
      </button>

      {isIos && showIosHelp ? (
        <div className="mt-2 rounded-2xl border border-cream/20 bg-cream/5 px-5 py-4 text-left">
          <p className="text-xs uppercase tracking-widest text-cream/70">
            {iosTitle}
          </p>
          <ol className="mt-3 space-y-2">
            {iosSteps.map((step, i) => (
              <li
                key={step}
                className="flex gap-3 text-sm leading-snug text-cream/85"
              >
                <span className="tabular-nums text-cream/40">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
