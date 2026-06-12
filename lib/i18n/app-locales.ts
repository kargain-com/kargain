export type AppLocale = "en" | "fr";

const PAGES = {
  en: {
    aboutTitle: "About Kargain",
    aboutBody:
      "Kargain is a decentralized marketplace for vehicle history and ownership, built on Base with on-chain KarPassport NFTs, IPFS metadata, and escrowed listings.",
    termsTitle: "Terms of use",
    termsBody:
      "This MVP is provided as-is. Blockchain transactions are irreversible. You are responsible for compliance with local laws. Fees and smart contract rules apply as deployed on-chain.",
    privacyTitle: "Privacy",
    privacyBody:
      "Authentication is wallet-native (SIWE). Public interactions run through decentralized protocols and wallet addresses are public on-chain.",
    contactTitle: "Contact",
    contactName: "Name",
    contactEmail: "Email",
    contactMessage: "Message",
    contactSend: "Send",
    contactThanks: "Thanks — we will get back to you.",
    footerAbout: "About",
    footerTerms: "Terms",
    footerPrivacy: "Privacy",
    footerContact: "Contact",
    footerPricing: "Kar Pro",
    footerPro: "Kar Pro",
    footerAdmin: "Admin",
    pricingTitle: "Kar Pro",
    pricingSubtitle: "Soulbound KarProPass credential. Marketplace fees are set in the on-chain escrow contract.",
    tierBasic: "Basic",
    tierPro: "Pro",
    tierPremium: "Premium",
    tierBasicDesc: "Standard listings and profile.",
    tierProDesc: "Pro badge, featured slot (7 days / listing), dashboard analytics.",
    tierPremiumDesc: "Everything in Pro plus premium placement priority.",
    checkoutCta: "Subscribe",
    proTitle: "Kar Pro sellers",
    proSubtitle: "Kar Pro sellers get lower fees and featured listings where configured.",
    proFeaturedCta: "Feature this listing (7 days)",
    proFeaturedHelp: "You must be the on-chain seller for the token.",
  },
  fr: {
    aboutTitle: "À propos de Kargain",
    aboutBody:
      "Kargain est une place de marché décentralisée pour l’historique et la propriété des véhicules, sur Base avec NFT KarPassport, métadonnées IPFS et annonces en séquestre.",
    termsTitle: "Conditions d’utilisation",
    termsBody:
      "Ce MVP est fourni tel quel. Les transactions blockchain sont irréversibles. Vous devez respecter la loi locale. Frais et règles du contrat déployé s’appliquent.",
    privacyTitle: "Confidentialité",
    privacyBody:
      "L’authentification est native au portefeuille (SIWE). Les interactions publiques passent par des protocoles décentralisés et les adresses de portefeuille sont publiques on-chain.",
    contactTitle: "Contact",
    contactName: "Nom",
    contactEmail: "E-mail",
    contactMessage: "Message",
    contactSend: "Envoyer",
    contactThanks: "Merci — nous vous répondrons.",
    footerAbout: "À propos",
    footerTerms: "Conditions",
    footerPrivacy: "Confidentialité",
    footerContact: "Contact",
    footerPricing: "Kar Pro",
    footerPro: "Kar Pro",
    footerAdmin: "Admin",
    pricingTitle: "Kar Pro",
    pricingSubtitle: "Credential KarProPass soulbound. Les frais du marché sont définis dans le contrat on-chain.",
    tierBasic: "Basique",
    tierPro: "Pro",
    tierPremium: "Premium",
    tierBasicDesc: "Annonces et profil standards.",
    tierProDesc: "Badge Pro, mise en avant (7 jours / annonce), analytics tableau de bord.",
    tierPremiumDesc: "Comme Pro avec priorité d’affichage premium.",
    checkoutCta: "S’abonner",
    proTitle: "Vendeurs Kar Pro",
    proSubtitle: "Les vendeurs Kar Pro bénéficient de frais réduits et d’annonces mises en avant selon configuration.",
    proFeaturedCta: "Mettre en avant cette annonce (7 jours)",
    proFeaturedHelp: "Vous devez être le vendeur on-chain du jeton.",
  },
} as const;

export type AppStrings = (typeof PAGES)[AppLocale];

export function getAppStrings(locale: AppLocale): AppStrings {
  return PAGES[locale] ?? PAGES.en;
}

export function pickAppLocale(acceptLanguage: string | null): AppLocale {
  if (!acceptLanguage) return "en";
  if (acceptLanguage.toLowerCase().startsWith("fr")) return "fr";
  return "en";
}
