import { ArrowUpRight } from "lucide-react";
import type { PublicSocialLink } from "@/lib/profile-social-validation";

export function ProfileSocialLinks({ links }: { links: PublicSocialLink[] }) {
  if (links.length === 0) return null;

  return (
    <nav aria-label="Social profiles" className="profile-card__social-links">
      <h3>Find me online</h3>
      <ul>
        {links.map((link, index) => (
          <li key={`${index}-${link.url}`}>
            <a
              href={link.url}
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              target="_blank"
            >
              <span>{link.label}</span>
              <ArrowUpRight aria-hidden="true" size={15} />
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
