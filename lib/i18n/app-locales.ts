export type AppLocale = "en" | "fr";

const PAGES = {
  en: {
    aboutTitle: "About Kargain",
    aboutBody:
      "Kargain is a decentralized marketplace for vehicle history and ownership, built on Base with on-chain KarPassport NFTs, permanent Arweave metadata, and escrowed listings.",
    termsTitle: "Terms of use",
    termsBody:
      "This MVP is provided as-is. Blockchain transactions are irreversible. You are responsible for compliance with local laws. Fees and smart contract rules apply as deployed on-chain.",
    privacyTitle: "Privacy",
    privacyBody:
      "Authentication is wallet-native (SIWE). Public interactions run through decentralized protocols and wallet addresses are public on-chain.",
    footerAbout: "About",
    footerTerms: "Terms",
    footerPrivacy: "Privacy",
  },
  fr: {
    aboutTitle: "À propos de Kargain",
    aboutBody:
      "Kargain est une place de marché décentralisée pour l’historique et la propriété des véhicules, sur Base avec NFT KarPassport, métadonnées Arweave permanentes et annonces en séquestre.",
    termsTitle: "Conditions d’utilisation",
    termsBody:
      "Ce MVP est fourni tel quel. Les transactions blockchain sont irréversibles. Vous devez respecter la loi locale. Frais et règles du contrat déployé s’appliquent.",
    privacyTitle: "Confidentialité",
    privacyBody:
      "L’authentification est native au portefeuille (SIWE). Les interactions publiques passent par des protocoles décentralisés et les adresses de portefeuille sont publiques on-chain.",
    footerAbout: "À propos",
    footerTerms: "Conditions",
    footerPrivacy: "Confidentialité",
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
