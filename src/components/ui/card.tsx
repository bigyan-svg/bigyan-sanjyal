import type { HTMLAttributes, ReactNode } from "react";

export type CardVariant = "default" | "outlined" | "glow";

interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  children: ReactNode;
}

export function Card({
  variant = "default",
  className,
  children,
  ...props
}: CardProps) {
  return (
    <article
      className={["card", `card--${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </article>
  );
}
