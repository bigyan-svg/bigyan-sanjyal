import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PageIntro } from "@/components/ui/page-intro";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Send a message through the Contact page.",
};

export default function ContactPage() {
  return (
    <>
      <PageIntro
        description="Have a question or a project idea? Send a message using the form below."
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
              <h2>No public contact details yet.</h2>
              <p>
                An email address, phone number, or social profile has not been
                provided for publication.
              </p>
            </Card>

            <Card className="contact-form-card" variant="glow">
              <ContactForm />
            </Card>
          </div>
        </Container>
      </section>
    </>
  );
}
