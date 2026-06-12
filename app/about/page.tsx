import { headers } from "next/headers";

import { getAppStrings, pickAppLocale } from "@/lib/i18n/app-locales";

export default async function AboutPage() {
  const h = await headers();
  const t = getAppStrings(pickAppLocale(h.get("accept-language")));
  return (
    <article className="mx-auto w-full max-w-2xl space-y-4 px-6 py-24 text-text-primary md:px-8">
      <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1]">{t.aboutTitle}</h1>
      <p className="font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary">{t.aboutBody}</p>
    </article>
  );
}
