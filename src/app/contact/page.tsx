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

function socialIcon(label: string) {
  const value = label.toLowerCase();
  if (value.includes("facebook")) return Users;
  if (value.includes("github")) return Code2;
  if (value.includes("linkedin")) return BriefcaseBusiness;
  if (value.includes("whatsapp")) return MessageCircle;
  if (value.includes("instagram")) return Camera;
  if (value.includes("youtube")) return CirclePlay;
  if (value.includes("telegram")) return Send;
  if (value.includes("mail") || value.includes("gmail") || value.includes("email")) return Mail;
  return ExternalLink;
}

export default async function ContactPage() {
  const profile = await getPublicSiteProfile();
  const socialLinks = profile?.socialLinks ?? [];

  return (
    <>
      <PageIntro
        description="Have a question or a project idea? Send a message using the form below, or connect through my public profiles."
        eyebrow="Contact / 06"
        id="contact-title"
        title="Get in touch."
      />
      <section aria-labelledby="contact-content-title" className="section page-content">
        <Container>
          <h2 className="sr-only" id="contact-content-title">
            Contact details and message form
          </h2>
          <div className="contact-grid">
            <Card className="contact-details" variant="outlined">
              <span aria-hidden="true" className="destination-card__icon">
                <Mail size={20} />
              </span>
              <p className="eyebrow">Contact details</p>
              <h2>Connect with me.</h2>
              <p>
                Use the message form or choose one of my public profiles below.
              </p>
            </Card>

            <Card className="contact-form-card" variant="glow">
              <ContactForm />
            </Card>
          </div>

          <section aria-labelledby="social-contact-title" className="contact-social">
            <div className="section-heading">
              <p className="eyebrow">Around the web</p>
              <h2 id="social-contact-title">Find me on social platforms.</h2>
              <p>Choose a profile to connect, follow, or send a message.</p>
            </div>
            {socialLinks.length > 0 ? (
              <nav aria-label="Social and contact profiles" className="contact-social__links">
                {socialLinks.map((link) => {
                  const Icon = socialIcon(link.label);
                  return (
                    <a
                      className="contact-social__link"
                      href={link.url}
                      key={link.label + link.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span className="contact-social__icon" aria-hidden="true">
                        <Icon size={20} />
                      </span>
                      <span>{link.label}</span>
                      <ExternalLink aria-hidden="true" className="contact-social__external" size={14} />
                    </a>
                  );
                })}
              </nav>
            ) : (
              <p className="contact-social__empty">
                Social profiles will appear here when they are added in the website profile settings.
              </p>
            )}
          </section>
        </Container>
      </section>
    </>
  );
}
