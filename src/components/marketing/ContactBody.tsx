"use client";

import { useState } from "react";
import { formatDayList, openingSummary } from "@/lib/rota";
import { Button } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { SocialLinks } from "@/components/ui/SocialLinks";
import { StudioEmail } from "@/components/site/StudioEmail";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHead } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";
import { STUDIO } from "@/lib/studio";
import { CONTACT_MESSAGE_MIN, CONTACT_NAME_MIN } from "@/lib/validation";

export function ContactBody() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  /* Live length of the message, so the form can say how much more it needs
     before anyone presses send. */
  const [messageLength, setMessageLength] = useState(0);

  /* The server is the gate; these are the same rules said in the reader's own
     language so nobody has to submit to find out what is wrong. */
  const messageFor = (code: string) =>
    ({
      NAME_REQUIRED: t.contactPage.errName,
      NAME_TOO_LONG: t.contactPage.errName,
      EMAIL_INVALID: t.contactPage.errEmail,
      MESSAGE_TOO_SHORT: t.contactPage.errMessageShort.replace(
        "{n}",
        String(CONTACT_MESSAGE_MIN),
      ),
      MESSAGE_TOO_LONG: t.contactPage.errMessageLong,
    })[code] ?? t.common.somethingWrong;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);

    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();

    if (name.length < CONTACT_NAME_MIN) {
      setError(messageFor("NAME_REQUIRED"));
      setState("error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setError(messageFor("EMAIL_INVALID"));
      setState("error");
      return;
    }
    if (message.length < CONTACT_MESSAGE_MIN) {
      setError(messageFor("MESSAGE_TOO_SHORT"));
      setState("error");
      return;
    }

    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          phone: form.get("phone"),
          message: form.get("message"),
        }),
      });
      if (res.ok) {
        setState("sent");
        formEl.reset();
      } else {
        const data = (await res.json()) as { error?: string };
        setError(messageFor(data.error ?? ""));
        setState("error");
      }
    } catch {
      setError(t.common.somethingWrong);
      setState("error");
    }
  }

  return (
    <Section className="pt-12 md:pt-16">
      {/* Order matters more than the grid does. On a phone the three pieces
          stack in the order they are written — invitation, then the form that
          answers it, then the address you only want once you have sent it. On a
          laptop they are placed explicitly: copy and details down the left,
          form beside them. Same DOM, so nothing is duplicated. */}
      <div className="container-x flex flex-col gap-14 lg:grid lg:grid-cols-[1.1fr_1fr] lg:gap-x-24 lg:gap-y-14">
        <div className="lg:col-start-1 lg:row-start-1">
          <SectionHead
            eyebrow={t.contactPage.eyebrow}
            title={t.contactPage.title}
            body={t.contactPage.body}
          />
        </div>

        <Reveal
          delay={0.1}
          className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start"
        >
          <form
            onSubmit={submit}
            /* The required/minLength attributes stay for assistive tech, but the
               browser's own bubbles are suppressed: they appear in the
               browser's language, which is not necessarily the language the
               visitor chose for the site. The checks in submit() say the same
               thing in the right one, and the server enforces it regardless. */
            noValidate
            className="rounded-4xl border border-mocha-200/70 bg-white/70 p-8 backdrop-blur-sm md:p-10"
          >
            {state === "sent" ? (
              <div className="py-16 text-center">
                <Monogram className="mx-auto h-12 w-12 text-mocha-500" />
                <p className="mt-8 text-[15px] text-mocha-600">
                  {t.contactPage.formSent}
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="name">
                      {t.contactPage.formName}{" "}
                      <span aria-hidden className="text-clay/70">
                        *
                      </span>
                    </label>
                    <input
                      id="name"
                      name="name"
                      required
                      minLength={CONTACT_NAME_MIN}
                      autoComplete="name"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="email">
                      {t.contactPage.formEmail}{" "}
                      <span aria-hidden className="text-clay/70">
                        *
                      </span>
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="phone">
                      {t.contactPage.formPhone}{" "}
                      <span className="text-clay/60">
                        ({t.common.optional})
                      </span>
                    </label>
                    <input id="phone" name="phone" className="input" />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      className="label flex items-baseline justify-between gap-4"
                      htmlFor="message"
                    >
                      <span>
                        {t.contactPage.formMessage}{" "}
                        <span aria-hidden className="text-clay/70">
                          *
                        </span>
                      </span>
                      {messageLength < CONTACT_MESSAGE_MIN && (
                        <span className="text-[10px] normal-case tracking-normal text-clay">
                          {t.contactPage.messageHint.replace(
                            "{n}",
                            String(CONTACT_MESSAGE_MIN - messageLength),
                          )}
                        </span>
                      )}
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      required
                      minLength={CONTACT_MESSAGE_MIN}
                      rows={6}
                      onChange={(e) =>
                        setMessageLength(e.currentTarget.value.trim().length)
                      }
                      className="input resize-none"
                    />
                  </div>
                </div>

                {error && <p className="mt-5 text-sm text-red-600">{error}</p>}

                <Button
                  type="submit"
                  className="mt-8 w-full"
                  disabled={state === "sending"}
                >
                  {state === "sending"
                    ? t.common.loading
                    : t.contactPage.formSubmit}
                </Button>
              </>
            )}
          </form>
        </Reveal>
        <Reveal
          delay={0.16}
          className="space-y-10 lg:col-start-1 lg:row-start-2 lg:-mt-2"
        >
          <div>
            <p className="eyebrow mb-3">{t.contactPage.findTitle}</p>
            <p className="text-[15px] leading-relaxed text-mocha-500">
              {STUDIO.addressLines.map((l) => (
                <span key={l} className="block">
                  {l}
                </span>
              ))}
            </p>
            <a
              href={STUDIO.mapsLink}
              target="_blank"
              rel="noreferrer noopener"
              className="link-underline mt-3 inline-block text-[11px] uppercase tracking-widest text-mocha-600"
            >
              Google Maps
            </a>
          </div>

          <div>
            <p className="eyebrow mb-3">{t.contactPage.hoursTitle}</p>
            <p className="text-[15px] leading-relaxed text-mocha-500">
              {openingSummary().map((g) => (
                <span
                  key={g.days.join(",")}
                  className={g.blocks.length ? "block" : "block text-clay"}
                >
                  {formatDayList(g.days, t.common.daysShort)}:{" "}
                  {g.blocks.length
                    ? g.blocks.join(" · ")
                    : t.home.timetable.closed}
                </span>
              ))}
              <span className="block">
                {t.home.timetable.personalLabel}: {t.home.timetable.personalHours}
              </span>
            </p>
          </div>

          <div>
            <p className="eyebrow mb-3">{t.contactPage.followTitle}</p>
            <SocialLinks
              className="gap-3"
              itemClassName="text-mocha-600 hover:text-mocha-700"
            />
            <div className="mt-4 space-y-2 text-[15px]">
              <StudioEmail className="link-underline text-mocha-600" />
              <a
                href={`tel:${STUDIO.phone.replace(/\s/g, "")}`}
                className="link-underline block text-mocha-600"
              >
                {STUDIO.phone}
              </a>
            </div>
          </div>

          <Monogram className="h-10 w-10 text-clay/40" />
        </Reveal>
      </div>
    </Section>
  );
}
