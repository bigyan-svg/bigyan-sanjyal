import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/ui/container";

const footerLinks = [
  { label: "About", href: "/about" },
  { label: "Projects", href: "/projects" },
  { label: "Blog", href: "/blog" },
  { label: "Contact", href: "/contact" },
];

export function SiteFooter({
  displayName,
  headline,
  monogram,
}: {
  displayName: string;
  headline: string | null;
  monogram: string;
}) {
  return (
    <footer className="site-footer">
      <Container>
        <div className="site-footer__main">
          <div className="site-footer__identity">
            <Link className="brand" href="/">
              <span aria-hidden="true" className="brand__mark">
                {monogram}
              </span>
              <span className="brand__text">
                <span className="brand__name">{displayName}</span>
                <span className="brand__caption">{headline || "Personal website"}</span>
              </span>
            </Link>
            <p>A home for projects, learning, and ideas.</p>
          </div>

          <nav aria-label="Footer navigation" className="site-footer__nav">
            {footerLinks.map((link) => (
              <Link href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>

          <Link className="back-to-top" href="/#top">
            Back to top <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </div>

        <div className="site-footer__bottom">
          <p>© {displayName}</p>
          <p>Thoughtfully built, one step at a time.</p>
        </div>
      </Container>
    </footer>
  );
}
