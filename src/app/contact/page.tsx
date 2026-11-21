import type { Metadata } from "next";

import {
  Mail,
  Code2,
  BriefcaseBusiness,
  MessageCircle,
  Camera,
  CirclePlay,
  Send,
  ExternalLink,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PageIntro } from "@/components/ui/page-intro";
import { getPublicSiteProfile } from "@/lib/site-profile";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Bigyan Sanjyal using the website's message form or public social profiles for questions and project inquiries.",
  alternates: {
    canonical: "/contact",
  },
};

const contactLinks = [
  {
    label: "Facebook",
    detail: "facebook.com/bigyan97",
    href: "https://www.facebook.com/bigyan97",
    mark: "f",
    markClass: "facebook",
  },
  {
    label: "Gmail",
    detail: "bigyansanjyal56@gmail.com",
    href: "mailto:bigyansanjyal56@gmail.com",
    icon: Mail,
  },
  {
    label: "LinkedIn",
    detail: "linkedin.com/in/bigyan63",
    href: "https://www.linkedin.com/in/bigyan63",
    mark: "in",
    markClass: "linkedin",
  },
  {
    label: "GitHub",
    detail: "github.com/bigyan-svg",
    href: "https://github.com/bigyan-svg",
    icon: Code2,
  },
  {
    label: "WhatsApp",
    detail: "bigyan.63 · +977 9769927110",
    href: "https://wa.me/9779769927110",
    icon: MessageCircle,
  },
];

function ContactSocialLinks() {
  return (
    <nav aria-label="Social and contact profiles" className="contact-social__links">
      {contactLinks.map((link) => {
        const Icon = link.icon;
        return (
          <a
            className="contact-social__link"
            href={link.href}
            key={link.label}
            rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
            target={link.href.startsWith("http") ? "_blank" : undefined}
            aria-label={`Open ${link.label}: ${link.detail}`}
          >
            <span className={`contact-social__icon ${link.markClass ? `contact-social__icon--${link.markClass}` : ""}`} aria-hidden="true">
              {link.mark ? <span className="contact-social__brand-mark">{link.mark}</span> : Icon ? <Icon size={20} strokeWidth={1.8} /> : null}
            </span>
            <span className="contact-social__link-copy">
              <span className="contact-social__link-label">{link.label}</span>
              <span className="contact-social__link-detail">{link.detail}</span>
            </span>
            {link.href.startsWith("http") ? (
              <ExternalLink aria-hidden="true" className="contact-social__external" size={14} />
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}

