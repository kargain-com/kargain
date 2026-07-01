# Kargain — Design Specification

Canonical reference for website UI components. All new work must conform to this document. Do not invent one-off styles.

**Related public docs:** [README.md](../README.md) · [contracts/SPEC.md](./contracts/SPEC.md) · [CONTRIBUTING.md](../CONTRIBUTING.md) · [KIPs](https://github.com/kargain-com/kips)

---

## 1. Foundation Reference

**Colors, typography scale, radii, and motion constants (TypeScript):** [`lib/design-tokens.ts`](../lib/design-tokens.ts)

**Runtime CSS, Tailwind v4 theme wiring, and layout primitives:** [`app/globals.css`](../app/globals.css)

**Font loading:** [`app/layout.tsx`](../app/layout.tsx) — Geist Sans + Geist Mono (`geist/font`) and Inter (`next/font/google`, build-time subset). No runtime `@import` from Google Fonts CDN.

When implementing UI:

- Use Tailwind utilities mapped in `@theme inline` in `globals.css` (e.g. `bg-bg-primary`, `text-text-secondary`, `border-border-default`, `font-display`, `font-sans`, `font-mono`).
- Use `colors`, `typography`, `radii`, and `motion` from `design-tokens.ts` only for non-CSS contexts (charts, SVG, canvas).
- Keep `design-tokens.ts` and `:root` in `globals.css` in sync when tokens change.
- Do not copy hex values or clamp formulas into this doc; read them from the files above.

Design principles (enforced in tokens): dark-first, flat surfaces (no shadows), single warm accent used sparingly, maximum heading weight 500, sentence case in UI copy.

**Platform:** Kargain is a **multi-chain** product. Base Sepolia is the integration testnet — UI and flows should remain chain-aware (see [README.md](../README.md) § Multi-chain platform). Do not hardcode single-network assumptions in new components.

**Locales:** English-only UI (`<html lang="en">`). All user-facing copy is hardcoded English in route and component modules. The `lib/i18n/` directory was removed entirely. There is no `[locale]` route segment.

**Public assets** (`public/`):

| Path | Use |
|------|-----|
| `kargain-logo.svg` | Brand mark — favicon, `KargainLogo` CSS mask |

**App metadata:** [`app/opengraph-image.tsx`](../app/opengraph-image.tsx) (dynamic OG route, not a file under `public/`). Apple touch icon: `app/apple-icon.png` via `app/layout.tsx` metadata.

All routes use flat `bg-bg-primary` surfaces. No marketing hero bands or full-bleed photography.

---

## 2. Spacing Scale

Base unit: **4px** (`0.25rem`). Spacing variables `--space-*` are defined in `globals.css` (`--space-1` through `--space-24`).

### Section vertical padding

Apply to `<section>` wrappers. Use one tier per section; do not mix.

| Tier    | Tailwind | rem  | Use when                            |
|---------|----------|------|-------------------------------------|
| Compact | `py-16`  | 4rem | Dense bands, footers, page intros   |
| Default | `py-24`  | 6rem | Standard content sections           |
| Tight   | `pt-8 md:pt-12 pb-16` | — | Notifications and similar utility pages |

### Container

| Breakpoint | Max width                   | Horizontal padding | Tailwind pattern                                      |
|------------|-----------------------------|--------------------|-------------------------------------------------------|
| Mobile     | 100%                        | `1.5rem`           | `w-full px-6`                                         |
| Tablet     | 100%                        | `2rem`             | `w-full px-8 md:px-8`                                 |
| Desktop    | `80rem` (`--container-max`) | `1.5rem` inside cap | `mx-auto w-full max-w-7xl px-6 xl:max-w-[80rem]` |

The `.container` class exists in `globals.css`, but **current pages prefer explicit utilities**:

`mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8`

Use either pattern consistently within a file; do not mix arbitrary max-widths. Max width cap engages at **`xl` (1280px)**.

### Grid gaps

| Name    | Tailwind | rem    | Use when                                |
|---------|----------|--------|-----------------------------------------|
| Tight   | `gap-2`  | 0.5rem | Icon rows, compact meta, tag lists      |
| Default | `gap-6`  | 1.5rem | Standard card grids, form field groups  |
| Loose   | `gap-12` | 3rem   | Section splits, two-column feature rows |

### Component internal padding

| Component | Size | Padding (rem) | Tailwind      | Min height        |
|-----------|------|---------------|---------------|-------------------|
| Button    | sm   | 0.5 × 1       | `px-4 py-2`   | `min-h-11` (44px) |
| Button    | md   | 0.875 × 1.75  | `px-7 py-3.5` | `min-h-11`       |
| Button    | lg   | 1 × 2.25      | `px-9 py-4`   | `min-h-12` (48px) |
| Input     | —    | 0.75 × 1      | `px-4 py-3`   | `min-h-11`        |
| Card      | sm   | 1             | `p-4`         | —                 |
| Card      | md   | 1.5–2         | `p-6 md:p-8`  | —                 |
| Card      | lg   | 2–2.5         | `p-8 md:p-10` | —                 |

---

## 3. Typography Patterns

Allowed font weights: **400** (normal) and **500** (medium) only. Never use `font-semibold` (600) or `font-bold` (700).

| Role              | Tailwind classes | Font variable |
|-------------------|------------------|---------------|
| Page H1           | `font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary` | `--font-geist-sans` |
| Heading 2         | `font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary` | `--font-geist-sans` |
| Heading 3         | semantic `<h3>` inheriting `--text-h3` from `globals.css` | `--font-geist-sans` |
| Heading 4         | `font-sans text-base font-medium tracking-tight leading-snug text-text-primary` | `--font-inter` |
| Body large        | `font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-primary` | `--font-inter` |
| Body default      | `font-sans text-base font-normal leading-[1.6] text-text-primary` | `--font-inter` |
| Body small        | `font-sans text-fluid-sm font-normal leading-[1.5] text-text-secondary` | `--font-inter` |
| Caption / eyebrow | `font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm` (or global `.eyebrow`) | `--font-geist-mono` |
| Mono numeric      | `font-mono text-fluid-sm font-normal tabular-nums leading-[1.5] text-text-primary` | `--font-geist-mono` |
| Code inline       | `font-mono text-sm font-normal bg-bg-card text-text-primary px-1.5 py-0.5 rounded-sm border border-border-default` | `--font-geist-mono` |

Fluid size utilities (`.text-fluid-*`) resolve to `--text-*` variables in `globals.css`. Prefer them over arbitrary `text-[…]` for headings.

---

## 4. Component Patterns

### 4.1 Button

Primary action control for forms and CTAs. Use one primary button per view; secondary and ghost for lower emphasis.

**Implementation:** [`components/ui/button.tsx`](../components/ui/button.tsx) — variants `primary`, `secondary`, `ghost`, `outline`; sizes `sm`, `md`/`default`, `lg`. Prefer `<Button>` over raw `<button>` classes.

**Variants**

| Variant   | Appearance |
|-----------|------------|
| Primary   | White background, black text |
| Secondary | Transparent background, `border-border-hover`, white text |
| Ghost     | No border, white text, subtle hover fill |

**Sizes:** `sm`, `md` (default), `lg` — see §2 padding table.

**States:** Hover uses background/border/color transitions only (no transform). Focus uses `--focus-ring` from `globals.css` (2px offset, accent-warm). Disabled: `disabled:opacity-50 disabled:pointer-events-none`.

**Accessibility:** Native `<button>` or `<a>` via `asChild`. Visible focus on `:focus-visible`. Loading state exposes `aria-busy="true"` and disables the control. Icon-only buttons require `aria-label`.

---

### 4.2 Input (text)

Single-line text field with optional label and helper text.

**Implementation:** [`components/ui/input.tsx`](../components/ui/input.tsx). Global `.input` class in `globals.css` matches the same tokens.

**States:** Default → `border-border-default`. Focus → `border-accent-warm`, `bg-bg-surface`, focus ring. Error → `aria-invalid="true"`, `border-status-error`, alert helper. Disabled → `disabled:opacity-50 disabled:cursor-not-allowed`.

Error color uses `--status-error` (muted warm red). Reserve `accent-warm` strictly for focus and primary emphasis.

**Accessibility:** Every input has a `<label htmlFor>` or `aria-label`. Helper and error text linked via `aria-describedby`. Errors use `role="alert"`.

---

### 4.3 Select

Native `<select>` styled to match inputs.

**Implementation:** [`components/ui/select.tsx`](../components/ui/select.tsx) (Radix) for app forms; native `<select>` in KarPro onboarding fields.

**Accessibility:** Do not replace with a custom div-only dropdown unless full keyboard and ARIA listbox semantics are implemented. Native select is preferred for short lists.

---

### 4.4 Textarea

Multi-line text; matches `.input` styling in `globals.css`.

**Implementation:** [`components/ui/textarea.tsx`](../components/ui/textarea.tsx)

**Behavior:** `min-h-[7.5rem]` (120px), `max-h-[24rem]` (384px), `resize-y` only. On small viewports, `resize-none` is acceptable if layout breaks.

---

### 4.5 Card

Grouped content on `bg-bg-card` with hairline border. No shadow, no hover lift.

**Implementation:** [`components/ui/card.tsx`](../components/ui/card.tsx)

Interactive listing and profile cards use `<a>` or `<button>` with descriptive text; avoid card-only click targets with no accessible name.

---

### 4.6 Page intro band

Compact top-of-page header — not full-screen, not photography.

- Wrapper: `border-b border-border-default py-16`
- Optional eyebrow: `font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm mb-4`
- H1: `font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary`
- Subtitle: `font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary mt-4`

Reference: [`app/kar-pro/page.tsx`](../app/kar-pro/page.tsx), [`app/pro/[slug]/page.tsx`](../app/pro/[slug]/page.tsx), static pages `/about`, `/terms`, `/privacy`.

**Home (`/`):** No intro band — [`market-browse.tsx`](../components/marketplace/market-browse.tsx) renders the marketplace directly.

---

### 4.7 Top navbar

Implementation: [`components/shell/app-top-nav.tsx`](../components/shell/app-top-nav.tsx).

| Property | Value |
|----------|-------|
| Height | `h-14` (56px) |
| Position | `sticky top-0 z-50` |
| Border | `border-b border-border-default` — no `box-shadow` |
| Background | `bg-bg-primary` |
| Container | `mx-auto max-w-7xl xl:max-w-[80rem] px-6 md:px-8` |

**Layout (left → right):**

| Breakpoint | Left | Center / spacer | Right |
|------------|------|-----------------|-------|
| Mobile (`< md`) | Logo | flex spacer | Verifiers (icon button) · KarPro link (when eligible) · Wallet |
| Desktop (`md+`) | Logo | flex spacer | Display currency · Verifiers (secondary button) · Alerts · Messages · Become KarPro (when eligible) · Create passport · Chain selector · Wallet |

**Marketplace search:** lives in the **filter bar** on `/` ([`market-filter-bar.tsx`](../components/marketplace/market-filter-bar.tsx)), not in the top navbar.

**Logo:** [`KargainLogo`](../components/ui/kargain-logo.tsx) at 24px + wordmark "Kargain". Mobile: icon only — wordmark `hidden sm:block`.

**Messages:** Lucide `Inbox` (20px, `strokeWidth={1.5}`). Nav dot via [`MessagingNavStatus`](../components/messaging/messaging-nav-status.tsx): amber when account messaging setup is incomplete; warm accent when unread. Desktop only (`hidden md:inline-flex`); requires wallet connected.

**Alerts:** Lucide `Bell` (20px, `strokeWidth={1.5}`). Unread: dot badge via [`NotificationsUnreadBadge`](../components/notifications/notifications-unread-badge.tsx). Desktop only (`hidden md:inline-flex`); link always visible, badge when wallet connected.

**Become KarPro:** [`useShowBecomeKarPro`](../hooks/use-show-become-karpro.ts) — shown when wallet connected and not an active verifier. Mobile top nav: compact **KarPro** label; desktop: **Become KarPro**.

**"Create passport":** Secondary border style — `border border-border-hover bg-transparent`. Desktop only (`hidden md:inline-flex`); mobile uses bottom-nav center FAB.

**Verifiers:** Link to `/verifiers`. Secondary bordered button in the **right action cluster** (first before Alerts): `ShieldCheck` + **Verifiers** label on desktop (`md+`); compact bordered icon on mobile. Active on `/verifiers`: `border-accent-warm`, `text-accent-warm`, `bg-bg-surface`. Hover: accent border and text.

**Chain selector:** [`ChainSelector`](../components/shell/chain-selector.tsx) — Radix dropdown, full network name. Wrong-chain: red status dot. Desktop only (`hidden md:flex`).

**Display currency:** [`CurrencySelector`](../components/shell/currency-selector.tsx) — first control in the right cluster (before Verifiers). Desktop: Radix dropdown; mobile: bottom sheet. Trigger shows active ISO code only (e.g. `USD`). Menu rows: fixed-width monospace symbol slot (`w-6` / `--space-6`, `font-mono`, `text-text-secondary`) + ISO code (`gap-2` / `--space-2`) so codes align vertically; AED uses an empty symbol slot (code shown once). ETH uses `Ξ` + `ETH`; BTC uses `₿` + `BTC`. KRW `₩`, RUB `₽`, JPY `¥` (CNY also `¥` — ISO code column disambiguates). Dropdown `min-w-[168px]` for 13 rows. Inline price displays ([`listing-display-price.tsx`](../components/marketplace/listing-display-price.tsx)) keep symbol+amount on one line — selector layout only.

**Wallet:** [`WalletLoginButton`](../components/wallet-login-button.tsx) — identicon + ENS or short address + ChevronDown. Radix dropdown: View on Basescan, Copy address, Disconnect. Disconnected: opens connect dialog with **WalletConnect** (when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set) and **Browser wallet** (injected extension or wallet in-app browser only). Mobile Safari/Chrome without an injected provider: hint to use WalletConnect or open the site in MetaMask/Coinbase Wallet; empty state when no connector is available. Dialog closes on successful connect only (`onSuccess`).

**No duplication:** Actions available in mobile bottom nav (Messages, Create, Alerts, Profile) must not repeat in the top bar below `md`.

---

### 4.8 Mobile bottom navigation

Implementation: [`components/shell/mobile-bottom-nav.tsx`](../components/shell/mobile-bottom-nav.tsx). Visible `md:hidden` only.

**Tab order:** Marketplace · Messages · **FAB** · Alerts · Profile

| Slot | Icon | Target | Notes |
|------|------|--------|-------|
| Marketplace | `Car` | `/` | Not Home icon |
| Messages | `Inbox` | `/messages` | Always visible; dot badge when wallet connected and unread |
| FAB (center) | `Plus` | `/passport/new` | `h-12 w-12 rounded-full bg-bg-card border border-border-hover`, accent plus, `ring-2 ring-bg-primary`, `-mt-3`; icon-only |
| Alerts | `Bell` | `/notifications` | Unread dot via [`NotificationsUnreadBadge`](../components/notifications/notifications-unread-badge.tsx); default tab = Alerts inbox |
| Profile | avatar or `User` | `/profile/{address}` or `/profile/edit` | [`IdentityAvatar`](../components/identity/identity-avatar.tsx) when connected (Nostr → ENS → identicon); "Connect" when disconnected |

Bar: `fixed bottom-0`, `border-t border-border-default`, `h-16`, safe-area inset padding, `grid-cols-5`.

**Become KarPro:** visible in the top nav when the wallet is connected and not an active verifier (`KarPro` label on mobile, `Become KarPro` on desktop).

---

### 4.9 Logo

**Asset:** [`public/kargain-logo.svg`](../public/kargain-logo.svg) — designer SVG.

| Property | Value |
|----------|-------|
| Paths | 6, `fill="currentColor"` |
| viewBox | `0 0 1800 1800` |
| transform | `translate(0,1800) scale(0.1,-0.1)` — **do not change** |

**Component:** [`KargainLogo`](../components/ui/kargain-logo.tsx) — CSS `mask-image` over the SVG, `text-text-primary` / `currentColor` for tinting. Do not use `next/image` for the navbar logo.

**Favicon:** `app/layout.tsx` metadata — `icons.icon` → `/kargain-logo.svg` (`type: image/svg+xml`). Apple touch: `app/apple-icon.png`.

---

### 4.10 Marketplace browse

Implementation: [`market-browse.tsx`](../components/marketplace/market-browse.tsx) + filter components below.

**Filter bar (desktop + mobile trigger):** [`market-filter-bar.tsx`](../components/marketplace/market-filter-bar.tsx)

- Sticky below top nav on `/`
- **Search** input (full-width on mobile, inline on desktop)
- Quick filters: status, price range, make, fuel type (Radix dropdowns)
- **Filters** button opens drawer on all breakpoints
- Sort: [`market-sort-select.tsx`](../components/marketplace/market-sort-select.tsx)
- Active selections: [`market-filter-chips.tsx`](../components/marketplace/market-filter-chips.tsx)

**Filter drawer:** [`market-filter-drawer.tsx`](../components/marketplace/market-filter-drawer.tsx) — sheet with 13 sections (status, price, make/model, fuel, year, mileage, body, condition, vehicle type, location, colour, etc.). Checkboxes use [`checkbox.tsx`](../components/ui/checkbox.tsx). Price slider label: **"Price range"**.

**Searchable filters:** [`filter-combobox.tsx`](../components/marketplace/filter-combobox.tsx) — make/model in filter bar and drawer.

**State:** URL-synced via [`use-market-filters.ts`](../hooks/use-market-filters.ts). Facets from `GET /listings/facets` (Ponder).

**Display currency:** Global preference via [`currency-selector.tsx`](../components/shell/currency-selector.tsx) in top nav; stored in `localStorage` (`kargain_display_currency`). Options: **USD, EUR, CNY, INR, BRL, IDR, AUD, AED, KRW, RUB, JPY, ETH, BTC** (13) — canonical list in [`currency-code.ts`](../lib/marketplace/currency-code.ts) (`DISPLAY_CURRENCIES`). [`display-currency-context.tsx`](../lib/marketplace/display-currency-context.tsx) + [`use-market-rates.ts`](../lib/marketplace/use-market-rates.ts) (Chainlink primary for ETH/EUR; CoinGecko `simple/price` for ETH/EUR gap-fill + `exchange_rates` for CNY/INR/BRL/IDR/AUD/AED/KRW/RUB/JPY + `btcUsd` from `exchange_rates.usd`; rate registry in [`fx-rate-registry.ts`](../lib/marketplace/fx-rate-registry.ts)) drive [`convertPrice()`](../lib/marketplace/display-currency-context.tsx) on listing cards via [`listing-display-price.tsx`](../components/marketplace/listing-display-price.tsx). Feeds always read on `DEFAULT_CHAIN_ID` (84532), not wallet chain. Browse shows **all** active listings regardless of listing fiat currency (no currency filter chip). **84532 listing creation remains USD-only** — this selector only changes how a *viewer* sees prices ([`listingCurrencyCodesForChain`](../lib/marketplace/currency-code.ts) unchanged).

**FX display rules:** Same-currency always renders. Cross-currency and crypto (ETH/BTC) display show `—` when required rates are null. ETH display for **USD listings** needs only `ethUsd`; EUR listings in ETH need `ethUsd` + `eurUsd`. BTC display needs `btcUsd`. CoinGecko fills gaps after Chainlink settles — does **not** affect on-chain buy quotes.

**Price filter + sort (FX):** User-entered min/max use the active display currency at apply time; `priceCurrency` is persisted in the URL when bounds are set (e.g. `?priceMin=4&priceCurrency=ETH`). Live rates (`eurUsdRate`, `ethUsdRate`, `btcUsdRate`, `cnyUsdRate`, `inrUsdRate`, `brlUsdRate`, `idrUsdRate`, `audUsdRate`, `aedUsdRate`, `krwUsdRate`, `rubUsdRate`, `jpyUsdRate`) from merged Chainlink/CoinGecko are sent per-request to Ponder — not stored in URL. Shared normalization in [`price-normalize.ts`](../lib/marketplace/price-normalize.ts); filter/sort logic in [`listing-query.ts`](../lib/marketplace/listing-query.ts). Non-USD price apply and price-asc/desc sort are gated until required rates load (`isRatesLoading` or null rates). **USD-only** browse price filter works without external rates. Card `convertPrice()` works without indexer deploy; browse filters need frontend + Ponder with rate param parsing ([`src/api/index.ts`](../src/api/index.ts)) — see [indexer/README.md](./indexer/README.md#get-listings--fx-query-parameters).

**Price chip labels:** Active filter chips use URL `priceCurrency`, not the live display preference — so bookmarked filters keep semantic meaning if display currency changes.

**Removed:** `market-filters.tsx` sidebar, `marketplace-filter-controls.tsx` — do not reintroduce duplicate filter UIs.

**Known issue:** Desktop filter row uses `overflow-hidden`; controls may clip around ~768px — prefer wrap or horizontal scroll if extending.

**Error state** ([`market-browse.tsx`](../components/marketplace/market-browse.tsx)): when Ponder is unreachable —

- `AlertTriangle` icon in bordered square
- Title: "Marketplace unavailable"
- Hint: `pnpm ponder:dev` in `<code>` — **never** expose env variable names (`PONDER_SQL_API_URL`, etc.) in UI copy

**Homepage stats (`/`):** [`MarketplaceStatsLine`](../components/marketplace/marketplace-stats-line.tsx) in [`app/page.tsx`](../app/page.tsx) inside `Suspense` (sibling to [`market-browse.tsx`](../components/marketplace/market-browse.tsx)). Stats fetch does not block filter bar or listing grid shell. Compact ambient line above [`market-filter-bar.tsx`](../components/marketplace/market-filter-bar.tsx): `font-mono text-xs text-text-tertiary tabular-nums` (e.g. `42 listings · 12 verified · 5 active verifiers`). Hidden when all stats are 0.

**Verifiers page (`/verifiers`):** No intro band. [`VerifiersIntentBanner`](../components/verifier/verifiers-intent-banner.tsx) in top container (renders immediately). [`VerifierDirectory`](../components/verifier/verifier-directory.tsx) in `#verifier-grid` inside `Suspense` with skeleton grid fallback. Each card shows verification count, member since, **verification fee** (`formatVerificationFee` — `0` → *Contact for quote*), **View showroom →**, **Request verification**, and **Pay for inspection** when fee &gt; 0 (see §4.17).

**Listing card:** [`listing-card.tsx`](../components/marketplace/listing-card.tsx) — price via shared [`listing-display-price.tsx`](../components/marketplace/listing-display-price.tsx) + `convertPrice()` (display currency from nav). Cover from Ponder `coverPhotoUri` (first metadata `photos[]` entry, indexed at replay). **No** opaque overlay on the image area. VERIFIED listings use permanent `border-accent-warm` on the card (not hover-only). UNVERIFIED / DISPUTED use `border-border-default`; hover → `border-border-hover` (never accent on hover). VERIFIED + non-empty `row.verifier` shows ShieldCheck attribution linking to `/profile/{address}`. Placeholder: centered "No image" when `imageUrl` is null.

**Photo upload (mint + edit):** [`photo-upload-zone.tsx`](../components/passport/photo-upload-zone.tsx) (create) and [`edit-passport-wizard.tsx`](../components/passport/edit-passport-wizard.tsx) (new photos only). Incoming images (including HEIC via `heic2any`) are always re-encoded to **WebP ≤ 100 KB** in the browser via [`compress-passport-image.ts`](../lib/passport/compress-passport-image.ts) and [`passport-image-encode-plan.ts`](../lib/passport/passport-image-encode-plan.ts) — quality and max-edge ladder until the byte budget is met; no skip path and no fallback to the original file. Failures surface as [`PassportImageOptimizeError`](../lib/passport/passport-image-optimize-error.ts) with user-facing copy from [`passport-flow-messages.ts`](../lib/passport/passport-flow-messages.ts). [`passport-upload-preflight-banner.tsx`](../components/passport/passport-upload-preflight-banner.tsx) warns smart contract wallets when multiple photos may fail the Irys storage deposit.

**Irys upload progress (create + edit):** [`passport-upload-progress.tsx`](../components/passport/passport-upload-progress.tsx) — batch photo status, storage fee hint, progress bar. Shown during `phase === "uploading"`. Upload errors from Irys at deposit/upload time use `formatPassportUploadError` (same path as evidence uploads on passport detail). User-facing phase copy for edit lives in [`passport-flow-messages.ts`](../lib/passport/passport-flow-messages.ts).

**Passport edit save flow (`/passport/{tokenId}/edit`):** [`edit-passport-wizard.tsx`](../components/passport/edit-passport-wizard.tsx) stays on the edit page through upload → on-chain save → receipt confirmation. After confirmation, form and photo grid hydrate from the saved metadata (new photos become existing URIs). [`passport-edit-success-banner.tsx`](../components/passport/passport-edit-success-banner.tsx) shows success without redirect; optional link to marketplace detail. While Ponder lags behind on-chain `tokenURI`, [`passport-indexer-sync-banner.tsx`](../components/passport/passport-indexer-sync-banner.tsx) (`variant="edit"`) explains delayed marketplace/profile views. Passport detail and `getPassportDetail` prefer on-chain `tokenURI` over stale Ponder `tokenUri` when they differ ([`fetch-passport-detail.ts`](../lib/passport/fetch-passport-detail.ts) + [`passport-uri-drift.ts`](../lib/passport/passport-uri-drift.ts)).

**Passport token ID display:** v2 on-chain IDs encode `chainId << 128 | localSequence` ([SPEC](./contracts/SPEC.md)). UI shows human labels via [`passport-token-id.ts`](../lib/passport/passport-token-id.ts) + [`passport-id-label.tsx`](../components/passport/passport-id-label.tsx) — e.g. `Passport #0 · Base Sepolia`. Full decimal ID stays in URLs, APIs, and `title` tooltip on hover.

---

### 4.11 Profile

Implementation: [`components/identity/identity-header.tsx`](../components/identity/identity-header.tsx), [`components/identity/identity-avatar.tsx`](../components/identity/identity-avatar.tsx), [`components/profile/profile-page.tsx`](../components/profile/profile-page.tsx), [`components/profile/profile-action-banner.tsx`](../components/profile/profile-action-banner.tsx), [`components/profile/karpro-status-widget.tsx`](../components/profile/karpro-status-widget.tsx).

| Rule | Value |
|------|-------|
| Shape | **Always round** (`rounded-full`) for all users — private and KarPro |
| Container | `h-24 w-24` (96px), `border border-border-default`, `overflow-hidden` |
| Layout | Horizontal identity row: `flex-col gap-6 sm:flex-row sm:items-start`; compact owner/guest actions top-right of name row (`min-h-9 h-9 px-3 py-1.5 text-xs`) |
| Address row | `navShortAddress` + copy button in a `group` (`gap-1.5`); KarPro pill inline on same row when active verifier — parent `flex flex-wrap items-center gap-x-3 gap-y-1` |
| Copy visibility | Always visible on mobile; `sm:opacity-0 sm:group-hover:opacity-100` on desktop |
| Guest actions | "Message" and **Request verification** only when visitor wallet is connected; disconnected guests see no header actions |
| Personal copy | Nostr **about** and **website** render in `ProfileBio` on `profile-page.tsx` only — aligned with text column via `sm:pl-[8.5rem]`; not inside `IdentityHeader` |
| Source priority | Nostr kind 0 `picture` → ENS avatar → address identicon via `IdentityAvatar` |
| Nostr load | `/profile/[handle]` — kind 0 via [`use-nostr-profile.ts`](../hooks/use-nostr-profile.ts) on client (no blocking server relay fetch) |
| Nostr identity | Wallet-bound via canonical sign message `kargain-nostr-v1:{address}` (no domain); local blob v2 encrypts sk with signature-derived AES — see [`key-manager-crypto.ts`](../lib/nostr/key-manager-crypto.ts) |
| KarPro stats | Compact mono line on `profile-page.tsx` (active verifier or non-zero VERIFIED count): **verificationCount** = passports with `status=VERIFIED` assigned to this verifier · active since · **verification fee** (all visitors) · `0.05 ETH` staked (owner only). Refreshes client-side via [`ProfileVerifierStatsBand`](../components/profile/profile-verifier-stats-band.tsx). |
| Action banner | `ProfileActionBanner` — five contextual cases (visitor+KarPro send request, owner become KarPro, owner open disputes, etc.) |
| KarPro widget | `KarProStatusWidget` — owner + active verifier only; link to `/kar-pro` |
| Tabs | Counts in tab labels; **Verified** and **Attestations** when subject is active verifier or has verifier history in Ponder (visible to all visitors); **Disputes** owner + active verifier only |
| Dispute cards | Vehicle make/model/year, reason, relative time, disputer, Resolve link to marketplace detail |

**Pro showroom (`/pro/[slug]`):** Hero stats grid (passports verified · active listings · attestations) uses the same Ponder `verificationCount` (VERIFIED only) and `attestationTotal`; visible on all breakpoints (`grid-cols-3`). **Verification fee** line below the stats grid. Hero CTAs: contact verifier, **Pay for inspection** when fee &gt; 0 (§4.17). Showroom content renders when the verifier is active on-chain, active in Ponder, or has at least one VERIFIED passport.

Do not vary avatar shape by role. **IdentityAvatar** / **EnsAvatar:** round only; used in profile header, verifier directory, pro showroom, mobile bottom nav, and XMTP inbox rows.

---

### 4.12 Messages

Implementation: [`message-inbox-client.tsx`](../components/messaging/message-inbox-client.tsx), [`conversation-thread-client.tsx`](../components/messaging/conversation-thread-client.tsx), [`use-messaging-status.ts`](../hooks/use-messaging-status.ts), [`use-xmtp-client.ts`](../hooks/use-xmtp-client.ts), [`messaging-setup-card.tsx`](../components/messaging/messaging-setup-card.tsx).

**Account model:** Wallet connect = account created. **Enable messages** (one wallet signature) = XMTP inbox registered and DMs available. Until enabled, `needsSetup` surfaces show [`MessagingSetupCard`](../components/messaging/messaging-setup-card.tsx) instead of empty inbox or SDK errors.

| Element | Rule |
|---------|------|
| Layout | `max-w-lg`, full viewport height minus nav |
| Account setup | Owner profile: [`AccountSetupBanner`](../components/profile/account-setup-banner.tsx) when `needsSetup`; links to `/profile/edit#messages` |
| Profile settings | [`MessagingSettingsSection`](../components/profile/messaging-settings-section.tsx) on `/profile/edit` — enable/disable + **Allow incoming messages** toggle (`messagesEnabled` in Nostr kind 0) |
| Seller warning | [`SellerMessagingBanner`](../components/marketplace/seller-messaging-banner.tsx) on own active listing detail + manage listing — banner only (listing not blocked) |
| KarPro | Post-join [`MessagingSetupCard`](../components/messaging/messaging-setup-card.tsx) with `context="karpro"` until ready |
| `?to=` pre-fill | `/messages?to={address}` opens DM after self messaging is ready; uses [`contactPeer`](../lib/xmtp/contact-peer.ts); URL param stripped on mount |
| Listing inquiry DM | [`SellerContactButton`](../components/marketplace/seller-contact-button.tsx) with `listingTokenId` — on **new** threads only (`lastMessage()` empty), silently sends *Hi, I'm interested in your listing for {formatPassportTitle}.* before navigating to `/messages/{id}`; existing threads unchanged |
| Profile entry | Identity header **Message** / **Request verification** only when peer is reachable (`Client.canMessage` + Nostr `messagesEnabled`); else *Messages not available* |
| Peer reachability | [`usePeerMessagingReachability`](../hooks/use-peer-messaging-reachability.ts) + [`can-message-peer.ts`](../lib/xmtp/can-message-peer.ts) before DM actions |
| XMTP init | Explicit **Enable messages** only — no surprise sign on bare connect; opted-in addresses auto-reconnect; smart wallets show blocker copy |
| Nav status | [`MessagingNavStatus`](../components/messaging/messaging-nav-status.tsx) — amber setup dot or unread warm dot |
| Thread header | Peer avatar + display name + KarPro badge + link to `/profile/{address}` |
| Own bubble | `bg-white text-bg-primary` |
| Peer bubble | `bg-bg-surface text-text-primary` |
| Timestamps | Below bubble, `text-xs text-text-tertiary`, aligned with sender side |
| Composer | `Input` + icon `Button`; Enter sends |
| Empty inbox | "No conversations yet." (only when messaging is active) |
| User errors | Not registered: *This user has not enabled messages yet.* · Opted out: *This user is not accepting messages.* |

No per-message sender label in the bubble list.

Address classification: [`wallet-account.ts`](../lib/web3/wallet-account.ts). Protocol contracts and bytecode `contract` accounts are not profile or messaging peers. Deployer / `upgradeAuthority` EOAs are never in the static denylist — see [contracts/SPEC.md Part II.4.1](./contracts/SPEC.md#ii41-governance-roles-deployer-vs-timelock-vs-upgrade-authority) (v1.x) and Part I.9.1 (v2 timelock).

---

### 4.13 Notifications

Implementation: [`notifications-shell.tsx`](../components/notifications/notifications-shell.tsx), [`notifications-client.tsx`](../components/notifications/notifications-client.tsx).

| Element | Rule |
|---------|------|
| Page padding | `pt-8 md:pt-12 pb-16` (not `py-24`) |
| Heading | Compact `text-fluid-h2` above tabs |
| Tabs | Alerts (default) · Watchlist (`?tab=watchlist`) |
| Mark read | Per-row on interaction; **Mark all read** when `unreadCount > 0` — no auto mark-read on page open |

Watchlist embeds [`WatchlistClient`](../components/watchlist/watchlist-client.tsx).

---

### 4.14 Passport detail

Implementation: [`passport-detail-view.tsx`](../components/passport/passport-detail-view.tsx), [`passport-custody.ts`](../lib/marketplace/passport-custody.ts).

- Page shell: `py-24`, `max-w-7xl`
- **Listed in escrow:** title block shows **Seller** → `/profile/{seller}` and **Held in escrow** → block explorer (not profile)
- **Normal ownership:** **On-chain owner** → `/profile/{owner}`
- **Disputed:** full-width `DisputeStatusSection` at top (before gallery and title) — reason, disputer, withdrawn state, role-specific "what happens next"; links scroll to `#passport-actions`
- `PassportActionsPanel` wrapped with `id="passport-actions"` and `scroll-mt-24` for dispute anchor
- **Owner actions** (`PassportActionsPanel`): wallet role from on-chain `ownerOf` via [`passport-owner.ts`](../lib/passport/passport-owner.ts) + [`use-passport-on-chain-owner.ts`](../hooks/use-passport-on-chain-owner.ts); Ponder `passport.owner` is SSR fallback only
- **Passport holder** (human owner: NFT `ownerOf` when unlisted, listing `seller` when in escrow) sees **Edit metadata**, **Add record +** (when not listed and not DISPUTED); **Report discrepancy** hidden for holder
- While listed in escrow: holder sees *Service records can be added after delisting.* — `appendRecord` requires NFT custody
- Trust banner, URI history (collapsed default), Nostr comments
- Mobile: identity block before gallery when not disputed; disputed layout leads with dispute section then gallery

---

### 4.15 Site footer

Implementation: [`components/shell/site-footer.tsx`](../components/shell/site-footer.tsx).

| Property | Value |
|----------|-------|
| Layout | Compact one-liner: `py-6`, `border-t border-border-default` |
| Copyright | `© {year} Kargain · MIT License` (mono `text-xs text-text-tertiary`) |
| Links | About · Terms · Privacy · GitHub ↗ (`text-sm text-text-secondary`) |
| Omitted | Verifiers (in top nav); no "Built on Base" tagline (multichain product) |
| Mobile | `pb-20` on footer to clear bottom nav; `md:pb-0` on desktop |

---

### 4.16 Marketplace listing detail

Implementation: [`listing-detail-client-island.tsx`](../components/marketplace/listing-detail-client-island.tsx) + [`listing-buy-panel.tsx`](../components/marketplace/listing-buy-panel.tsx). On-chain listing rows decoded via [`parse-on-chain-listing.ts`](../lib/marketplace/parse-on-chain-listing.ts) (MarketplaceEscrow v2 struct; `active` at tuple index 2).

Sentence case in UI copy. No `font-bold` / `font-semibold` on disclosure labels.

#### Checkout and buy (all buyers)

| Rule | Value |
|------|-------|
| Asking price | List denomination in ISO fiat (`currencyCode` on-chain); label **Asking price** on detail — not checkout currency |
| Kargain checkout | Buyer pays **ETH or USDC** only; copy: *Checkout on Kargain is in ETH or USDC.* |
| Direct payment | Optional seller `settlementNotes` (bank, BTC, etc.); buy panel **Direct payment** card when note set — *Not verified by Kargain* |
| Buy panel | Hero via [`listing-display-price.tsx`](../components/marketplace/listing-display-price.tsx) + `convertPrice()`; ETH / USDC toggle |
| Disclosure | Bordered panel: seller receives (asking fiat), you pay, rate at settlement — method-specific rows |
| USDC buy | ERC-20 `approve` then `buyWithToken(tokenId, usdc)`; disabled when USDC not configured on chain |
| Buy errors | Inline `text-status-error` message under the buy button (`role="alert"`) on `approve` / `buyWithNative` / `buyWithToken` failure, via shared [`tx-error-message.ts`](../lib/marketplace/tx-error-message.ts); preflight balance check (ETH and USDC) disables the button with a `text-text-secondary` hint before a doomed transaction is sent; `useSimulateContract` gates the final purchase call so most reverts surface before the wallet signature prompt |
| Guest / buyer | `ListingBuyPanel` + `SellerContactButton` (XMTP) |
| Message seller | `SellerContactButton` — peer reachability check; enables buyer messaging first if needed; passes `listingTokenId` on active listings so new DMs open with listing context (§4.12). On consignment listings the contact peer is the passport owner (on-chain `seller`), not the agent |

#### Direct payment and external settlement

When the seller has set `settlementNotes`, buyers can register interest off-chain; the seller (or consignment agent) attests receipt on-chain via `confirmExternalPayment`. Contract trust model: [SPEC Part I §5.4](./contracts/SPEC.md#54-payment-flows).

| Rule | Value |
|------|-------|
| Buyer offer | [`listing-make-offer-button.tsx`](../components/marketplace/listing-make-offer-button.tsx) — **Make an offer** / **Withdraw offer** when listing active and direct-payment note set; Nostr kind **30405** via [`listing-offers.ts`](../lib/nostr/listing-offers.ts) (`#d` `kargain:offer:{tokenId}`, `#i` passport + buyer `ethereum:` tag, `#p` seller pubkey); requires seller NIP-39–linked Nostr identity — else *Seller has not linked a Nostr identity. Offers are unavailable.* |
| Seller offers panel | [`listing-offers-panel.tsx`](../components/marketplace/listing-offers-panel.tsx) — visible to listing seller **or** consignment agent when direct payment note set; lists relay offers with profile links; **Confirm payment** → inline *Confirm received payment from {address}?* → `confirmExternalPayment(tokenId, buyer)`; trust copy: *Confirming transfers the NFT immediately. Only confirm after you have received payment.* |
| Post-confirm | Delisted listing shows read-only *Payment confirmed externally* (with chain timestamp when indexed); Ponder field `externalPaymentConfirmedAt` on listing detail |
| Offer gating | Hidden for seller and agent viewers; buyer offer button only when `hasDirectPayment` |

#### Agent consignment — buyers

When `agent` is set on an active listing, buyers see who is selling on their behalf. Internal deal terms (`agentFeeBps`, `ownerMinPrice1e8`) are never shown.

| Rule | Value |
|------|-------|
| Browse cards | [`listing-card.tsx`](../components/marketplace/listing-card.tsx) — compact **Sold by** row (`UserRound` icon, `shortAddress`, link to `/profile/[agent]`). No per-card profile fetch |
| Listing detail | [`listing-agent-buyer-attribution.tsx`](../components/marketplace/listing-agent-buyer-attribution.tsx) below buy panel — avatar + KarPro name via `usePeerIdentity` / `fetchKarProVerifierProfile`; copy *Sold by [name] on behalf of the owner*; link to `/pro/[slug]` when slug exists else `/profile/[address]` |
| Degradation | When profile missing: *Sold by an agent* with link to `/profile/[agent]` — no error state |
| Buy flow | Unchanged — `buyWithNative` / `buyWithToken` work the same for direct and consignment listings |

#### Agent consignment — owners

| Rule | Value |
|------|-------|
| Delegate to a pro | **Delegate to a pro** opens [`authorize-agent-dialog.tsx`](../components/marketplace/authorize-agent-dialog.tsx) when owner, listing inactive, no active on-chain authorization; KarPro picker via [`verifier-directory.tsx`](../components/verifier/verifier-directory.tsx) `onSelectAgent` mode |
| Owner minimum price | No currency selector on authorize form — `ownerMinPrice1e8` is a raw on-chain scalar until the agent lists (`listOnBehalf` picks currency); label uses [`listingCurrencyCodesForChain`](../lib/marketplace/currency-code.ts); confirmation copy: guaranteed minimum *in the currency the agent chooses* |
| Agent authorization | [`agent-authorization-status.tsx`](../components/marketplace/agent-authorization-status.tsx) reads `agentAuthorizations(tokenId)` on-chain (not Ponder); shows agent identity, minimum, expiry; **Lower minimum** / **Revoke agent** owner actions |
| Revoke agent gate | **Revoke agent** disabled while listing active; copy: *Return the vehicle from the agent before revoking access* |
| Owner return flow | When owner + active consignment (`agent` non-zero): [`owner-return-request-panel.tsx`](../components/marketplace/owner-return-request-panel.tsx) — **Request return** (`requestReturn`) → 7-day [`return-cooldown-display.tsx`](../components/marketplace/return-cooldown-display.tsx) (live countdown) → **Force return** (`forceReturn`) when elapsed; request button hidden (not disabled) during cooldown; force button disabled until countdown ends; chain `agentAuthorizations` gates force submit; `returnRequestedAt` from Ponder + chain read |

#### Agent consignment — KarPro agents

| Rule | Value |
|------|-------|
| Agent dashboard | **Consigned vehicles** tab on `/profile/[handle]` when owner + active KarPro ([`consigned-vehicles-tab.tsx`](../components/profile/consigned-vehicles-tab.tsx)); awaiting section via Ponder `GET /agents/:address/authorizations?hasActiveListing=false` (paginated) + `/passports/batch` enrichment; chain `agentAuthorizations` filters stale rows; **List vehicle** expand → [`agent-list-on-behalf-panel.tsx`](../components/marketplace/agent-list-on-behalf-panel.tsx) with live [`seller-net-calculator.tsx`](../components/marketplace/seller-net-calculator.tsx) (submit blocked when owner minimum not met; `platformFeeBps` chain-read). Active section: **Edit listing** / **Return to owner** ([`agent-update-listing-panel.tsx`](../components/marketplace/agent-update-listing-panel.tsx), [`agent-delist-button.tsx`](../components/marketplace/agent-delist-button.tsx)); read-only [`return-cooldown-display.tsx`](../components/marketplace/return-cooldown-display.tsx) when owner requested return. Past section read-only |
| Agent settlement note | [`agent-update-listing-panel.tsx`](../components/marketplace/agent-update-listing-panel.tsx) — read-only **Direct payment instructions** (chain `settlementNotes`); copy notes owner edits on manage listing; agents set note only at `listOnBehalf` |
| Agent confirm payment | Same [`listing-offers-panel.tsx`](../components/marketplace/listing-offers-panel.tsx) as seller on active consignment listings with direct payment |
| Pro showroom | **Active consignments** on [`/pro/[slug]`](../app/pro/[slug]/page.tsx) with **View all N consignments →** to `?tab=consigned` when truncated at 100 |

#### Seller listing management

| Rule | Value |
|------|-------|
| Seller list UI | [`listing-seller-settlement-panel.tsx`](../components/marketplace/listing-seller-settlement-panel.tsx) + [`listing-edit-client.tsx`](../components/marketplace/listing-edit-client.tsx); `encodeCurrencyCode` for `list()` |
| Owner list | **List for sale** → `/marketplace/{tokenId}/edit` when viewer holds NFT (`ownerOf`) and listing inactive |
| Seller manage | **Manage listing** → same edit URL when viewer is listing seller (active listing) |
| Seller delist | Handled on the edit page ([`listing-edit-client.tsx`](../components/marketplace/listing-edit-client.tsx)), not inline on listing detail; same `txErrorMessage` error pattern |

---

### 4.17 Verification fee

KarProStaking `verificationFee` is informational on-chain — Kargain does not escrow or enforce payment. Contract reference: [SPEC §I.4](./contracts/SPEC.md). Helpers: [`verification-fee.ts`](../lib/verifier/verification-fee.ts) (`formatVerificationFee`, `verificationFeeInUsdc`).

#### Display (owners and visitors)

| Surface | Rule |
|---------|------|
| Verifier directory card | Mono `text-xs text-text-secondary` fee line under count / member since; always shown (`0` → *Contact for quote*) |
| Request verification | [`verification-request-button.tsx`](../components/verifier/verification-request-button.tsx) — muted fee under button when fee &gt; 0 only |
| Profile stats band | [`profile-verifier-stats-band.tsx`](../components/profile/profile-verifier-stats-band.tsx) — **Verification fee** segment for all visitors |
| Pro showroom hero | Fee line below stats grid; [`VerificationPayButton`](../components/verifier/verification-payment-modal.tsx) when fee &gt; 0 |

#### Verifier management (`/kar-pro`)

| Rule | Value |
|------|-------|
| Set fee | [`kar-pro-credential-card.tsx`](../components/kar-pro/kar-pro-credential-card.tsx) — ETH decimal input, `setVerificationFee` on-chain; empty / `0` clears to *Contact for quote* |
| Widget | [`KarProStatusWidget`](../components/profile/karpro-status-widget.tsx) remains read-only link to `/kar-pro` — writes live on credential card |

#### Pay for inspection (passport owners)

| Rule | Value |
|------|-------|
| Entry points | **Pay for inspection** on `/verifiers` cards and `/pro/[slug]` hero when `verificationFee &gt; 0` |
| Modal | [`verification-payment-modal.tsx`](../components/verifier/verification-payment-modal.tsx) — [`Dialog`](../components/ui/dialog.tsx) shell |
| Passport step | UNVERIFIED passports from `getProfileData` → dropdown (`formatPassportTitle` + make/model); else manual passport ID input |
| ETH | Native transfer to verifier; `data` = `stringToHex("kargain:verify:{tokenId}")` (human-readable memo on explorers) |
| USDC | ERC-20 `transfer` to verifier; amount from `verificationFeeInUsdc` + live `ethUsd` from [`use-market-rates.ts`](../lib/marketplace/use-market-rates.ts); UI shows passport ID only — honest copy that USDC has no on-chain memo |
| Toggle | Same segmented **Pay with ETH / Pay with USDC** pattern as [`listing-buy-panel.tsx`](../components/marketplace/listing-buy-panel.tsx) |
| Trust copy | Modal disclaimer: payment goes directly to verifier; Kargain does not hold funds; verification is separate on-chain step |
| Success | Confirmation in modal; no navigation away |
| Hidden | No pay button when fee is `0`, when viewer is the verifier, or on agent-picker card layout |

---

## 5. Motion

Reference easing and durations in `globals.css` (`--ease-out-smooth`, `--duration-*`) and `motion` in `design-tokens.ts`.

| Token        | Value |
|--------------|-------|
| Default ease | `cubic-bezier(0.33, 1, 0.68, 1)` — `--ease-out-smooth` |
| Fast         | `150ms` — micro-interactions (chevrons, toggles) |
| Default      | `250ms` — hovers, borders, color |
| Slow         | `400ms` — panels, section reveals |

**CSS transitions:** Use for hover, focus, border, background, and opacity. Apply `transition-colors duration-200` (or `transition-smooth` utility) on interactive elements. Respect `prefers-reduced-motion: reduce`.

**Framer Motion:** Use [`FadeUp`](../components/ui/fade-up.tsx) for scroll entrance; `useInView` for infinite scroll (marketplace). Do not use Framer for simple hover color changes.

**Staggered list:** acceptable for card grids when `useReducedMotion()` is respected.

**Do not animate:** Focus rings, outline offsets, `aria-*` state changes, form validation borders (instant), or elements required for WCAG visibility. Under `prefers-reduced-motion`, set Framer `initial={false}` or `transition={{ duration: 0 }}`.

---

## 6. Responsive Breakpoints

Tailwind defaults. Documented usage for this project:

| Breakpoint | Min width | Usage |
|------------|-----------|--------|
| (default)  | 0         | Single-column layouts; mobile bottom nav + compact top bar (§4.7–4.8) |
| `sm`       | 640px     | Logo wordmark visible (`sm:block`); card grids `sm:grid-cols-2` |
| `md`       | 768px     | Desktop top nav controls; mobile bottom nav hidden (`md:hidden`) |
| `lg`       | 1024px    | Wider nav link gaps; 3-column card grids |
| `xl`       | 1280px    | `max-w-[80rem]` container centers; generous horizontal rhythm |

Mobile-first: base styles target small screens; add breakpoint prefixes to enhance.

**Note:** Bottom nav is hidden at `md+`; primary navigation moves to the top bar. FAB "Create passport" is desktop-only in top nav (`md:inline-flex`); mobile uses center FAB in bottom nav.

---

## 7. Iconography

**Library:** `lucide-react` (declared in `package.json`).

| Context     | Size | strokeWidth |
|-------------|------|-------------|
| Inline text | 16   | 1.5         |
| Button      | 20   | 1.5         |
| Decorative  | 24   | 1.5         |

Decorative icons: `aria-hidden="true"`. Meaningful icons-only controls: `aria-label` on the button/link, not on the SVG. Color: inherit `currentColor` or `text-text-secondary` / `text-accent-warm` for emphasis.

---

## 8. Accessibility Baseline

- **Touch targets:** Minimum **44×44px** on mobile (`min-h-11 min-w-11` or explicit `h-11 w-11`). See `Button`, `Input`, and nav icon buttons.
- **Focus rings:** Visible on `:focus-visible` only. Use `--focus-ring` (2px accent-warm ring with 2px offset against `bg-primary`). Never remove focus outlines without a replacement.
- **Contrast:** `text-text-primary` on `bg-bg-primary` must meet **WCAG 2.1 AA** (4.5:1 body, 3:1 large text). Secondary text on primary background must still meet 4.5:1 for body-sized copy; use `text-text-secondary` only for non-essential supporting text at `text-sm` or larger when contrast allows.
- **Reduced motion:** All Framer Motion sequences must call `useReducedMotion()` and skip or shorten transforms.
- **Language:** `lang="en"` on `<html>` in [`app/layout.tsx`](../app/layout.tsx). English-only copy throughout (no locale routing or `lib/i18n/`).
- **Images:** Meaningful `alt` text; decorative images `alt=""`. Brand logo uses CSS mask (`KargainLogo`), not `next/image`. Favicon is SVG (`/kargain-logo.svg`); OG image via `app/opengraph-image.tsx`.

---

## 9. Anti-patterns

Do not use any of the following in this codebase:

- Full-screen marketing hero bands or full-bleed photography headers
- Arbitrary decorative gradients unrelated to tokens or documented patterns
- `box-shadow` or glow effects (including Tailwind `shadow-*`) except `--focus-ring` on `:focus-visible`
- `border-radius` above **8px** (`rounded-lg`) except **pills** (`rounded-full` on avatars and circular icon holders)
- Font weight **600** or **700** (`font-semibold`, `font-bold` for emphasis)
- Title Case in UI strings (use sentence case)
- Emoji in UI copy or icons
- CSS-in-JS libraries (styled-components, emotion, etc.)
- Arbitrary hex colors outside tokens
- Transform-based hover scale or “lift” on cards
- Custom dropdowns without full keyboard support when native `<select>` suffices

---

*Document version: 2.0 (June 2026 — Kargain-only public release). Update when tokens, app shell, or component contracts change.*