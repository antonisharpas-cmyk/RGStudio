import { cn } from "@/lib/utils";
import { STUDIO } from "@/lib/studio";

/**
 * The studio's social accounts, shown as the platform's own mark next to the
 * handle. Both are real links that open the account in a new tab.
 *
 * The marks are CSS masks over currentColor (see globals.css), so the same
 * component reads correctly on the cream contact page and on the dark footer
 * without a second set of assets, and the path data stays out of the bundle.
 */

type Account = {
  href: string;
  label: string;
  handle: string;
  icon: string;
};

export const SOCIAL_ACCOUNTS: Account[] = [
  {
    href: STUDIO.instagram,
    label: "Instagram",
    handle: STUDIO.instagramHandle,
    icon: "social-icon-instagram",
  },
  {
    href: STUDIO.facebook,
    label: "Facebook",
    /* The Facebook page's own URL is a numeric profile id, so the page's name
       stands in for a handle. */
    handle: "RG pilates studio",
    icon: "social-icon-facebook",
  },
];

export function SocialLinks({
  className,
  itemClassName,
  iconClassName = "h-[18px] w-[18px]",
}: {
  className?: string;
  itemClassName?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {SOCIAL_ACCOUNTS.map((a) => (
        <a
          key={a.label}
          href={a.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${a.label}: ${a.handle}`}
          className={cn(
            "group inline-flex w-fit items-center gap-2.5 transition-opacity duration-500 hover:opacity-100",
            itemClassName,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "social-icon transition-transform duration-500 ease-silk group-hover:scale-110",
              a.icon,
              iconClassName,
            )}
          />
          <span className="link-underline text-[15px]">{a.handle}</span>
        </a>
      ))}
    </div>
  );
}
