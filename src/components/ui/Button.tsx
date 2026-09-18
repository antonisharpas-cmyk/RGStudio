import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "solid" | "outline" | "ghost" | "cream";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-normal uppercase tracking-widest transition-all duration-500 ease-silk disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mocha-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";

const variants: Record<Variant, string> = {
  solid:
    "bg-mocha-600 text-cream hover:bg-mocha-700 shadow-soft hover:shadow-lift hover:-translate-y-0.5",
  outline:
    "border border-mocha-300 text-mocha-600 hover:border-mocha-600 hover:bg-mocha-600 hover:text-cream",
  ghost: "text-mocha-600 hover:bg-mocha-100",
  cream:
    "bg-cream text-mocha-600 hover:bg-white shadow-soft hover:-translate-y-0.5",
};

const sizes: Record<Size, string> = {
  sm: "text-[10px] px-4 py-2.5",
  md: "text-[11px] px-6 py-3.5",
  lg: "text-[12px] px-8 py-4",
};

export function buttonClass({
  variant = "solid",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant,
  size,
  className,
  children,
  ...rest
}: ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  children,
  ...rest
}: ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </Link>
  );
}
