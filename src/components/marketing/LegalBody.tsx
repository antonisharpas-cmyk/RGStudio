"use client";

import { Section } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";
import { legalSections, type LegalKind } from "@/lib/legal";

/**
 * One of the three readers of lib/legal.ts, the others being the modal on the
 * sign-up form and the cookie notice. The words live there so that accepting
 * them at sign-up and reading them on this page cannot be two different
 * documents.
 */

/**
 * `**like this**` becomes bold, and nothing else is markup.
 *
 * The documents needed run-in headings: a privacy notice that lists eight
 * purposes has to be able to say **To take payment.** at the start of a
 * paragraph, or it is eight paragraphs a reader has to parse to find the one
 * about their card. Splitting them into more sections was the alternative and
 * it is worse: the section headings are the contract's structure, and burying
 * "we do not sell your information" under its own heading gives it the same
 * weight as "Who is responsible".
 *
 * So exactly one piece of markup, implemented in six lines, and no library.
 * Anything else in the text is text: an asterisk on its own passes straight
 * through, because splitting on `**` leaves it in an odd-indexed piece only if
 * it was doubled.
 */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((piece, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-normal text-mocha-700">
            {piece}
          </strong>
        ) : (
          piece
        ),
      )}
    </>
  );
}

export function LegalBody({ kind }: { kind: LegalKind }) {
  const { t, locale } = useI18n();

  /* One copy of the text, shared with the sign-up modal. See lib/legal.ts. */
  const items = legalSections(kind, locale);

  const heading =
    kind === "privacy"
      ? t.legal.privacyTitle
      : kind === "cookies"
        ? t.legal.cookiesTitle
        : t.legal.termsTitle;

  return (
    <Section className="pt-12 md:pt-16">
      <div className="container-x max-w-3xl">
        <p className="eyebrow mb-5">{t.footer.legal}</p>
        <h1 className="h-display text-[2.4rem] leading-tight sm:text-5xl">
          {heading}
        </h1>

        <div className="mt-12 space-y-10">
          {items.map(({ title, body }) => (
            <div key={title} className="border-t border-mocha-200/70 pt-8">
              <h2 className="text-[13px] uppercase tracking-widest">{title}</h2>
              {/* `whitespace-pre-line` because most sections are several
                  paragraphs and HTML collapses the blank line between them.
                  Written as text with blank lines rather than as an array, so
                  the words stay readable in lib/legal.ts where a lawyer will
                  edit them. */}
              <p className="mt-3 whitespace-pre-line text-[15px] leading-[1.9] text-mocha-500">
                <RichText text={body} />
              </p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
