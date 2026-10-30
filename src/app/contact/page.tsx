import type { Metadata } from "next";
import { CircleAlert, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PageIntro } from "@/components/ui/page-intro";
import { TextArea, TextInput } from "@/components/ui/form-field";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Bigyan Sanjyal. Public contact details and message delivery will be added when configured.",
};

export default function ContactPage() {
  return (
    <>
      <PageIntro
        description="Have a question or a project idea? Public contact details and secure message delivery will be added when configured."
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
              <div className="contact-form__notice" role="status">
                <CircleAlert aria-hidden="true" size={19} />
                <div>
                  <strong>Message delivery is not connected.</strong>
                  <p>
                    This form is disabled for now. It does not send or store
                    messages.
                  </p>
                </div>
              </div>

              <form className="contact-form">
                <fieldset disabled>
                  <legend className="sr-only">Contact form preview</legend>
                  <div className="contact-form__row">
                    <TextInput autoComplete="name" id="name" label="Your name" placeholder="Name" />
                    <TextInput
                      autoComplete="email"
                      id="email"
                      label="Email address"
                      placeholder="you@example.com"
                      type="email"
                    />
                  </div>
                  <TextInput id="subject" label="Subject" placeholder="What is this about?" />
                  <TextArea
                    id="message"
                    label="Message"
                    placeholder="Write your message…"
                    rows={5}
                  />
                  <Button disabled type="submit">
                    Send message
                  </Button>
                </fieldset>
              </form>
            </Card>
          </div>
        </Container>
      </section>
    </>
  );
}
