import type { Metadata } from "next";
import Image from "next/image";
import { BookOpen, Compass, UserRound } from "lucide-react";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PageIntro } from "@/components/ui/page-intro";
import { SectionHeading } from "@/components/ui/section-heading";
import { getProfileInitials, getPublicSiteProfile } from "@/lib/site-profile";

export const metadata: Metadata = {
  title: "About",
  description: "Public profile and biography information.",
};

export default function AboutPage() {
  return (
    <Suspense fallback={<AboutPageLoading />}>
      <AboutPageContent />
    </Suspense>
  );
}

async function AboutPageContent() {
  let profile = null;

  try {
    profile = await getPublicSiteProfile();
  } catch {
    profile = null;
  }

  const displayName = profile?.displayName ?? "Personal profile";

  return (
    <>
      <PageIntro
        description={profile?.shortBio ?? "Profile details have not been added yet."}
        eyebrow="About / 01"
        id="about-title"
        title="A little about me."
      />

      <section aria-labelledby="profile-title" className="section page-content">
        <Container>
          <SectionHeading
            description="Public profile information."
            eyebrow="Profile"
            id="profile-title"
            title="Profile details"
          />
          <div className="about-grid">
            <Card className="profile-card" variant="glow">
              {profile?.avatarUrl ? (
                <Image
                  alt={`${displayName} profile photo`}
                  className="profile-card__avatar-image"
                  height={120}
                  referrerPolicy="no-referrer"
                  src={profile.avatarUrl}
                  unoptimized
                  width={120}
                />
              ) : (
                <div aria-hidden="true" className="profile-card__monogram">
                  {getProfileInitials(displayName)}
                </div>
              )}
              <div className="profile-card__copy">
                <p className="eyebrow">
                  <UserRound aria-hidden="true" size={15} />
                  Public profile
                </p>
                <h2>{displayName}</h2>
                {profile?.headline ? (
                  <p className="profile-card__headline">{profile.headline}</p>
                ) : null}
                <p className="profile-card__biography">
                  {profile?.biography ?? "A full biography has not been added yet."}
                </p>
              </div>
            </Card>

            <div className="about-note-grid">
              <Card className="about-note" variant="outlined">
                <span aria-hidden="true" className="destination-card__icon">
                  <Compass size={19} />
                </span>
                <h3>Interests and goals</h3>
                <p>Personal interests and future goals will be added when ready to publish.</p>
              </Card>
              <Card className="about-note" variant="outlined">
                <span aria-hidden="true" className="destination-card__icon">
                  <BookOpen size={19} />
                </span>
                <h3>Learning philosophy</h3>
                <p>Notes about learning and current interests can be added here.</p>
              </Card>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

function AboutPageLoading() {
  return (
    <section aria-busy="true" className="section page-content">
      <Container>
        <p className="eyebrow" role="status">Loading profile…</p>
      </Container>
    </section>
  );
}
