import {
  FaqSection,
  PricingPreview,
} from "@/components/home/CatalogueSections";
import { Hero } from "@/components/home/Hero";
import {
  FinalCta,
  HowItWorks,
  Intro,
  Marquee,
  Method,
  Equipment,
  TimetablePreview,
} from "@/components/home/HomeSections";
import { currentUser } from "@/lib/auth";
import { hasAvatar } from "@/lib/avatars";
import { getAvailableCredits } from "@/lib/credits";
import { getPackages } from "@/lib/catalogue";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [packages, user] = await Promise.all([getPackages(), currentUser()]);

  /* The cover carries its own account row, because the header hides its chip
     over this section. Two extra reads, and only when somebody is signed in. */
  const heroUser = user
    ? {
        name: user.name,
        hasPhoto: await hasAvatar(user.id),
        credits: await getAvailableCredits(user.id),
      }
    : null;

  return (
    <>
      {/* The logo animation that used to play here is gone: the studio did not
          like it, and a splash screen between somebody and the thing they came
          for is a cost with no return. Removed rather than made optional —
          nobody was going to switch it back on. */}
      <Hero user={heroUser} />
      <Marquee />
      <Intro />
      <Method />
      <Equipment />
      <TimetablePreview />
      <PricingPreview packages={packages} signedIn={Boolean(user)} />
      <HowItWorks />
      <FaqSection />
      <FinalCta />
    </>
  );
}
