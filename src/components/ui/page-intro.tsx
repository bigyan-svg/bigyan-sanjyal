import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";

interface PageIntroProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}

export function PageIntro({
  id,
  eyebrow,
  title,
  description,
  children,
}: PageIntroProps) {
  return (
    <section aria-labelledby={id} className="page-intro">
      <Container>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id={id}>{title}</h1>
        <p className="page-intro__description">{description}</p>
        {children ? <div className="page-intro__actions">{children}</div> : null}
      </Container>
    </section>
  );
}
