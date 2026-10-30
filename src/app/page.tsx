import { ArrowRight, BookOpenText, GraduationCap, Sparkles, UserRound, Wrench } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { getProfileInitials, getPublicSiteProfile } from "@/lib/site-profile";

const destinations = [
  {
    href: "/about",
    label: "About",
    description: "Profile and background information.",
    icon: <UserRound aria-hidden="true" size={19} />,
  },
  {
    href: "/projects",
    label: "Projects",
    description: "A place for project details, technologies, and links.",
    icon: <Wrench aria-hidden="true" size={19} />,
  },
  {
    href: "/blog",
    label: "Writing",
    description: "Articles, notes, and ideas from the learning journey.",
    icon: <BookOpenText aria-hidden="true" size={19} />,
  },
];

export default function Home() {
  return (
    <>
      <section aria-labelledby="home-title" className="hero section" id="top">
        <Container className="hero__grid">
          <div className="hero__copy">
            <p className="eyebrow">
              <span aria-hidden="true" className="eyebrow__sparkle">
                <Sparkles size={15} />
              </span>
              Projects · Learning · Ideas
            </p>
            <h1 id="home-title">
              <span className="text-gradient">
                <Suspense fallback="Personal website">
                  <HomeProfileName />
                </Suspense>
              </span>
            </h1>
            <Suspense fallback={null}>
              <HomeProfileHeadline />
            </Suspense>
            <Suspense fallback={null}>
              <HomeProfileShortBio />
            </Suspense>
            <div className="button-row">
              <ButtonLink href="/projects" size="large">
                Explore projects <ArrowRight aria-hidden="true" size={17} />
              </ButtonLink>
              <ButtonLink href="/about" size="large" variant="secondary">
                About me
              </ButtonLink>
            </div>
            <p className="hero__footnote">
              <span aria-hidden="true" className="status-dot" />
              A personal portfolio and learning journal
            </p>
          </div>

          <div aria-hidden="true" className="hero-art">
            <div className="hero-art__stars" />
            <div className="hero-art__glow" />
            <div className="hero-art__ring hero-art__ring--outer" />
            <div className="hero-art__ring hero-art__ring--inner" />
            <div className="hero-art__horizon" />
            <div className="hero-art__ridge hero-art__ridge--back" />
            <div className="hero-art__ridge hero-art__ridge--front" />
            <div className="hero-art__monogram">
              <Suspense fallback="P">
                <HomeProfileInitials />
              </Suspense>
            </div>
            <div className="hero-art__caption">
              <span>Portfolio · Learning · Ideas</span>
              <span className="hero-art__caption-line" />
            </div>
          </div>
        </Container>
      </section>

      <section
        aria-labelledby="explore-title"
        className="section section--bordered"
        id="explore"
      >
        <Container>
          <SectionHeading
            description="Explore the parts of my work and journey that will be shared here."
            eyebrow="01 / Explore"
            id="explore-title"
            title="A space for work and ideas."
          />
          <div className="destination-grid">
            {destinations.map((destination) => (
              <Card className="destination-card" key={destination.href} variant="default">
                <span aria-hidden="true" className="destination-card__icon">
                  {destination.icon}
                </span>
                <h3>{destination.label}</h3>
                <p>{destination.description}</p>
                <Link className="text-link" href={destination.href}>
                  Visit {destination.label.toLowerCase()}
                  <ArrowRight aria-hidden="true" size={15} />
                </Link>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section aria-labelledby="journey-title" className="section" id="journey">
        <Container>
          <SectionHeading
            description="Some details are still to be added. These pages will grow with confirmed information and published work."
            eyebrow="02 / Journey"
            id="journey-title"
            title="Learning, one step at a time."
          />
          <div className="journey-grid">
            <Card className="journey-card" variant="outlined">
              <span aria-hidden="true" className="destination-card__icon">
                <Wrench size={19} />
              </span>
              <p className="eyebrow">Skills</p>
              <h3>Tools and technologies</h3>
              <p>
                A confirmed list of skills and experience levels will be added
                here.
              </p>
              <Link className="text-link" href="/skills">
                View skills <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </Card>

            <Card className="journey-card" variant="outlined">
              <span aria-hidden="true" className="destination-card__icon">
                <GraduationCap size={19} />
              </span>
              <p className="eyebrow">Education</p>
              <h3>Computer Engineering</h3>
              <p>
                Institution, program dates, and coursework will be included
                once confirmed.
              </p>
              <Link className="text-link" href="/education">
                View education <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </Card>
          </div>
        </Container>
      </section>

      <section aria-labelledby="contact-cta-title" className="contact-cta">
        <Container className="contact-cta__inner">
          <div>
            <p className="eyebrow">Stay connected</p>
            <h2 id="contact-cta-title">Have a question or an idea?</h2>
            <p>
              Visit the contact page for the current message form status.
            </p>
          </div>
          <ButtonLink href="/contact" variant="secondary">
            Contact page <ArrowRight aria-hidden="true" size={16} />
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}

async function HomeProfileName() {
  try {
    const profile = await getPublicSiteProfile();
    return profile?.displayName ?? "Personal website";
  } catch {
    return "Personal website";
  }
}

async function HomeProfileHeadline() {
  let headline: string | null = null;

  try {
    const profile = await getPublicSiteProfile();
    headline = profile?.headline ?? null;
  } catch {
    headline = null;
  }

  return headline ? <p className="hero__role">{headline}</p> : null;
}

async function HomeProfileShortBio() {
  let shortBio: string | null = null;

  try {
    const profile = await getPublicSiteProfile();
    shortBio = profile?.shortBio ?? null;
  } catch {
    shortBio = null;
  }

  return shortBio ? <p className="hero__description">{shortBio}</p> : null;
}

async function HomeProfileInitials() {
  try {
    const profile = await getPublicSiteProfile();
    return getProfileInitials(profile?.displayName ?? "Personal website");
  } catch {
    return "P";
  }
}
