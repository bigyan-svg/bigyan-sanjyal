import Image from "next/image";
import { ArrowRight, BookOpenText, Code2, GraduationCap, Wrench } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Home",
  description:
    "Bigyan Sanjyal is a Computer Engineering student at NCIT interested in software development, web technologies, and building useful applications.",
  alternates: { canonical: "/" },
};

const destinations = [
  {
    href: "/about",
    label: "About",
    description: "My background, education, interests, and learning journey.",
    icon: <GraduationCap aria-hidden="true" size={19} />,
  },
  {
    href: "/projects",
    label: "Projects",
    description: "Applications and experiments I have worked on.",
    icon: <Wrench aria-hidden="true" size={19} />,
  },
  {
    href: "/blog",
    label: "Writing",
    description: "Notes, articles, and ideas from my learning journey.",
    icon: <BookOpenText aria-hidden="true" size={19} />,
  },
];

const technologies = [
  "C", "C++", "Java", "Python", "JavaScript", "TypeScript",
  "React", "Next.js", "HTML", "CSS", "Tailwind CSS", "PHP",
  "Node.js", "Flask", "PostgreSQL", "MySQL", "Prisma", "Git",
];

export default function Home() {
  return (
    <>
      <section aria-labelledby="home-title" className="hero section" id="top">
        <Container className="hero__grid">
          <div className="hero__copy">
            <p className="eyebrow">Computer Engineering · NCIT</p>
            <h1 id="home-title"><span className="text-gradient">Bigyan Sanjyal</span></h1>
            <p className="hero__role">Computer Engineering Student &amp; Aspiring Software Developer</p>
            <p className="hero__description">
              I’m a 5th-semester Computer Engineering student at Nepal College of
              Information Technology (NCIT). I build web applications, explore
              modern software technologies, and enjoy solving practical problems
              through code. I’m currently developing my skills across frontend,
              backend, and database technologies.
            </p>
            <div className="button-row">
              <ButtonLink href="/projects" size="large">
                Explore projects <ArrowRight aria-hidden="true" size={17} />
              </ButtonLink>
              <ButtonLink href="/about" size="large" variant="secondary">More about me</ButtonLink>
            </div>
            <p className="hero__footnote">
              <span aria-hidden="true" className="status-dot" />
              Mahalaxmi-05, Lalitpur, Nepal
            </p>
          </div>

          <div className="hero-profile">
            <div className="hero-profile__photo">
              <Image
                src="/images/bigyan-profile.jpg"
                alt="Portrait of Bigyan Sanjyal"
                fill
                priority
                unoptimized
                sizes="(max-width: 48rem) 82vw, (max-width: 75rem) 42vw, 500px"
                className="hero-profile__image"
              />
            </div>
            <div className="hero-profile__caption">
              <span className="hero-profile__caption-label">Currently studying</span>
              <strong>Bachelor of Computer Engineering</strong>
              <span>NCIT · 5th Semester</span>
            </div>
            <span aria-hidden="true" className="hero-profile__orbit hero-profile__orbit--one" />
            <span aria-hidden="true" className="hero-profile__orbit hero-profile__orbit--two" />
          </div>
        </Container>
      </section>

      <section aria-labelledby="overview-title" className="section section--bordered" id="overview">
        <Container>
          <SectionHeading
            description="A quick overview of my academic background, technical interests, and current work."
            eyebrow="01 / Profile"
            id="overview-title"
            title="A little about me."
          />
          <div className="profile-overview-grid">
            <Card className="profile-overview-card" variant="default">
              <span className="destination-card__icon"><GraduationCap aria-hidden="true" size={20} /></span>
              <p className="eyebrow">Education</p>
              <h3>Computer Engineering</h3>
              <p>Studying at Nepal College of Information Technology (NCIT), affiliated with Pokhara University.</p>
              <span className="profile-overview-card__meta">5th Semester · Expected 2029</span>
            </Card>
            <Card className="profile-overview-card" variant="default">
              <span className="destination-card__icon"><Code2 aria-hidden="true" size={20} /></span>
              <p className="eyebrow">Technical focus</p>
              <h3>Web &amp; Software Development</h3>
              <p>Building responsive web interfaces and full-stack applications with modern frameworks, databases, and developer tools.</p>
              <span className="profile-overview-card__meta">Frontend · Backend · Databases</span>
            </Card>
            <Card className="profile-overview-card" variant="default">
              <span className="destination-card__icon"><Wrench aria-hidden="true" size={20} /></span>
              <p className="eyebrow">Current work</p>
              <h3>Learning by building</h3>
              <p>Developed and deployed my personal portfolio; collaborating on a student information system for an academic project.</p>
              <span className="profile-overview-card__meta">Independent &amp; team projects</span>
            </Card>
          </div>
        </Container>
      </section>

      <section aria-labelledby="technology-title" className="section" id="technology">
        <Container>
          <SectionHeading
            description="Technologies I have used in coursework, personal development, and collaborative projects."
            eyebrow="02 / Toolkit"
            id="technology-title"
            title="Tools I work with."
          />
          <div className="technology-list" aria-label="Technical skills">
            {technologies.map((technology) => <span className="technology-chip" key={technology}>{technology}</span>)}
          </div>
        </Container>
      </section>

      <section aria-labelledby="projects-title" className="section section--bordered" id="selected-projects">
        <Container>
          <SectionHeading
            description="A selection of practical work that reflects what I am learning and building."
            eyebrow="03 / Selected work"
            id="projects-title"
            title="Projects and practice."
          />
          <div className="journey-grid">
            <Card className="journey-card" variant="outlined">
              <p className="eyebrow">Completed · Independent</p>
              <h3>Personal Blog / Portfolio Website</h3>
              <p>Designed, developed, and deployed a personal website using Next.js, React, TypeScript, and Tailwind CSS, with PostgreSQL and Prisma on the backend.</p>
              <Link className="text-link" href="https://bigyansanjyal.com.np" target="_blank" rel="noreferrer">
                Visit live website <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </Card>
            <Card className="journey-card" variant="outlined">
              <p className="eyebrow">Under development · Team of 4</p>
              <h3>NCIT_SIS — Student Information System</h3>
              <p>Collaborating on an academic student information system built with Python, Flask, and MySQL as part of a four-member team.</p>
              <Link className="text-link" href="https://github.com/bigyan-svg/NCIT_SIS" target="_blank" rel="noreferrer">
                View GitHub repository <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </Card>
          </div>
          <div className="home-projects-action">
            <ButtonLink href="/projects" variant="secondary">
              View all projects <ArrowRight aria-hidden="true" size={16} />
            </ButtonLink>
          </div>
        </Container>
      </section>

      <section aria-labelledby="explore-title" className="section" id="explore">
        <Container>
          <SectionHeading
            description="Explore more about my background, projects, and ideas."
            eyebrow="04 / Explore"
            id="explore-title"
            title="Discover more."
          />
          <div className="destination-grid">
            {destinations.map((destination) => (
              <Card className="destination-card" key={destination.href} variant="default">
                <span aria-hidden="true" className="destination-card__icon">{destination.icon}</span>
                <h3>{destination.label}</h3>
                <p>{destination.description}</p>
                <Link className="text-link" href={destination.href}>
                  Visit {destination.label.toLowerCase()} <ArrowRight aria-hidden="true" size={15} />
                </Link>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section aria-labelledby="contact-cta-title" className="contact-cta">
        <Container className="contact-cta__inner">
          <div>
            <p className="eyebrow">Stay connected</p>
            <h2 id="contact-cta-title">Let’s connect and build something useful.</h2>
            <p>For collaboration, project discussions, or internship opportunities, get in touch.</p>
          </div>
          <ButtonLink href="/contact" variant="secondary">
            Contact me <ArrowRight aria-hidden="true" size={16} />
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}
