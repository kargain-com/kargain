# Kargain — Design Specification

Canonical reference for website UI components. All new work must conform to this document. Do not invent one-off styles.

**Related public docs:** [README.md](../README.md) · [contracts/SPEC.md](./contracts/SPEC.md) · [CONTRIBUTING.md](../CONTRIBUTING.md) · [KIPs](https://github.com/kargain-com/kips)

**Instrument Layer reading order:** §10 (rules) → §11 (philosophy) → §12 (shipped IL-0–IL-5 log; IL-6 skipped) → §13 (mobile contracts).

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

Design principles (enforced in tokens): dark-first, flat surfaces (no shadows), single warm accent used sparingly as **instrument status** (§10.2), maximum heading weight 500, sentence case in UI copy. Philosophy: [§11](#11-design-philosophy).

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
| Mobile (`< md`) | Logo | flex spacer | Display currency · Auctions (icon, when enabled) · Verifiers (icon) · KarPro link (when eligible) · Wallet |
| Desktop (`md+`) | Logo | flex spacer | Display currency · Auctions (when enabled) · Verifiers (secondary button) · Alerts · Messages · Become KarPro (when eligible) · Create passport · Chain selector · Wallet |

**Marketplace search:** lives in the **filter bar** on `/` ([`market-filter-bar.tsx`](../components/marketplace/market-filter-bar.tsx)), not in the top navbar.

**Logo:** [`KargainLogo`](../components/ui/kargain-logo.tsx) at 24px + wordmark "Kargain". Mobile: icon only — wordmark `hidden sm:block`.

**Messages:** `InboxIcon` (size 20). Nav dot via [`MessagingNavStatus`](../components/messaging/messaging-nav-status.tsx): amber when account messaging setup is incomplete; warm accent when unread. Desktop only (`hidden md:inline-flex`); requires wallet connected.

**Alerts:** `NotificationIcon` (size 20). Unread: dot badge via [`NotificationsUnreadBadge`](../components/notifications/notifications-unread-badge.tsx). Desktop only (`hidden md:inline-flex`); link always visible, badge when wallet connected.

**Become KarPro:** [`useShowBecomeKarPro`](../hooks/use-show-become-karpro.ts) — shown when wallet connected and not an active verifier. Mobile top nav: compact **KarPro** label; desktop: **Become KarPro**.

**"Create passport":** Secondary border style — `border border-border-hover bg-transparent`. Desktop only (`hidden md:inline-flex`); mobile uses bottom-nav center FAB.

**Auctions:** Link to `/auctions` when `auctionEscrowAddress(chainId)` is set. Secondary bordered button before Verifiers: `GavelIcon` + **Auctions** label on desktop (`md+`); compact bordered icon on mobile. Active on `/auctions`: `border-accent-warm`, `text-accent-warm`, `bg-bg-surface`. Hover: accent border and text.

**Verifiers:** Link to `/verifiers`. Secondary bordered button in the **right action cluster** (before Alerts): `ShieldCheckIcon` + **Verifiers** label on desktop (`md+`); compact bordered icon on mobile. Active on `/verifiers`: `border-accent-warm`, `text-accent-warm`, `bg-bg-surface`. Hover: accent border and text.

**Chain selector:** [`ChainSelector`](../components/shell/chain-selector.tsx) — Radix dropdown, full network name. Wrong-chain: red status dot. Desktop only (`hidden md:flex`).

**Display currency:** [`CurrencySelector`](../components/shell/currency-selector.tsx) — first control in the right cluster (before Auctions / Verifiers). Desktop: Radix dropdown (`w-[308px]`, `p-3`); mobile: bottom sheet (`max-h-[90dvh]`) with fixed header + scrollable body. Both surfaces share client-side search filter (ISO code substring), **Fiat** / **Crypto** group eyebrows (`.eyebrow` / `narrativeEyebrow`), and a 2-column grid per group (`grid grid-cols-2 gap-0.5`); empty state when search matches nothing. Trigger shows active ISO code only (e.g. `USD`). Menu cells: fixed-width monospace symbol slot (`w-6`, `font-mono`, `text-right`, `text-text-secondary`) + ISO code (`gap-2`); selected row/cell → `text-accent-warm`. Mobile sheet cells use `min-h-11` touch rows in the same grid. AED uses an empty symbol slot (code shown once). ETH uses `Ξ` + `ETH`; BTC uses `₿` + `BTC`. KRW `₩`, RUB `₽`, JPY `¥` (CNY also `¥` — ISO code column disambiguates). Inline price displays ([`listing-display-price.tsx`](../components/marketplace/listing-display-price.tsx)) keep symbol+amount on one line — selector layout only.

**Wallet:** [`WalletLoginButton`](../components/wallet-login-button.tsx) — identicon + ENS or short address + ChevronDown. Radix dropdown: View on Basescan, Copy address, Disconnect. Disconnected: opens connect dialog with **WalletConnect** (when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set) and **Browser wallet** (injected extension or wallet in-app browser only). Mobile Safari/Chrome without an injected provider: hint to use WalletConnect or open the site in MetaMask/Coinbase Wallet; empty state when no connector is available. Dialog closes on successful connect only (`onSuccess`).

**No duplication:** Actions available in mobile bottom nav (Messages, Create, Alerts, Profile) must not repeat in the top bar below `md`.

---

### 4.8 Mobile bottom navigation

Implementation: [`components/shell/mobile-bottom-nav.tsx`](../components/shell/mobile-bottom-nav.tsx). Visible `md:hidden` only.

**Tab order:** Marketplace · Messages · **FAB** · Alerts · Profile

| Slot | Icon | Target | Notes |
|------|------|--------|-------|
| Marketplace | `grid` (Mono Icons) | `/` | [`GridIcon`](../components/ui/icons.tsx) from canonical icon module; compass motif elsewhere per §10.5 |
| Messages | `message-alt` (Mono Icons) | `/messages` | Always visible; dot badge when wallet connected and unread |
| FAB (center) | `add` (Mono Icons) | `/passport/new` | `h-12 w-12 rounded-full bg-accent-warm text-bg-primary`, `AddIcon` size 22, `-top-3`; icon-only; no border or ring |
| Alerts | `notification` (Mono Icons) | `/notifications` | Unread dot via [`NotificationsUnreadBadge`](../components/notifications/notifications-unread-badge.tsx); default tab = Alerts inbox |
| Profile | avatar or `user` (Mono Icons) | `/profile/{address}` or `/profile/edit` | [`IdentityAvatar`](../components/identity/identity-avatar.tsx) when connected (Nostr → ENS → identicon); "Connect" when disconnected |

**Icons:** All product surfaces use Mono Icons from [`components/ui/icons.tsx`](../components/ui/icons.tsx). Regenerate with `pnpm generate:icons` after whitelist changes in [`scripts/generate-icons.mjs`](../scripts/generate-icons.mjs). See §7.

**Frost zone:** `fixed inset-x-0 bottom-0 z-50 h-28` (~112px), `pointer-events-none` on the shell. Content scrolls underneath a progressive frost stack (utilities in [`globals.css`](../app/globals.css)):

| Layer | Treatment |
|-------|-----------|
| `.frost-blur-1` | `blur(2px)`; mask ramp transparent 0% → black 40% |
| `.frost-blur-2` | `blur(6px)`; mask ramp transparent 30% → black 65% |
| `.frost-blur-3` | `blur(12px)`; mask ramp transparent 55% → black 100% |
| `.frost-scrim` | Gradient `transparent` 0% → `color-mix(bg-primary 55%)` 35% → `color-mix(bg-primary 90%)` 60% → `bg-primary` 80% |

Blur layers: `pointer-events-none`, `aria-hidden`. **Fallback:** when `backdrop-filter` is unsupported or `prefers-reduced-transparency: reduce`, blur layers hidden; scrim strengthened to a near-solid gradient (`color-mix(bg-primary 95%)` → `bg-primary` 70%).

**Nav row:** `pointer-events-auto` wrapper anchored to the bottom of the frost zone; `grid-cols-5 h-16`, safe-area inset padding. Active tab: icon + label `text-accent-warm` (no top-border indicator). Inactive: `text-text-secondary`.

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

**Homepage stats (`/`):** [`MarketplaceStatsLine`](../components/marketplace/marketplace-stats-line.tsx) in [`app/page.tsx`](../app/page.tsx) inside `Suspense` (sibling to [`market-browse.tsx`](../components/marketplace/market-browse.tsx)). Stats fetch does not block filter bar or listing grid shell. Compact ambient line above [`market-filter-bar.tsx`](../components/marketplace/market-filter-bar.tsx): `font-mono text-xs text-text-tertiary tabular-nums` via pure [`formatMarketplaceStatsLine`](../lib/marketplace/marketplace-stats-line.ts) (e.g. `42 listings · 3 auctions · 12 verified · 5 active verifiers`). Active auction total from Ponder `GET /auctions?active=true` (`total`). Zero segments omitted; hidden when all stats are 0.

**Verifiers page (`/verifiers`):** No intro band. [`VerifiersIntentBanner`](../components/verifier/verifiers-intent-banner.tsx) in top container (renders immediately). [`VerifierDirectory`](../components/verifier/verifier-directory.tsx) in `#verifier-grid` inside `Suspense` with skeleton grid fallback. Client-side filter/sort via [`filter-verifiers.ts`](../lib/verifier/filter-verifiers.ts): search (case-insensitive) matches name, slug, partial address hex (with or without `0x`), and category label text; category chips; grid-only **Accepts Lightning** toggle (§4.17); sort **Most verified** / **Newest member** / **Lowest fee** (§4.17); query filtering deferred with React `useDeferredValue` (input stays immediate). Nostr kind:0 profiles for payment chips loaded once via [`useNostrProfiles`](../hooks/use-nostr-profiles.ts) — single batched relay subscription for all directory addresses; profiles populate progressively (no per-card subscriptions). Grid layout shows results counter under toolbar — `font-mono text-xs text-text-secondary tabular-nums` (`12 verifiers` or `12 verifiers · 8 match` when search, category, or Lightning filter active; singular *verifier*). Picker layout (`layout="picker"`) shares search/sort but omits counter and Lightning filter. Each card shows verification count, member since, **verification fee** via [`VerificationFeeDisplay`](../components/verifier/verification-fee-display.tsx) (ETH primary + optional nav-currency secondary; `0` → *Contact for quote*), **payment method chips** via [`VerificationPaymentChips`](../components/verifier/verification-fee-display.tsx) (§4.17), **View showroom →**, **Request verification**, and **Pay for inspection** when Ponder fee &gt; 0 (see §4.17).

> **Price display:** canonical classes in [§10.2](./design-spec.md#102-accent-as-status-not-decoration) — `font-mono text-lg font-medium tabular-nums text-text-primary` for asking/browse amounts; fee lines mono `text-text-secondary` (`text-xs` compact, `text-sm` showroom/profile stats). No `text-accent-warm` on amounts or card price hover.

**Listing card:** [`listing-card.tsx`](../components/marketplace/listing-card.tsx) — price via shared [`listing-display-price.tsx`](../components/marketplace/listing-display-price.tsx) + `convertPrice()` (display currency from nav). (Price display: §10.2.) Cover from Ponder `coverPhotoUri` (first metadata `photos[]` entry, indexed at replay). Uniform photo frame via [`listing-card-media.ts`](../lib/marketplace/listing-card-media.ts) — `relative aspect-[16/10] shrink-0` plate with `absolute inset-0 object-cover` image (identical rendered size across cards regardless of source framing or equalized card height). All listing-card grids use shared [`listing-card-grid.ts`](../lib/marketplace/listing-card-grid.ts) (`auto-rows-fr`); homepage stats line uses `MARKETPLACE_SHELL_CONTAINER` from the same module (matches nav/filter padding at `px-6` / `md:px-8`). **No** opaque overlay on the image area. VERIFIED listings use permanent `border-accent-warm` on the card (not hover-only). UNVERIFIED / DISPUTED use `border-border-default`; hover → `border-border-hover` (never accent on hover). Indexer duplicate VIN: `elevatedAdvisoryChip` (§10.3) as first row in `CardContent` — not on the image. VERIFIED + non-empty `row.verifier` shows ShieldCheck **Verified by** attribution linking to `/profile/{address}`. DISPUTED shows `AlertTriangle` + **Disputed by** `{shortAddress(lastDisputer)}` (`status-error` chroma; plain *Disputed* when `lastDisputer` empty). Placeholder: centered "No image" when `imageUrl` is null.

**Photo upload (mint + edit):** [`photo-upload-zone.tsx`](../components/passport/photo-upload-zone.tsx) (create) and [`edit-passport-wizard.tsx`](../components/passport/edit-passport-wizard.tsx) (new photos only). Incoming images (including HEIC via `heic2any`) are always re-encoded to **WebP ≤ 100 KB** in the browser via [`compress-passport-image.ts`](../lib/passport/compress-passport-image.ts) and [`passport-image-encode-plan.ts`](../lib/passport/passport-image-encode-plan.ts) — quality and max-edge ladder until the byte budget is met; no skip path and no fallback to the original file. Failures surface as [`PassportImageOptimizeError`](../lib/passport/passport-image-optimize-error.ts) with user-facing copy from [`passport-flow-messages.ts`](../lib/passport/passport-flow-messages.ts). [`passport-upload-preflight-banner.tsx`](../components/passport/passport-upload-preflight-banner.tsx) warns smart contract wallets when multiple photos may fail the Irys storage deposit.

**VIN insight (create + edit):** [`passport-metadata-fields.tsx`](../components/passport/passport-metadata-fields.tsx) on `/passport/new` and `/passport/{tokenId}/edit` only — presentational; assist state owns [`use-vin-assist.ts`](../hooks/use-vin-assist.ts) + pure [`vin-assist.ts`](../lib/passport/vin-assist.ts) reducer. Sync `buildVinInsight` ([`vin-insight.ts`](../lib/passport/vin-insight.ts), `@kargain/vincent` main entry) runs in the wizard bundle for instant validation/year feedback; WMI origin resolves progressively via debounced async `resolveVinOrigin` (`@kargain/vincent/wmi` lazy chunk — not in marketplace/detail bundles). Hard errors → `text-status-error`; check-digit advisories (non–North America) → `text-status-warning` with European-market copy. Origin line when WMI known: mono tertiary `From VIN · {wmi} · {manufacturer} · {country}` (renders when resolve settles; no reserved empty slot). Year: autofills when field empty and VIN yields unambiguous model year; **From VIN** marker (`font-mono text-text-tertiary`) until manual edit; conflicting year → advisory *VIN suggests {year}* (no overwrite). **Merkle decode (K-2):** when VIN is 17 chars and insight status is ok/warning, debounced `decodeVinFields` ([`vin-decode.ts`](../lib/passport/vin-decode.ts)) lazily loads `@kargain/vincent/decoder` + `/arweave` against the pinned Sepolia dataset ([`vincent-dataset.ts`](../lib/passport/vincent-dataset.ts)), Merkle-verifies leaves, and prefills empty `model` / `modelVariant` / `bodyType` / `fuelType` / `transmission` / `engine` only; **Decoded** marker (`font-mono text-xs text-text-tertiary`, sentence case) until manual edit — then that field is never overwritten again. Fail-silent (no spinner, no decode error copy). Unmapped vPIC strings are skipped (never coerced to Other). **No** make autofill. EU and unknown-WMI VINs keep origin + year insight only — decode never invents attribute values. Duplicate-VIN browse/detail advisory unchanged.

**Irys upload progress (create + edit):** [`passport-upload-progress.tsx`](../components/passport/passport-upload-progress.tsx) — batch photo status, storage fee hint, progress bar. Shown during `phase === "uploading"`. Upload errors from Irys at deposit/upload time use `formatPassportUploadError` (same path as evidence uploads on passport detail). User-facing phase copy for edit lives in [`passport-flow-messages.ts`](../lib/passport/passport-flow-messages.ts).

**Passport edit save flow (`/passport/{tokenId}/edit`):** [`edit-passport-wizard.tsx`](../components/passport/edit-passport-wizard.tsx) stays on the edit page through upload → on-chain save → receipt confirmation → Ponder receipt-block synchronization. After synchronization, form and photo grid hydrate from the saved metadata (new photos become existing URIs). [`passport-edit-success-banner.tsx`](../components/passport/passport-edit-success-banner.tsx) shows success without redirect; optional link to marketplace detail. [`passport-indexer-sync-banner.tsx`](../components/passport/passport-indexer-sync-banner.tsx) remains the entity-drift fallback for externally initiated indexing where the page has no receipt block. Passport detail and `getPassportDetail` prefer on-chain `tokenURI` over stale Ponder `tokenUri` when they differ ([`fetch-passport-detail.ts`](../lib/passport/fetch-passport-detail.ts) + [`passport-uri-drift.ts`](../lib/passport/passport-uri-drift.ts)).

**Passport token ID display:** v2 on-chain IDs encode `chainId << 128 | localSequence` ([SPEC](./contracts/SPEC.md)). UI shows human labels via [`passport-token-id.ts`](../lib/passport/passport-token-id.ts) + [`passport-id-label.tsx`](../components/passport/passport-id-label.tsx) — e.g. `Passport #0 · Base Sepolia`. Full decimal ID stays in URLs, APIs, and `title` tooltip on hover.

**ProPass token ID display:** KarProPass token IDs encode `uint256(uint160(holderAddress))` ([SPEC §I.3](./contracts/SPEC.md)). UI shows human labels via [`pro-pass-token-id.ts`](../lib/kar-pro/pro-pass-token-id.ts) + [`pro-pass-id-label.tsx`](../components/kar-pro/pro-pass-id-label.tsx) — e.g. `Pass #0xcf1E·0b77 · Base Sepolia` on credential card subtitle; full decimal ID in `title` tooltip on hover. Chain suffix optional (`showChain: false` on `/kar-pro` subtitle).

---

### 4.11 Profile

Implementation: [`components/identity/identity-header.tsx`](../components/identity/identity-header.tsx), [`components/identity/identity-avatar.tsx`](../components/identity/identity-avatar.tsx), [`components/profile/profile-page.tsx`](../components/profile/profile-page.tsx), [`components/profile/profile-action-banner.tsx`](../components/profile/profile-action-banner.tsx), [`components/profile/karpro-status-widget.tsx`](../components/profile/karpro-status-widget.tsx), [`components/kar-pro/kar-pro-client.tsx`](../components/kar-pro/kar-pro-client.tsx), [`components/kar-pro/kar-pro-section-nav.tsx`](../components/kar-pro/kar-pro-section-nav.tsx).

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
| Passive pubkey restore | [`use-nostr-key.tsx`](../hooks/use-nostr-key.tsx) — on connect when [`nostr-pubkey-cache`](../lib/nostr/nostr-pubkey-cache.ts) is empty and no in-memory private key, one relay attempt per mount via `attestedPubkeyForAddress` (read-only; no wallet signature); result cached in localStorage; `loading` true during resolve so watchlist/notification read paths do not flash empty |
| Identity mismatch | [`use-nostr-key.tsx`](../hooks/use-nostr-key.tsx) — after `getOrCreateNostrKey`, compare derived pubkey to attested pubkey (cache or one relay resolve); mismatch → `identityMismatch: true`, `ensureNostrKey` returns `null` (no cache overwrite); `resolveIdentity` retries signature → `persistent` if still mismatched; `migrateIdentity` copies profile/watchlist/notification state via [`migrate-identity.ts`](../lib/nostr/migrate-identity.ts) |
| Publish rotation gate | [`profile.ts`](../lib/nostr/profile.ts) `publishNostrProfile` — after key derive, [`identity-rotation.ts`](../lib/nostr/identity-rotation.ts) `isRotatedIdentity` vs cached/attested expected pubkey; mismatch → `false` (no attestation signature, no publish); `publishNostrProfileWithPrivateKey` unchanged (explicit migration) |
| LWW watchlist | [`app-event-store.ts`](../lib/nostr/app-event-store.ts) + [`favorites.ts`](../lib/nostr/favorites.ts) — kind 30000 `d=kargain-favorites`; merge-read **all** relay events (never latest-only); LWW element-set content `{ v:1, items, removed }` with legacy `i` tag mirror; `addFavorite`/`removeFavorite` fail-closed when merge-base query throws; per-pubkey serialized writes; [`use-watchlist.ts`](../hooks/use-watchlist.ts) rolls back optimistic state on `false` |
| Identity relink card | [`identity-relink-card.tsx`](../components/profile/identity-relink-card.tsx) on `/profile/edit` — State A *Reconnect profile* / State B *Move profile*; informational §10.3 panel; Save disabled while mismatch unresolved |
| Profile edit | [`profile-edit-client.tsx`](../components/profile/profile-edit-client.tsx) — optional **Lightning address** (`lud16` on kind 0) for **confirmed non-verifiers** only; gating is fail-closed while KarProStaking `isActiveVerifier` resolves (field disabled, `lud16` omitted from publish patch until status confirmed); active verifiers see read-only lud16 + *Managed in KarPro settings* link → `/kar-pro?section=payments`; merge-preserving publish via [`merge-kind0-content.ts`](../lib/nostr/merge-kind0-content.ts) — **touched-fields-only** patch via [`build-profile-edit-patch.ts`](../lib/nostr/build-profile-edit-patch.ts) (untouched keys absent; Save disabled while profile loading, verifier status pending, identity mismatch, or no edits); **Lightning wallet** subsection ([`lightning-wallet-section.tsx`](../components/profile/lightning-wallet-section.tsx)) for NWC connect/disconnect; **active verifiers** — **Professional profile** readout group (`divide-y divide-border-default`, four rows): Business profile (name · category + mono slug) → `/kar-pro?section=profile`; Verification fee (`VerificationFeeDisplay`, chain-read from Ponder) → `/kar-pro?section=fee`; Payments (`VerificationPaymentChips` from cached Nostr profile, `—` while loading or unset) → `/kar-pro?section=payments`; Membership (chain-read `{stakeLabel} ETH staked`) → `/kar-pro?section=membership`; each row `monoLinkSm` **Edit →** / **Manage →** |
| KarPro stats | Compact mono line on `profile-page.tsx` (active verifier or non-zero VERIFIED count): **verificationCount** = passports with `status=VERIFIED` assigned to this verifier · active since · **verification fee** (all visitors) · chain-read **minStakeNative** staked (owner only, via [`use-min-stake-native.ts`](../hooks/use-min-stake-native.ts)) · owner **Manage →** → `/kar-pro?section=membership` · **Edit fee →** → `/kar-pro?section=fee`. Refreshes client-side via [`ProfileVerifierStatsBand`](../components/profile/profile-verifier-stats-band.tsx). |
| Action banner | `ProfileActionBanner` — five contextual cases (visitor+KarPro send request, owner become KarPro, owner open disputes, etc.) |
| KarPro widget | `KarProStatusWidget` — owner + active verifier only; chain-read stake amount in status copy; **Membership →** → `/kar-pro?section=membership`; **Edit fee →** → `/kar-pro?section=fee` |
| KarPro hub (`/kar-pro`) | Active verifier only — [`KarProIdentityStrip`](../components/kar-pro/kar-pro-identity-strip.tsx) (name, category chip, Pass ID) always above sticky [`KarProSectionNav`](../components/kar-pro/kar-pro-section-nav.tsx); sections **Overview · Profile · Fee · Payments · Commons · Membership** via `?section=` (`overview` default; invalid → overview; legacy `account` → Membership; `history.replaceState`, no page scroll jump). The horizontal nav hides its native scrollbar and uses pointer-events-none gradient edge fades only where more content exists (`scrollLeft > 0` left; `scrollLeft + clientWidth < scrollWidth - 1` right); active sections reveal with nearest-edge `scrollIntoView` using default auto motion. Tabs remain focusable buttons with `min-h-11`, `shrink-0`, and `px-3 md:px-4` |
| KarPro Overview | [`kar-pro-overview-section.tsx`](../components/kar-pro/kar-pro-overview-section.tsx) — optional [`KarProSetupChecklist`](../components/kar-pro/kar-pro-setup-checklist.tsx) above readout while required setup incomplete (see next row); Level B `instrumentReadoutPanel`: `✓ Active KarPro` (accent-warm), Pass ID, chain-read stake (`useMinStakeNative`), advisory *Fully refundable · No slash · Leave anytime*, verification count + joined date, staking contract explorer link (`monoLinkSm`), read-only `VerificationFeeDisplay` + *Edit fee →* to Fee section |
| KarPro setup checklist | [`kar-pro-setup-checklist.tsx`](../components/kar-pro/kar-pro-setup-checklist.tsx) + [`setup-checklist.ts`](../lib/kar-pro/setup-checklist.ts) — Overview only; visible while `allRequiredComplete === false` (profile name+slug, explicit kind 0 `verifierPaymentMethods`, messaging ready); four `divide-y` rows with neutral `CheckIcon` complete states (no success-green); pending rows deep-link via `replaceKarProSectionUrl` to Profile / Payments / Fee; **Private messages** pending shows *Enable messages above* (no duplicate CTA — [`MessagingSetupCard`](../components/messaging/messaging-setup-card.tsx) only); **Verification fee (optional)** never blocks completion — fee `0` shows *Contact for quote* copy |
| KarPro Profile | [`kar-pro-profile-section.tsx`](../components/kar-pro/kar-pro-profile-section.tsx) — `KarProProfileFields` edit flow + View showroom link |
| KarPro Fee | [`kar-pro-fee-section.tsx`](../components/kar-pro/kar-pro-fee-section.tsx) — display-currency margin + gas estimate → `setVerificationFee`; guardrail copy unchanged |
| KarPro Payments | [`kar-pro-payments-section.tsx`](../components/kar-pro/kar-pro-payments-section.tsx) — Nostr `verifierPaymentMethods` toggles + `lud16` (canonical edit for verifiers); when Lightning is enabled, save requires a non-empty valid `lud16` (empty shows §10.3 error *Add a Lightning address to accept Lightning payments.*); Save disabled while own profile loading; scope caption under lud16: verification fee vs per-listing car sale; separate save action |
| KarPro Commons | [`kar-pro-commons-section.tsx`](../components/kar-pro/kar-pro-commons-section.tsx) → lazy [`kar-pro-commons-queue.tsx`](../components/kar-pro/kar-pro-commons-queue.tsx) (`next/dynamic`, keeps `@kargain/vincent` out of the hub bundle) — Vincent F-2 review queue: session-cached derive (`getCommonsObservations` server action + client `deriveClaims`); candidate rows = vds-pattern claims (mono attribute value, mono `WMI · year · VDS` tabular-nums, source passport `monoLinkSm` links, `N accepts · M rejects` counts, §4.3 threshold hint — 1 accept from the verifier of record or 2 independent); priority order: connected verifier's source passports first; Accept / Reject one wallet signature each (kind 31860 Nostr publish, optimistic verdict + rollback on publish failure); own verdict `trustStampNeutral`; conflicts group `elevatedAdvisoryPanel` (`status-error`, display-only, no accept); unknown-WMI cards (F-2.1): existing kind **31861** claim proposals listed as rows (mono manufacturer / country / vehicleType, `null` → `—`; counts + accept/reject via the 31860 flow; threshold hint *Needs the proposer and one independent accept* — met = proposer endorse + ≥1 independent, [`wmi-claim.ts`](../lib/vincent-commons/wmi-claim.ts)) plus **Propose from document** inline form (manufacturer required; optional ISO alpha-2 country + vehicle type; required document-sighting checkbox; no document upload — PROTOCOL §4.7); submit = one wallet signature (the endorse) publishing 31861 proposal + 31860 endorse, optimistic row/verdict with rollback ([`use-commons-wmi-proposals.ts`](../hooks/use-commons-wmi-proposals.ts) fail-closed content-addressed reads, `d` = claimHash, `w` = WMI); verified counts gate on attested wallet↔Nostr binding + `isActiveVerifier` chain reads ([`use-commons-reviews.ts`](../hooks/use-commons-reviews.ts)) |
| KarPro Commons governance | [`kar-pro-commons-governance.tsx`](../components/kar-pro/kar-pro-commons-governance.tsx) (second lazy chunk below the queue) — F-2.2 read-only readouts, no transactions: **Publishers panel** (active verifier set from `getVerifierDirectory` → lazy [`registry-reads.ts`](../lib/vincent-commons/registry-reads.ts) `epochCount`/`getEpoch` on the pinned `VincentAnchorRegistry` ([`registry-config.ts`](../lib/vincent-commons/registry-config.ts)) via dynamic `@kargain/vincent/anchor` + dedicated multicall-batched viem client; one-shot `staleTime: Infinity` query, no polling) — rows per publisher with ≥1 epoch: `monoLinkSm` short address → Basescan, mono tabular epoch count, truncated latest `merkleRoot` (full value in `title`), lineage tick from parentRoot continuity (`lineage ok` tertiary / `lineage broken` `status-error`); zero-epoch verifiers collapse to one quiet tertiary summary row; empty registry → *No community epochs published yet — any active verifier can be first* + mono flywheel-doc path; any directory/RPC failure → fail-silent tertiary *Registry unreachable*; **F-4 acceptance-bar readouts** (July 2026): per publisher row a mono tabular `N confirmations` count (independent gated kind 31862 confirmations of the latest epoch via [`use-commons-confirmations.ts`](../hooks/use-commons-confirmations.ts) — one batched subscription over the shared live-policy path, same gate chain as reviews: signature → attested wallet↔Nostr binding → `isActiveVerifier`; publisher self-confirmations excluded as non-independent) and a quiet tertiary `meets acceptance bar` tag when the latest epoch is eligible per the pure evaluator [`acceptance.ts`](../lib/vincent-commons/acceptance.ts) against the pinned `VINCENT_REGISTRY.acceptancePolicy` (`minIndependentConfirmations: 1` on Sepolia, ≥2 mainnet); below the list a single `trustStampNeutral` **Eligible root** stamp for the overall best eligible root (most independent confirmations, tie → earliest anchor) + a tertiary sentence-case comparison line (*matches pinned dataset* / *newer than pinned dataset — maintainer switch pending* — informational, not a trust state; no auto-switch, decoder keeps reading `VINCENT_DATASET`); **Pinned dataset card** (root / publisher / epoch tag from `vincent-dataset.ts`, mono truncated + `title`, switch-remains-a-maintainer-edit note); **Role explainer** (contributor → reviewer *(you are here)* → publisher prose, confirmations arrive with publisher tooling, no external links). Neutral instrument rows — no accent-warm on registry data |
| KarPro Membership | [`kar-pro-membership-section.tsx`](../components/kar-pro/kar-pro-membership-section.tsx) — chain-read stake readout (`useMinStakeNative`), Pass ID, advisory *Fully refundable · No slash · Leave anytime*, staking contract explorer link (`monoLinkSm`); divider; Leave KarPro confirm flow; destructive actions `status-error` |
| Tabs | Counts in tab labels; **Verified** and **Attestations** when subject is active verifier or has verifier history in Ponder (visible to all visitors); **Disputes** owner + active verifier only |
| Tab active state | `profileTabActive` / `profileTabInactive` from [`instrument-classes.ts`](../lib/design/instrument-classes.ts) — accent bottom border only, no active background fill |
| Attestations panel | `serialLabel` eyebrow *Attestation feed*; Level C rows in `divide-y` list (`bg-bg-primary/80` shell) — feed pattern per §10.4 |
| Disputes panel | `serialLabel` eyebrow *Open disputes*; Level A `DisputeCard` grid — operational queue |
| Dispute cards | Vehicle make/model/year, reason, relative time, disputer, Resolve link to marketplace detail |

#### Profile attestation (NS-1 / NS-2)

Wallet-signed binding of Nostr pubkey to Ethereum address on kind 0 content. Write: [`profile-attestation.ts`](../lib/nostr/profile-attestation.ts) + [`profile.ts`](../lib/nostr/profile.ts). Read: [`resolve-attested-profile.ts`](../lib/nostr/resolve-attested-profile.ts) — **single choke point**; consumers cannot obtain unverified profile data by address.

| Item | Value |
|------|-------|
| Message | `Kargain profile binding v1\nnostr:{pubkey-hex}\nethereum:{lowercase-0x-address}` |
| Content field | `attestation: { v: 1, sig: "0x…" }` — pubkey and address are implicit from event `pubkey` and NIP-39 `i` tag |
| Write path | [`publishNostrProfile`](../lib/nostr/profile.ts) — merge source fetched by `{ kinds: [0], authors: [derivedPubkey] }` only (never by `#i`); if existing author content has valid attestation, merge preserves it (no extra wallet prompt); otherwise one additional `signMessage(attestationMessage)` before publish |
| Merge | [`merge-kind0-content.ts`](../lib/nostr/merge-kind0-content.ts) — `fetchLatestKind0RawByAuthor`; `attestation` outside managed keys; preserved when patch omits it; set only via explicit publish param |
| Publish guard | `publishNostrProfile` / `publishNostrProfileWithPrivateKey` — when caller passes `expectExisting: true` and merge base fetch returns `{}`, abort (`false`) before attestation signature; default `expectExisting: false` preserves first-ever save |
| Messaging patch | Enable/disable messaging publishes `{ messagesEnabled }` only — no personal fields re-sent ([`messaging-settings-section.tsx`](../components/profile/messaging-settings-section.tsx) via `dispatch` enable/disable) |
| Read resolver | `resolveAttestedProfile` / `resolveAttestedProfiles` / `attestedPubkeyForAddress` — query `#i`, sort `created_at` desc, return **newest event that passes verify** (older attested beats newer spoofed); `null` when none verify |
| Batch (KP-5) | [`use-nostr-profiles`](../hooks/use-nostr-profiles.ts) — subscription events verified before accumulator; unverified never enter map |
| Verify helper | `verifyProfileAttestation(event, expectedAddress)` — EIP-191 recover via viem; fail-closed; memoized by `event.id` + normalized address |
| Lint guard | ESLint `no-restricted-syntax` on `"#i"` filter property — allowed only in resolver (+ listing-offers passport tag, tests) |
| Key material | **The nostr key-derivation signature (`kargain-nostr-v1:…`) is private key material and must never appear in event content, tags, logs, or errors.** Attestation uses a separate `signMessage` with the binding message above. |
| External clients | Third-party kind 0 publishers must adopt the same v1 binding message (or a future version bump) to pass read-path checks |

**NS initiative (NS-1–NS-5) complete:** write-path attestation, read-path resolver enforcement, publish integrity (NS-4), relay infra + client publish helper (NS-5.3), LWW watchlist store (NS-5.4). NS-3 migration nudge removed in NS-4.1.

**Pro showroom (`/pro/[slug]`):** Hero stats grid (passports verified · active listings · attestations) uses the same Ponder `verificationCount` (VERIFIED only) and `attestationTotal`; visible on all breakpoints (`grid-cols-3`). [`ProShowroomVerificationFee`](../components/verifier/pro-showroom-verification-fee.tsx) below the stats grid — chain-read fee with Ponder fallback, payment method chips (§4.17), **Pay for inspection** when effective fee &gt; 0 (§4.17). Showroom content renders when the verifier is active on-chain, active in Ponder, or has at least one VERIFIED passport.

Do not vary avatar shape by role. **IdentityAvatar** / **EnsAvatar:** round only; used in profile header, verifier directory, pro showroom, mobile bottom nav, and XMTP inbox rows.

---

### 4.12 Messages

Implementation: [`use-messaging-session.ts`](../hooks/use-messaging-session.ts) (sole React entry), [`session-store.ts`](../lib/messaging/session-store.ts), [`snapshot-ui.ts`](../lib/messaging/snapshot-ui.ts), [`message-inbox-client.tsx`](../components/messaging/message-inbox-client.tsx), [`conversation-thread-client.tsx`](../components/messaging/conversation-thread-client.tsx), [`messaging-setup-card.tsx`](../components/messaging/messaging-setup-card.tsx), [`messaging-setup-error.tsx`](../components/messaging/messaging-setup-error.tsx), [`xmtp-adapter.ts`](../lib/messaging/adapters/xmtp-adapter.ts) (only `@xmtp/client` importer).

**Account model:** Wallet connect = account created. **Enable messages** (one wallet signature) = XMTP inbox registered on-network and DMs available. **Canonical truth:** Nostr `messagesEnabled` intent → XMTP network registration → OPFS local client → cache memos (latency only). Legacy `xmtp:opted-in` / `xmtp:disabled` / `xmtp:network-registered` keys are purged on session init — not read.

**SessionSnapshot → surfaces**

| Snapshot | UI |
|----------|-----|
| `disconnected` | No wallet — setup surfaces hidden |
| `unsupported` | Contract wallet — messaging unavailable |
| `disabled` + `intent: "absent"` | First-time onboarding (`MessagingSetupCard`) |
| `disabled` + `intent: "explicit"` | Turned off copy; switch off in settings |
| `reconciling` | Spinner beside CTA (probe / build / create / publish / revoke / reset / intent) |
| `needs_signature` | Device activation card (`not_registered` \| `build_failed`) |
| `active` | DMs available; `publiclyReachable` drives profile switch + peer reachability |
| `active` + `publishError` / `publishPending` | Inline publish retry in settings (no second XMTP signature) |
| `error` | Recovery card (`MessagingSetupError`); `opfs_lock` → close other tab; `installation_limit` → free device slots |

| Element | Rule |
|---------|------|
| Layout | `max-w-lg`, full viewport height minus nav |
| Account setup | Owner profile: [`AccountSetupBanner`](../components/profile/account-setup-banner.tsx) when `needsMessagingSetupCard(snapshot)`; links to `/profile/edit#messages` |
| Profile settings | [`MessagingSettingsSection`](../components/profile/messaging-settings-section.tsx) — **Private messages** [`Switch`](../components/ui/switch.tsx); `checked = active.publiclyReachable`; toggle on → `dispatch({ type: "enable" })`; off → confirm → `dispatch({ type: "disable" })`; publish failure → inline **Retry** (`retry`) |
| Seller warning | [`SellerMessagingBanner`](../components/marketplace/seller-messaging-banner.tsx) on own active listing detail + manage listing — banner only (listing not blocked) |
| KarPro | Post-join [`MessagingSetupCard`](../components/messaging/messaging-setup-card.tsx) with `context="karpro"` until `messagingReadyForChecklist(snapshot)` |
| `?to=` pre-fill | `/messages?to={address}` opens DM after `awaitActiveSnapshot`; uses [`contactPeer`](../lib/messaging/contact-peer.ts); URL param stripped on mount |
| Listing inquiry DM | [`SellerContactButton`](../components/marketplace/seller-contact-button.tsx) with `listingTokenId` — on **new** threads only (`lastMessage()` empty), silently sends listing context before navigating to `/messages/{id}` |
| Profile entry | Identity header **Message** / **Request verification** when peer reachable; else copy from [`peerReachabilityMessage`](../lib/messaging/can-message-peer.ts) |
| Peer reachability | [`usePeerMessagingReachability`](../hooks/use-peer-messaging-reachability.ts) + [`can-message-peer.ts`](../lib/messaging/can-message-peer.ts) before DM actions |
| XMTP client | `useMessagingSession().client` from session `getXmtpClient()`; `conversations.sync` owned by [`XmtpConversationsProvider`](../components/providers/xmtp-conversations-provider.tsx) |
| Setup card | `enable` / `disable` / `resetIdentity` / `retry` / `cancel` commands; CTA disabled while `isUserOpInFlight(snapshot)` or `active` / `unsupported` / `disconnected` |
| Setup card errors | Primary user copy `text-status-error`; SDK diagnostic as secondary `text-text-tertiary font-mono text-xs` when masked |
| Installation limit recovery | `resetIdentity` chain: revoke → reset → create; advisory *Messages on your other devices will need one-time reactivation.* |
| OPFS identity reset | `error` + `resetIdentity` next — scoped OPFS delete via adapter; advisory *Message history on this device will be re-downloaded from the network.* |
| Nav status | [`MessagingNavStatus`](../components/messaging/messaging-nav-status.tsx) — amber dot when `needsMessagingSetupCard`; warm unread dot from shared provider |
| Provider mount | [`MessagingNotificationsProviders`](../components/providers/messaging-notifications-providers.tsx) always mounted in [`app-providers.tsx`](../components/providers/app-providers.tsx); guest hooks no-op until wallet connected |
| XMTP SDK load | [`xmtp-adapter.ts`](../lib/messaging/adapters/xmtp-adapter.ts) only — lazy `import("@xmtp/client")` on first port call; no top-level SDK import in app bundle |
| Offline catch-up | Provider re-syncs XMTP on tab focus, wallet restore, and 60s interval; [`MessagingCatchUpBanner`](../components/messaging/messaging-catch-up-banner.tsx) above inbox when unread increased after reconnect |
| Thread header | Peer avatar + display name + KarPro badge + link to `/profile/{address}` |
| Own bubble | `bg-white text-bg-primary` |
| Peer bubble | `bg-bg-surface text-text-primary` |
| Bubble content | `whitespace-pre-wrap break-words` preserves sent and received newlines and wraps long tokens |
| Timestamps | Below bubble, `font-mono text-xs text-text-tertiary tabular-nums`, aligned with sender side (inbox row: `font-mono text-[10px] text-text-secondary tabular-nums`) |
| Composer | Auto-growing `Textarea` (`rows=1`, `min-h-11`, approximately six lines max, then scroll) + icon `Button`; Enter sends, Shift+Enter inserts a newline, and composing IME Enter / keyCode 229 never sends; successful send resets the field height |
| Empty inbox | Comment icon + title *No conversations yet* + description *Conversations with buyers and sellers appear here. Start one from any listing with Message seller.* + **Browse marketplace** → `/`; only when messaging is active |
| User errors | Not registered: *This user has not enabled messages yet.* · Opted out: *This user is not accepting messages.* |

No per-message sender label in the bubble list. No drift banner — publish/network gaps surface inline on settings (`publishError`) or via setup card states.

Address classification: [`wallet-account.ts`](../lib/web3/wallet-account.ts). Protocol contracts and bytecode `contract` accounts are not profile or messaging peers.

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

Implementation: [`passport-detail-view.tsx`](../components/passport/passport-detail-view.tsx), [`passport-detail-tabs.tsx`](../components/passport/passport-detail-tabs.tsx), [`listing-comments-provider.tsx`](../components/passport/listing-comments-provider.tsx), [`passport-custody.ts`](../lib/marketplace/passport-custody.ts).

**IA:** full-width shell (`max-w-7xl` / `xl:max-w-[80rem]`). **No** bottom action bar. **No** modals for History/Actions/Discussion. **Not** the narrow `760px` prototype column.

**Shared header (always):** title + two-line seal; serial; dispute one-liner; MRZ; advisories; constrained gallery photo plate (§13.7).

**Sticky tabs** ([`passport-detail-tabs.tsx`](../components/passport/passport-detail-tabs.tsx)): `Overview` | `History & records` | `Actions` — URL `?tab=overview|records|actions` (overview omits `tab`). History/Actions **lazy-mounted** on first visit (kept mounted after to preserve form state). Lighter than dialogs (no portal/overlay).

**Overview tab:** description, attributes; **mobile:** commerce then **compact Discussion at bottom**; **desktop:** main column only (commerce + Discussion in right rail).

**Desktop (`md+`):** `grid` starts at the **header** (title/MRZ/gallery/tabs in the left column) so `#passport-commerce` aligns with the title, not below the photo plate. Right rail (`22rem`, sticky `top-24`) — commerce + always-on compact Discussion ([`passport-discussion-rail.tsx`](../components/passport/passport-discussion-rail.tsx)).

**Mobile (`< md`):** tabs + Overview ends with commerce + compact Discussion ([`passport-mobile-discussion.tsx`](../components/passport/passport-mobile-discussion.tsx)).

**Discussion** ([`nostr-comments-section.tsx`](../components/marketplace/nostr-comments-section.tsx) `density="compact"`):
- Shared feed via [`ListingCommentsProvider`](../components/passport/listing-comments-provider.tsx) (one Nostr subscription per page)
- Compact rows (`divide-y`), replies collapsed by default, show-earlier cap, compact composer
- Progressive Nostr paint (partial flush before EOSE; limit 100; timeout 2s) — [`use-listing-comments.ts`](../hooks/use-listing-comments.ts)
- Deep link `?e=` scrolls to comment id; notifications use `marketplaceCommentHref` without `panel=`

**Header details:** seal `sublabel` (DISPUTED → `under review`; VERIFIED → short verifier); dispute line → `?tab=records`; MRZ all breakpoints. VIN in attributes uses `InstrumentFrame` with `w-fit max-w-full` (brackets hug the VIN string, not the full section width).

**Owner actions** still use on-chain `ownerOf` ([`passport-owner.ts`](../lib/passport/passport-owner.ts)); Ponder `passport.owner` is SSR fallback only.

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
| Direct payment | Optional seller `settlementNotes` (bank, BTC, Lightning, etc.); buy panel **Direct payment** card when note set — detected identifiers render as QR + copy blocks; raw note unchanged below; *Not verified by Kargain* |
| Seller preview | The listing seller sees the same read-only **Direct payment** card below *Buyers see these direct payment instructions.* when a note is set; no caption or card when the note is empty |
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
| Post-confirm | Delisted listing shows `commerceConfirmedPanel` + `commerceConfirmedLabel` (*Payment confirmed*) with mono timestamp when indexed; offers panel row uses same label after `confirmExternalPayment`; Ponder field `externalPaymentConfirmedAt` on listing detail |
| Offer gating | Hidden for seller and agent viewers; buyer offer button only when `hasDirectPayment` |

#### Direct payment identifier blocks (buyer card)

When [`direct-payment-note.tsx`](../components/marketplace/direct-payment-note.tsx) detects recognized payment identifiers in the settlement note, each renders as its own Level B panel above the unchanged raw note.

| Rule | Value |
|------|-------|
| Detection | [`payment-identifiers.ts`](../lib/lightning/payment-identifiers.ts) — `detectPaymentIdentifiers` scans first 4_000 chars; max 6 identifiers; structural match only (BOLT12 `lno1…`, BOLT11 `lnbc…` + decode, LUD-16 via `parseLud16`, mainnet BTC `1`/`3`/`bc1q`/`bc1p`; rejects testnet) |
| Labels | Sentence case: Lightning offer / Lightning invoice / Lightning address / Bitcoin address |
| Value | Mono `text-xs break-all text-text-primary` — raw identifier string |
| QR payload | `paymentIdentifierUri` — `lightning:{value}` for Lightning kinds; `bitcoin:{value}` for on-chain BTC |
| Copy | Copies **raw value** (not URI); secondary button |
| BOLT11 advisory | Per block: *Lightning invoices expire. Ask the seller for a fresh invoice before paying.* |
| Large-amount advisory | Once per card when any Lightning identifier and listing USD 1e8 &gt; `LIGHTNING_ADVISORY_USD_1E8` ($1,000); rates via `listingToUsd1e8` + `useMarketRatesRequest` only when Lightning detected; omitted when rates unavailable |
| Fallback | No identifiers detected → card pixel-identical to pre-C2 (title + raw note + trust line only) |
| Out of scope | Seller/agent settlement panels; offers flow; checksum validation beyond BOLT11 decode |

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
| Delegate to a pro | The unified [`passport-sell-panel.tsx`](../components/passport/passport-sell-panel.tsx) owns **Delegate to a pro**; it opens [`authorize-agent-dialog.tsx`](../components/marketplace/authorize-agent-dialog.tsx) when owner, listing inactive, no active on-chain authorization; KarPro picker via [`verifier-directory.tsx`](../components/verifier/verifier-directory.tsx) `onSelectAgent` mode |
| Owner minimum price | No currency selector on authorize form — `ownerMinPrice1e8` is a raw on-chain scalar until the agent lists (`listOnBehalf` picks currency); label uses [`listingCurrencyCodesForChain`](../lib/marketplace/currency-code.ts); confirmation copy: guaranteed minimum *in the currency the agent chooses* |
| Agent authorization | [`passport-sell-panel.tsx`](../components/passport/passport-sell-panel.tsx) reads `agentAuthorizations(tokenId)` on-chain (not Ponder); an active row replaces Delegate with [`agent-authorization-status.tsx`](../components/marketplace/agent-authorization-status.tsx), showing agent identity, minimum, expiry; **Lower minimum** / **Revoke agent** owner actions |
| Revoke agent gate | **Revoke agent** disabled while listing active; copy: *Return the vehicle from the agent before revoking access* |
| Owner return flow | When owner + active consignment (`agent` non-zero): [`owner-return-request-panel.tsx`](../components/marketplace/owner-return-request-panel.tsx) — **Request return** (`requestReturn`) → 7-day [`return-cooldown-display.tsx`](../components/marketplace/return-cooldown-display.tsx) (live countdown) → **Force return** (`forceReturn`) when elapsed; request button hidden (not disabled) during cooldown; force button disabled until countdown ends; chain `agentAuthorizations` gates force submit; `returnRequestedAt` from Ponder + chain read |
| Delegated vehicles | Owner-only profile tab [`delegated-vehicles-tab.tsx`](../components/profile/delegated-vehicles-tab.tsx) (`?tab=delegated`); badge count = marketplace `GET /owners/:address/authorizations` `total`; sections **Needs attention** → **Awaiting agent** → **Live** → **Past** (`omitWhenEmpty`); rows via shared [`consignment-portfolio-row.tsx`](../components/consignment/consignment-portfolio-row.tsx) + [`lib/consignment/lifecycle.ts`](../lib/consignment/lifecycle.ts); CTA **View** → `/marketplace/{tokenId}` only (revoke/return stay on passport/lot); Ponder-only (owner auth + profile listings + seller auctions) |

#### Agent consignment — KarPro agents

| Rule | Value |
|------|-------|
| Agent dashboard | **Consigned vehicles** tab on `/profile/[handle]` when owner + active KarPro ([`consigned-vehicles-tab.tsx`](../components/profile/consigned-vehicles-tab.tsx)); awaiting marketplace/auction row headers share [`consignment-portfolio-row.tsx`](../components/consignment/consignment-portfolio-row.tsx) + [`lib/consignment/lifecycle.ts`](../lib/consignment/lifecycle.ts) status labels (`Awaiting listing` / `Authorization expired` / auction equivalents); list/edit/create/cancel ops panels unchanged; awaiting section via Ponder `GET /agents/:address/authorizations?hasActiveListing=false` (paginated) + `/passports/batch` enrichment; chain `agentAuthorizations` filters stale rows; **List vehicle** expand → [`agent-list-on-behalf-panel.tsx`](../components/marketplace/agent-list-on-behalf-panel.tsx) with live [`seller-net-calculator.tsx`](../components/marketplace/seller-net-calculator.tsx) (submit blocked when owner minimum not met; `platformFeeBps` chain-read). Active section: **Edit listing** / **Return to owner** ([`agent-update-listing-panel.tsx`](../components/marketplace/agent-update-listing-panel.tsx), [`agent-delist-button.tsx`](../components/marketplace/agent-delist-button.tsx)); read-only [`return-cooldown-display.tsx`](../components/marketplace/return-cooldown-display.tsx) when owner requested return. Past section read-only |
| Agent settlement note | [`agent-update-listing-panel.tsx`](../components/marketplace/agent-update-listing-panel.tsx) — read-only **Direct payment instructions** (chain `settlementNotes`); copy notes owner edits on manage listing; agents set note only at `listOnBehalf` |
| Agent confirm payment | Same [`listing-offers-panel.tsx`](../components/marketplace/listing-offers-panel.tsx) as seller on active consignment listings with direct payment |
| Pro showroom | **Active consignments** teaser on [`/pro/[slug]`](../app/pro/[slug]/page.tsx) (≤100); **View all N consignments →** → public [`/pro/[slug]/consignments`](../app/pro/[slug]/consignments/page.tsx) paginated active fixed-price agent listings ([`getAgentListings`](../app/actions/agent-consignment.ts)); private profile `?tab=consigned` remains agent ops only |

#### Portfolio surfaces (owner · agent · Pro)

Private portfolios share one lifecycle vocabulary ([`lib/consignment/lifecycle.ts`](../lib/consignment/lifecycle.ts): M1/M1e/M2/M2r · A1/A1e/A2/A2r/A3) and row chrome ([`consignment-portfolio-row.tsx`](../components/consignment/consignment-portfolio-row.tsx)). Badge counts and auction visibility differ by surface:

| Surface | Tab / route | Badge or total | Auction |
|---------|-------------|----------------|---------|
| Owner | `?tab=delegated` | [`getOwnerDelegatedCount`](../app/actions/owner-consignment.ts) → `GET /owners/:address/authorizations` `total` (active **marketplace** auths only) | In portfolio (owner auction auths + seller auctions) |
| Agent | `?tab=consigned` | [`getAgentConsignmentCount`](../app/actions/agent-consignment.ts) → `GET /agents/:address/authorizations` `total` (active **marketplace** auths — not listing count, not auction-auth count) | In portfolio (awaiting + active auction sections) |
| Public Pro | `/pro/[slug]` teaser + `/pro/[slug]/consignments` | `activeConsignmentTotal` from `GET /agents/:address/listings?active=true` (active fixed-price listings) | **Not in Pro v1** — catalog is fixed-price listings only |

#### Seller listing management

| Rule | Value |
|------|-------|
| Seller list UI | [`listing-seller-settlement-panel.tsx`](../components/marketplace/listing-seller-settlement-panel.tsx) + [`listing-edit-client.tsx`](../components/marketplace/listing-edit-client.tsx); `encodeCurrencyCode` for `list()` |
| Owner list | Unified [`passport-sell-panel.tsx`](../components/passport/passport-sell-panel.tsx): **List for sale** → `/marketplace/{tokenId}/edit` when the connected viewer is confirmed by `ownerOf` and the chain listing is inactive |
| Seller manage | **Manage listing** → same edit URL when viewer is listing seller (active listing) |
| Seller delist | Handled on the edit page ([`listing-edit-client.tsx`](../components/marketplace/listing-edit-client.tsx)), not inline on listing detail; same `txErrorMessage` error pattern |

---

### 4.17 Verification fee

KarProStaking `verificationFee` is informational on-chain — Kargain does not escrow or enforce payment. Contract reference: [SPEC §I.4](./contracts/SPEC.md). Helpers: [`verification-fee.ts`](../lib/verifier/verification-fee.ts) (`formatVerificationFee`, `verificationFeeToUsd1e8`, `verificationFeeInUsdc`, `verificationFeeInSats`).

#### Display (owners and visitors)

| Surface | Rule |
|---------|------|
| Shared display | [`verification-fee-display.tsx`](../components/verifier/verification-fee-display.tsx) — primary always ETH via `formatVerificationFee`; secondary `≈ {nav currency}` only when fee &gt; 0, nav ≠ ETH, and live rates available (no placeholder dash) |
| Payment method chips | [`VerificationPaymentChips`](../components/verifier/verification-fee-display.tsx) — neutral mono text chips (`ETH`, `USDC`, `Lightning`); **public chips mirror pay-modal segment visibility exactly** ([`paymentMethodChipIds`](../lib/verifier/payment-methods.ts): ETH/USDC when in `acceptedPaymentMethods`; Lightning only when [`showLightningChip`](../lib/verifier/payment-methods.ts)); progressive (no loading skeleton) |
| Verifier directory card | [`VerificationFeeDisplay`](../components/verifier/verification-fee-display.tsx) + [`VerificationPaymentChips`](../components/verifier/verification-fee-display.tsx) in meta row under count / member since; always shown (`0` → *Contact for quote*) |
| Directory sort **Lowest fee** | [`filter-verifiers.ts`](../lib/verifier/filter-verifiers.ts) — ascending `verificationFee`; fee `0` (*Contact for quote*) sorts after all priced entries |
| Directory filter **Accepts Lightning** | Grid layout only — toggle chip; keeps entries where [`showLightningChip`](../lib/verifier/payment-methods.ts) is true on loaded Nostr profile; unloaded profiles excluded while batch fetch is in progress; counter and **Clear filters** include this filter; profiles from [`useNostrProfiles`](../hooks/use-nostr-profiles.ts) (single batched attested subscription via [`resolve-attested-profile.ts`](../lib/nostr/resolve-attested-profile.ts)) |
| Request verification | [`verification-request-button.tsx`](../components/verifier/verification-request-button.tsx) — shared display under button when fee &gt; 0 only |
| Profile stats band | [`profile-verifier-stats-band.tsx`](../components/profile/profile-verifier-stats-band.tsx) — **Verification fee** segment for all visitors; chips when page already has Nostr profile (no extra relay subscription) |
| Pro showroom hero | [`pro-showroom-verification-fee.tsx`](../components/verifier/pro-showroom-verification-fee.tsx) — chain-read `verificationFee` with Ponder fallback; pay button when effective fee &gt; 0 |
| List visibility | Directory cards + list contexts: **Ponder** `feeWei` for pay button visibility (eventual consistency) |
| Single-entity visibility | Pro hero: **chain-read** fee for display and pay button once resolved |

#### Verifier management (`/kar-pro`)

| Rule | Value |
|------|-------|
| Hub layout | Identity strip + sticky section nav — see §4.11 KarPro hub rows; join flow (`KarProJoinForm`) unchanged for non-verifiers |
| Fee composer | [`kar-pro-fee-section.tsx`](../components/kar-pro/kar-pro-fee-section.tsx) — service margin in nav display currency + live `verifyPassport` gas estimate → single wei via `setVerificationFee`; empty / zero margin → *Contact for quote*; gas captured at save only |
| Payment methods | [`kar-pro-payments-section.tsx`](../components/kar-pro/kar-pro-payments-section.tsx) — Nostr kind 0 `verifierPaymentMethods` (`eth` \| `usdc` \| `lightning`); field absent = all three; ≥1 must stay enabled; Lightning enabled requires non-empty valid `lud16` ([`LightningAddressField`](../components/profile/lightning-address-field.tsx)); separate **Save fee** (chain) and **Save payment methods** (Nostr) actions |
| Widget | [`KarProStatusWidget`](../components/profile/karpro-status-widget.tsx) remains read-only links to KarPro hub sections — **Membership →** for stake/leave, **Edit fee →** for fee; writes live in Fee / Payments sections |

#### Pay for inspection (passport owners)

| Rule | Value |
|------|-------|
| Entry points | **Pay for inspection** on `/verifiers` cards (Ponder fee) and `/pro/[slug]` hero (chain-read effective fee); modal re-reads chain on open |
| Modal | [`verification-payment-modal.tsx`](../components/verifier/verification-payment-modal.tsx) — [`Dialog`](../components/ui/dialog.tsx) shell; `useReadContract` → `verificationFee` when open (`effectiveFeeWei`) |
| Method gating | Segments filtered by Nostr `verifierPaymentMethods` ∩ technical checks (USDC config/rates, valid `lud16` for Lightning); absent field = all three; empty intersection → neutral *Contact them to arrange payment* copy |
| Passport step | UNVERIFIED passports from `getProfileData` → dropdown (`formatPassportTitle` + make/model); else manual passport ID input |
| ETH | Native transfer to verifier; `data` = `stringToHex("kargain:verify:{tokenId}")` (human-readable memo on explorers) |
| USDC | ERC-20 `transfer` to verifier; amount from `verificationFeeInUsdc` + live `ethUsd` from [`use-market-rates.ts`](../lib/marketplace/use-market-rates.ts); UI shows passport ID only — honest copy that USDC has no on-chain memo |
| Toggle | Same segmented **Pay with ETH / Pay with USDC** pattern as [`listing-buy-panel.tsx`](../components/marketplace/listing-buy-panel.tsx) |
| Trust copy | Modal disclaimer: payment goes directly to verifier; Kargain does not hold funds; verification is separate on-chain step |
| Success | Confirmation in modal; no navigation away |
| Hidden | No pay button when fee is `0`, when viewer is the verifier, or on agent-picker card layout |

#### Pay with Lightning (passport owners)

| Rule | Value |
|------|-------|
| Visibility | Third segment **Pay with Lightning** when `"lightning"` ∈ accepted methods and verifier kind 0 has valid `lud16` |
| Rates | `useMarketRates({ enabled: open })`; sats from `verificationFeeInSats(effectiveFeeWei, ethUsd, btcUsd)` — mono `tabular-nums`; ETH fee as secondary line |
| Invoice | Server proxy [`/api/lightning/lnurl-pay`](../app/api/lightning/lnurl-pay/route.ts); comment `kargain:verify:{tokenId}` when provider allows |
| QR | [`QrCode`](../components/ui/qr-code.tsx) on `bg-white` plate (scannability exception on dark theme); copy invoice + `lightning:` deeplink (`ctaLink`) |
| Verify | Poll [`/api/lightning/lnurl-verify`](../app/api/lightning/lnurl-verify/route.ts) every 3s when provider returns LUD-21 `verify` URL; else neutral copy that Kargain cannot confirm Lightning payment |
| NWC one-click | When buyer has connected NWC ([`use-nwc-wallet.ts`](../hooks/use-nwc-wallet.ts)): primary **Pay from connected wallet** above QR; pending *Waiting for your wallet…*; inline errors per mapping below; QR/copy/deeplink remain fully usable |
| NWC connect (modal) | When not connected: muted link *Connect a Lightning wallet for one-click payments* → inline [`NwcConnectField`](../components/profile/nwc-connect-field.tsx) paste + connect |
| NWC errors | `rejected` → *Your wallet declined the payment.* · `insufficient_balance` → *Insufficient wallet balance.* · `timeout` → *No response from your wallet. Check the wallet app.* · `unlock_declined` → *Approve the signature request to pay from your connected wallet.* · `relay_unreachable` / `invalid_response` / `unsupported` → *Could not reach your Lightning wallet.* |
| NWC success | Sets modal success when not already success; copy *Payment sent from your connected wallet.* (LUD-21 poll may win first) |
| NWC storage | Encrypted URI in IndexedDB `kargain_nostr` / store `secure` record `kargain_nwc_connection_v1:{address}`; presence flag only in `localStorage` `kargain_nwc_present_v1:{address}`; unlock via sign `kargain-nwc-v1:{address}` |
| Trust | Same modal disclaimer as ETH/USDC; comment delivery provider-dependent |
| LNURL proxy security | Server-only proxy ([`guarded-fetch.ts`](../lib/lightning/guarded-fetch.ts), [`ip-guard.ts`](../lib/lightning/ip-guard.ts), [`lnurl.ts`](../lib/lightning/lnurl.ts)): https-only callbacks, port 443, no redirects, 5s timeout, 64KB body cap, strict JSON parse + invoice-amount check; DNS-rebinding closed via connection-time IP validation — pinned undici lookup always resolves with `all: true`, validates every resolved address with its real family (4 or 6), rejects private/reserved ranges and unrecognized families at socket connect |

### 4.18 Auction commerce

Reserve auctions on AuctionEscrow. **Canonical lot URL** remains `/marketplace/[tokenId]`; browse at `/auctions`. Module domain: [`lib/auction/`](../lib/auction/). Nav link gated by `auctionEscrowAddress(chainId)` — top nav on all breakpoints (`GavelIcon` icon-only below `md`).

**г-1 + г-2 + г-3 + г-4 shipped:** browse, native + USDC bid, direct KarPro create, permissionless Finalize / void, agent authorize / create-on-behalf / cancel / return + U7, settlement hold / dispute / refund (S6–S9) + U8/U9, consigned-tab auction sections, extension flash / outbid toast / InstrumentTimeline bid history / mobile commerce order. **Auction UI initiative complete.**

#### Unified owner sell group

[`passport-sell-panel.tsx`](../components/passport/passport-sell-panel.tsx) is the sole owner sale-start surface on the passport page. `PassportCommerce` mounts it only in the non-auction branch. The fixed-price and auction islands retain active commerce and management, but render no owner sale-start CTA.

- One neutral Level B frame headed **Sell this vehicle**, ordered **Fixed price** → **Delegation** → **Auction**.
- Fixed price shows **List for sale**. Delegation shows **Delegate to a pro**, replaced by the existing marketplace authorization status card while authorization is active.
- The auction row shows a quiet text-only verification requirement for an owner of a non-VERIFIED passport when auction escrow is configured. For a VERIFIED passport, an active KarPro owner sees the direct create panel; another owner sees **Authorize auction agent**. An active auction authorization takes precedence over both and renders [`auction-agent-authorization-status.tsx`](../components/auction/auction-agent-authorization-status.tsx): agent, asset minimum, expiry, neutral expired tag, and **Manage** opening the existing revoke-capable dialog.
- Expiry does not hide an active authorization card: expired authorization remains owner-revocable, while agent create remains disabled.
- Owner, listing, authorization, verifier, auction, and open-hold facts are chain-read with explicit `chainId`. Each row fails closed while its required fact is unresolved or unavailable; Ponder fallback never enables a new owner write. Dialog callbacks refetch the panel reads, and auction changes also invalidate shared auction detail.
- [`sell-surface.ts`](../lib/passport/sell-surface.ts) is the pure seven-flag visibility policy. Successful inactive chain listing state is required for the group; active listing, live auction, settlement hold, or non-owner returns all flags false.

#### Copy (verbatim catalog subset)

| Surface | Gate | Copy |
|---------|------|------|
| Owner **Sell this vehicle** Auction row; Manage listing Delist section | Auction escrow configured and passport status known non-VERIFIED | *Reserve auctions require a verified passport. Get this vehicle verified by a KarPro to enable auctions.* |
| Manage listing Delist section | Auction escrow configured and passport VERIFIED, or status unavailable | *To start a reserve auction, delist this fixed-price listing first.* |

#### Role matrix

| Role | Sees | Can do |
|------|------|--------|
| Viewer / bidder | Reserve, current bid, min next, countdown, bid history; return advisory when set (S2); hold readout | Bid (ETH or USDC); Finalize when ended; permissionless `releaseFunds` when hold/dispute timed out |
| Leading bidder | Same + *You are the highest bidder* (neutral, not accent) | Wait / bid again if outbid |
| Winning buyer (hold) | Hold amount · release countdown | Confirm receipt · Open dispute (native bond, U8) · after ConfirmFailure: return passport for refund |
| KarPro direct seller | Own-lot create panel; settlement informational | `createAuction` when VERIFIED, not listed, active verifier, no open hold (U9); Cancel before first bid; cannot bid; abandoned-refund claim |
| Private owner (agent path) | Authorization entry; return timer on agent auction | Authorize auction agent · Revoke (no active auction) · Request / force return (pre-start); U9 blocks authorize during hold |
| KarPro agent | Consigned **Awaiting auction** / **Active auctions**; lot create panel when authorized | `createAuctionOnBehalf` · Cancel before first bid |
| Active verifier (not party) | Dispute frozen readout | Minimal resolve: ReleaseToSeller / ConfirmFailure (full resolver post-MVP) |

#### Derived states (blueprint S#)

Chain `endsAt` wins over Ponder for timers. Ponder has **no `ENDED` phase**. Chain `returnRequestedAt` merges over Ponder for S2. Settlement sub-states from [`settlement-state.ts`](../lib/auction/settlement-state.ts) (Ponder settlement ∪ chain `holds` ∪ timeouts).

| State | Condition | Commerce |
|-------|-----------|----------|
| **S1** | Awaiting first bid (`startedAt=0`) | Bid (min = reserve); seller/agent: Cancel |
| **S2** | S1 + `returnRequestedAt` set | Same — bidding stays open; elevated advisory to **all** viewers |
| **S3** | Live bidding | Bid panel; no cancel |
| **S4** | Live + passport `DISPUTED` | Bid **disabled**; `status-error` copy |
| **S5** | Derived `ENDED` = `phase BIDDING && now ≥ endsAt(chain)` (U15) | **Finalize auction** → `settle`; if passport `UNVERIFIED` → `voidAuction` |
| **S6 / HOLD** | `SETTLED`, before `releaseAt`, no dispute | Buyer: Confirm receipt · Open dispute; others: informational payout date |
| **HOLD_RELEASABLE** | `now ≥ releaseAt`, no dispute | Permissionless **Release payment** → `releaseFunds` |
| **S7 / DISPUTED** | Settlement dispute open | *Payout frozen*; auto-release date; minimal verifier resolve |
| **DISPUTE_TIMED_OUT** | `now ≥ disputedAt + disputeResolutionTimeout` | Permissionless **Release payment** (auto-ReleaseToSeller path) |
| **REFUND_PENDING** | ConfirmFailure | Buyer: approve passport → `returnPassportAndRefund`; seller: `claimAbandonedRefund` after `settlementHold` |
| **S8** | `RELEASED` | Split readout (platform / agent / seller) + post-sale checklist |
| **S9** | `VOIDED`\|`CANCELLED`\|`RETURNED` | Distinct terminal copy per phase (see catalog); no bids-refunded claim for cancel/return |

**Mutex:** auction island XOR listing buy panel (`PassportCommerce`). Live auction `uiState` hides the entire owner sell group; chain listing truth hides all new sale-start choices while Marketplace holds the NFT — create requires delist first (custody/`NotOwner`). Auction creation/authorization also stays hidden while `holds.releaseAt ≠ 0` (U9). An unlisted KarPro sees **List for sale** and the direct create panel together inside **Sell this vehicle** (sale-form choice). Seller (listed) sees the status-aware neutral hint from the catalog above under Delist on the edit page when auction escrow is deployed. If Ponder status is unavailable, the page keeps the existing delist-before-auction hint and adds no error surface.

#### Settlement (г-3)

| Surface | Behavior |
|---------|----------|
| USDC bid | [`auction-bid-panel.tsx`](../components/auction/auction-bid-panel.tsx) — allowance → `approve(escrow, amount)` → `bid` with `value: 0`; balance preflight; amount in 6-decimal units |
| Settlement panel | [`auction-settlement-panel.tsx`](../components/auction/auction-settlement-panel.tsx) — role-gated S6–S9 / refund / minimal resolver |
| State derive | [`settlement-state.ts`](../lib/auction/settlement-state.ts) — pure `HOLD`…`CLEARED` from settlement + `holds` + timeouts |
| U8 | Dispute bond always **native ETH** from chain `settlementDisputeBond`, even on USDC lots — labeled in Open dispute CTA |
| U9 | Create + authorize disable when `holds(tokenId).releaseAt ≠ 0` + settlement-window advisory |
| Resolver (minimal) | Visible only when connected wallet is active KarPro **and** not buyer/seller/agent |
| Poll | Detail 15s while settlement `HOLD` / `DISPUTED` / `REFUND_PENDING` and tab visible; never after `RELEASED` / `CLEARED` |

#### Live polish (г-4)

| Surface | Behavior |
|---------|----------|
| Countdown | Chain `endsAt` via detail merge; single `useNow(1s)` on lot; absolute remaining (no drift between refetches) |
| Extension flash | On detail refetch when `endsAt` increases while S3/S4: *Extended by [N] minutes* (`N` from chain `extensionWindow`); reserved slot on readout + bid help; `aria-live="polite"`; auto-clears; **no extra polling** |
| Outbid toast | When connected wallet lost `highestBidder` across refetch: StatusToast *You were outbid. Your [amount] was returned…*; once per lead (`sessionStorage`); `role="status"`; neutral tokens |
| Bid history | [`auction-bid-history.tsx`](../components/auction/auction-bid-history.tsx) — `InstrumentTimeline` ticks; neutral borders (no success-green) |
| Mobile order | Passport detail: commerce `order-1` / `md:hidden` before gallery on `< md` (§12.5); desktop sticky aside unchanged |

#### Agent consignment (г-2)

| Surface | Behavior |
|---------|----------|
| Authorize | Unified sell group opens [`authorize-auction-agent-dialog.tsx`](../components/auction/authorize-auction-agent-dialog.tsx) — approve auction escrow → KarPro picker → asset + `ownerMinAsset` in **asset units** (U4) → `authorizeAuctionAgent`; active authorization becomes an always-visible neutral status card; **Manage** opens inline **Revoke** when no active auction |
| Create on behalf | [`agent-create-auction-panel.tsx`](../components/auction/agent-create-auction-panel.tsx) — chain-read auth (U2); asset locked; reserve / 3–7 d / commission ≤ 30%; net preview at reserve; blocked when `BelowOwnerMinAsset` |
| Cancel (S1) | [`auction-cancel-panel.tsx`](../components/auction/auction-cancel-panel.tsx) — seller `cancelAuction` / agent `agentCancelAuction` while `startedAt == 0` |
| Owner return | [`owner-auction-return-panel.tsx`](../components/auction/owner-auction-return-panel.tsx) — `requestReturn` → 7-day cooldown → `forceReturn` (pre-start only) |
| Return advisory (U7) | [`auction-return-advisory.tsx`](../components/auction/auction-return-advisory.tsx) — elevated advisory to all when `returnRequestedAt` set and pre-start |
| Consigned tab | Awaiting: `GET /agents/:address/auction-authorizations?awaiting=true` (expired badge client-side); Active: `GET /auctions?agent=&active=true`; **no per-row chain reads** |

#### Copy (verbatim catalog subset)

| Surface | String |
|---------|--------|
| Bid footer | Your full bid is held by the auction contract until you are outbid or you win. Outbid funds return automatically. |
| Live help | Bids in the last [N] minutes extend the auction by [N] minutes. (`N` from `extensionWindow`) |
| Extension flash | Extended by [N] minutes |
| Outbid toast | You were outbid. Your [amount] was returned to your wallet automatically. |
| Leading | You are the highest bidder. |
| S1 help | The auction starts when someone bids at least the reserve. Until then the seller can cancel. |
| S2 advisory | The owner has asked for this vehicle back. If no one bids before [date], the auction can be cancelled. A qualifying bid before then completes the sale. |
| Cancel guard | You can cancel only before the first qualifying bid. |
| Authorize min help | Your minimum is in the auction currency ([ETH]/[USDC]), not a display price. You receive at least this amount after all fees. |
| Agent net preview | At reserve [X]: you receive [fee], owner receives [net]. Your commission is fixed for the whole auction. |
| S4 | Bidding is paused while this passport is disputed. If the dispute is rejected the auction resumes; if confirmed, the auction is voided and every bid is refunded. |
| S5 | Auction ended. Anyone can finalize: the vehicle transfers to the winner and payment enters a 7-day protection hold. |
| Hold — buyer | [2.40 ETH] is held for your protection until [date]. Confirm receipt to release payment early, or open a dispute if the vehicle was not delivered as sold. |
| Hold — seller/agent | Payment is released when the buyer confirms receipt, or automatically on [date]. |
| Dispute bond (U8) | Opening a dispute locks a [0.01 ETH] bond, even for USDC auctions. You get it back if the dispute is confirmed. |
| Released (S8) | Sale complete. [gross] split: seller [net] · agent [fee] · platform [fee]. |
| Cancelled (S9) | The auction was cancelled before any qualifying bid. The vehicle returned to the owner. |
| Returned (S9) | The owner recalled this vehicle before any qualifying bid. |
| Voided (S9) | Auction voided — [reason]. All bids were refunded automatically. |
| Post-sale checklist | Vehicle re-registration happens off-chain. Keep the passport records updated after handover. |
| Settlement window (U9) | This vehicle’s previous sale is still in its settlement window. You can start a new auction after [date]. |
| Create intro | Auctions are open to professional sellers with verified vehicles. The reserve is public and bidding starts at or above it. |
| Reserve help | Lowest price you will accept. Shown to everyone. |
| Asset help | Bids and payout are in one currency for the whole auction. USDC is recommended for expensive vehicles. |
| Card no bid | Reserve not met · Awaiting first bid |

#### Accent and Instrument Layer

- Bids, reserves, prices, leading strip, mins/nets/fees: `font-mono tabular-nums` + `text-text-primary` — **never** accent-warm.
- Accent-warm only trust seals (`PassportStatusBadge` VERIFIED).
- DISPUTED mid-auction / settlement *Payout frozen*: `text-status-error` panel.
- S2 return advisory / U9 settlement window: elevated advisory pattern (not `status-error` unless DISPUTED).
- S8 released split: `commerceConfirmedPanel` / neutral mono (IL-5).
- Extension flash / outbid toast: neutral `text-text-secondary` + `border-border-default` — **not** accent-warm (not trust states).
- Countdown in `<time dateTime>`; bid/tx errors `role="alert"`; extension flash / outbid `aria-live="polite"` / `role="status"`.
- Money CTAs show exact asset + amount in mono; dispute bond always labeled as native ETH (U8).

#### Indexer notes

| Id | Rule |
|----|------|
| **U4** | Auction `ownerMinAsset` is asset units (wei / USDC 6) — [`owner-min-asset.ts`](../lib/auction/owner-min-asset.ts); never fiat 1e8 helpers |
| **U2** | Unified owner sell group and agent-create island chain-read `auctionAgentAuthorizations`; dialog re-reads on open and owns authorize/revoke writes |
| **U7** | Return timer visible to all viewers when `returnRequestedAt` set |
| **U8** | Settlement dispute bond is always native ETH — label even on USDC auctions |
| **U9** | `holds(tokenId).releaseAt ≠ 0` gates create + authorize with settlement-window copy |
| **U11** | Bid history filters `bid.timestamp ≥ auction.createdAt` (re-auction append-only bids) |
| **U13** | Browse partitions live (`endsAt` asc) then awaiting-first-bid (`createdAt` desc) — API `asc(endsAt)` alone is wrong for `endsAt=0` |
| **U15** | Derive ENDED client-side; Finalize CTA in г-1 |

#### Performance budget

| Surface | Budget |
|---------|--------|
| `/auctions` cards | 0 chain reads, 0 subscriptions; one shared minute ticker |
| Lot commerce | Shared detail uses one batched `useReadContracts` (incl. return + settlement config); agent-create island retains its auth read; owner sell group reads owner/listing/auth/verifier once and refetches on its writes; detail poll 15s / bids 7s when S1–S4 **or** settlement poll-active **and** tab visible; `staleTime ≥ 30s` |
| Consigned auction lists | Ponder only — 0 per-row chain reads |
| FX / discussion / live signals | Reuse nav FX + existing discussion rail; **0** new oracle or Nostr/XMTP subscriptions; extension flash + outbid toast derive from existing detail refetch only |
| No websockets | — |

Implementation: [`components/auction/`](../components/auction/) · [`hooks/use-auction-detail.ts`](../hooks/use-auction-detail.ts) · [`auction-bid-math.ts`](../lib/auction/auction-bid-math.ts) · [`auction-agent.ts`](../lib/auction/auction-agent.ts) · [`settlement-state.ts`](../lib/auction/settlement-state.ts).

### 4.19 Passport bridge panel

Hub→spoke bridge on the passport commerce rail (Base Sepolia → Ethereum Sepolia). On-chain truth: [SPEC §7](./contracts/SPEC.md) and [I.9.2](./contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111) — this section is the UI contract only.

| Surface | Contract |
|---------|----------|
| Mount | [`PassportBridgePanel`](../components/passport/passport-bridge-panel.tsx) after the sell/auction stack in [`passport-commerce.tsx`](../components/passport/passport-commerce.tsx) |
| Visibility | Pure [`deriveBridgeSurface`](../lib/passport/bridge-surface.ts) — owner only; hub chain 84532; listing inactive; auction not blocking; not DISPUTED; fail-closed when listing or auction reads are unresolved; DISPUTED wins over listed/auction for `blockReason` |
| Quote / fee | Mono `tabular-nums` (Instrument Layer); native fee reflects URI-length lzReceive `extraOptions` (pathway enforcedOptions remain the floor) |
| Flow | Approve (if needed) → quote → send via shared `useTxSync` / `runFlow`; pending = spoke RPC `ownerOf` poll (not Ponder); LayerZero Scan GUID link when available |
| Spoke | Informational only (*Return to Base Sepolia to bridge…*) — no spoke write path in the app |
| Errors | Shared [`tx-error-message`](../lib/marketplace/tx-error-message.ts) plus bridge-specific `PassportDisputed` copy |
| Boundary | [`lib/web3/bridge/`](../lib/web3/bridge/) + generated ABIs; no `@layerzerolabs/*` in `app/`, `hooks/`, or non-bridge `lib/` |

**Non-goals:** spoke→hub return UI; Ponder indexing of 11155111; marketplace or commerce on spoke; “bridged away” profile ownership (separate initiative).

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

**Standard:** vendored Mono Icons via [`components/ui/icons.tsx`](../components/ui/icons.tsx), regenerated by [`pnpm generate:icons`](../package.json) ([`scripts/generate-icons.mjs`](../scripts/generate-icons.mjs) — mono glyph whitelist in `GLYPHS`, Lucide bridge list in `LUCIDE_BRIDGE`). **Attribution:** Mono Icons (MIT, [icons.mono.company](https://icons.mono.company)); Lucide bridge glyphs from `lucide-static` (ISC).

**Sizing:** use the `size` prop — **16** (inline), **20** (buttons, nav), **24** (decorative). Color via `className` + `currentColor` (`text-text-secondary`, `text-accent-warm`, `text-status-error`, etc.). Do not pass `strokeWidth` — the mono set is filled; nine lucide-bridge components render stroke mode internally: `BookmarkCheckIcon`, `CheckDoubleIcon`, `GavelIcon`, `GlobeIcon`, `ReplyIcon`, `ShieldIcon`, `ShieldWarningIcon`, `ShieldCheckIcon`, `WalletIcon`.

**Loading:** `SpinnerIcon` (alias of mono `spinner`); add `animate-spin` at the call site.

**Glyph semantics:**

| Export | Product meaning |
|--------|-----------------|
| `GavelIcon` | **Auctions** nav |
| `ShieldCheckIcon` | Passport / listing **VERIFIED** |
| `ShieldWarningIcon` | **DISPUTED** (`text-status-error`) |
| `UserCheckIcon` | **KarPro** membership |
| `WarningIcon` | Generic advisory |
| `CheckDoubleIcon` | Read receipts |
| `ReplyIcon` | Comment thread reply action |

Decorative icons: `aria-hidden="true"`. Meaningful icon-only controls: `aria-label` on the button/link, not on the SVG.

**Enforcement:** ESLint `no-restricted-imports` blocks `lucide-react` in app code — import from `@/components/ui/icons` only.

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

## 10. Instrument Layer

Kargain's UI treats verified on-chain facts as **instrument readings** — precise, mono, status-colored — not marketing copy. This section governs how factual and status data is distinguished from narrative or decorative UI. It does not replace §4 component layout contracts; when §4 and §10 conflict on factual typography or accent usage, **§10 wins** for those properties.

**Philosophy and rollout:** [§11 Design philosophy](#11-design-philosophy) · [§12 Implementation roadmap](#12-instrument-layer--implementation-roadmap) · [§13 Mobile layout contracts](#13-mobile-layout-contracts)

---

### 10.1 Data typography

All on-chain and factual fields render in `font-mono` with `tabular-nums` on numeric values. **No sans-serif exceptions** for the field types below.

| Field type | Examples | Canonical classes |
|------------|----------|-------------------|
| Token / chain identifiers | Passport token ID, ProPass token ID, chain suffix | Serial: `font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary` (see §10.2) |
| Transaction / block data | Tx hash, block number | `font-mono text-fluid-sm font-normal tabular-nums text-text-primary` (§3 Mono numeric) or `font-mono text-xs` in dense rows |
| Wallet addresses | ENS name sub-line, `shortAddress`, `navShortAddress` | `font-mono text-xs text-text-secondary` or `font-mono text-sm text-text-secondary` |
| Timestamps | Record dates, notification times, message times | `font-mono tabular-nums` + `text-text-tertiary` or `text-text-secondary` (see §10.4) |
| Browse / asking price | Listing card, detail sidebar | `font-mono text-lg font-medium tabular-nums text-text-primary` |
| Fee lines | Verification fee, checkout disclosure amounts | `font-mono text-xs text-text-secondary` (compact contexts) or `font-mono text-sm text-text-secondary` (pro showroom hero, profile stats band) |
| Vehicle spec values | VIN, mileage, year, spec grid values | `font-mono text-sm font-normal text-text-primary` (labels: §3-style tertiary uppercase mono) |

**Cross-reference:** §3 **Mono numeric** and **Code inline** rows remain the base scale for non-status factual text.

**Passport token ID serial:** [`passport-id-label.tsx`](../components/passport/passport-id-label.tsx) `variant="eyebrow"` is documented here as **serial** styling (tertiary mono, never accent). The component prop name is unchanged.

**ProPass token ID serial:** [`pro-pass-id-label.tsx`](../components/kar-pro/pro-pass-id-label.tsx) — short holder address via `shortAddress`; same tooltip rule as passport (full decimal on hover).

**Narrative eyebrows vs serials:** §3 **Caption / eyebrow** (`text-accent-warm`, global `.eyebrow`) applies to **narrative page and section labels** only (§4.6 page intros, form section headers) — not to on-chain serial numbers or factual metadata.

**Relative time:** Canonical formatter: [`lib/format/relative-time.ts`](../lib/format/relative-time.ts) `formatRelativeTime`. Display output with `font-mono tabular-nums`. Local duplicate formatters (e.g. profile dispute cards) are Phase-2 technical debt — not part of this spec amendment.

---

### 10.2 Accent as status, not decoration

`accent-warm` is reserved for an **actively verified, confirmed, or active** trust state. It is never used for prices, category/metadata labels, passport serial numbers, or as a resting link color.

| Use case | Accent allowed? | Canonical classes |
|----------|-----------------|-------------------|
| Browse / asking price | No | `font-mono text-lg font-medium tabular-nums text-text-primary` |
| Fee lines (verification, checkout disclosure) | No | `font-mono text-xs text-text-secondary` compact; `font-mono text-sm text-text-secondary` pro showroom / profile stats (emphasis within mono: `text-text-primary`) |
| Listing card price hover | No | No `group-hover:text-accent-warm` on price amounts |
| Passport token ID serial | No | `font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary` |
| KarPro **membership** badge (verified pro) | Yes | [`KarProBadge`](../components/ui/kar-pro-badge.tsx) / [`PassportStatusBadge`](../components/ui/passport-status-badge.tsx) VERIFIED: `border-accent-warm text-accent-warm` |
| KarPro **category** (broker type, etc.) | No | `font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary` |
| Wallet / ENS / shortAddress links | Hover / focus only | Rest: `font-mono text-text-secondary`; `:hover` / `:focus-visible`: `text-accent-warm` |
| DISPUTED labels / badges | No | `status-error` only — see §10.3 |
| Nav / control focus rings | Yes (non-decorative) | `--focus-ring`, input focus `border-accent-warm` per §4 |

**Never accent:** prices, category/metadata labels, serial numbers, resting link color, DISPUTED state.

---

### 10.3 Status color single-source

| State | Border | Text / icon | Notes |
|-------|--------|-------------|-------|
| VERIFIED / active on-chain confirmed | `border-accent-warm` (badges; VERIFIED listing card border per §4.10) | `text-accent-warm` | Status indicator only |
| DISPUTED | `border-status-error` or `border-status-error/40` | `text-status-error` | **No accent-warm exception** — includes `DisputeStatusSection` status label in [`passport-detail-view.tsx`](../components/passport/passport-detail-view.tsx) |
| UNVERIFIED / neutral | `border-border-default` | `text-text-tertiary` or `text-text-secondary` | |
| Caution / advisory (display-only) | `border-status-warning` (or `border-status-warning/40` where a softer panel is needed) | `text-status-warning` (icon); body may use `text-text-primary` / `text-text-secondary` | Non-gating caution — see sub-table below |
| Purchase / external payment confirmed | `border-status-success/40` (`commerceConfirmedPanel`) | `text-status-success` (`commerceConfirmedLabel`) | Post-confirmation commerce only — §12.7 |
| Informational (prior dispute resolved, indexer sync, etc.) | `border-border-default` | `text-text-secondary` | Informational (prior dispute resolved, indexer sync pending, dispute withdrawn signal, KarPro open disputes banner, messaging activation drift banner body, messaging setup / account setup nudges, XMTP unread catch-up, profile identity relink card) — `border-border-default` / `text-text-secondary` — Not accent. These are neutral operational or historical context, not caution signals — do not upgrade to `status-warning` without a product decision changing their meaning. |

#### Gated acknowledgments (`status-error`)

Non-FSM signals that **block** an action or require an explicit checkbox acknowledgment before the user can proceed. Color axis: gate behavior, not subsystem.

| Signal | Trigger | Gate mechanism |
|--------|---------|----------------|
| UNVERIFIED / DISPUTED at buy time | `passportStatus` | [`needsBuyRiskAck`](../lib/passport/trust-signals.ts) → [`BuyRiskModal`](../components/marketplace/buy-risk-modal.tsx) checkbox required |
| Duplicate VIN at buy time | Indexer `vin_index` duplicate detection | Same `needsBuyRiskAck` → `BuyRiskModal` checkbox required |
| Verified save — identity change ack | Client: VERIFIED + identity-field diff | [`metadata-change-confirm-dialog.tsx`](../components/passport/metadata-change-confirm-dialog.tsx) checkbox required |
| Seller-net below minimum | Client: `satisfiesOwnerMin` calculation | Blocks agent list/update submit |

Modal risk-list items inside `BuyRiskModal` use `border-status-error/30` + `text-text-primary` (not full `text-status-error`) — shipped pattern for UNVERIFIED, DISPUTED, and duplicate VIN rows inside that modal; do not change. The `hadDispute` informational row inside the same modal ([`buy-risk-modal.tsx`](../components/marketplace/buy-risk-modal.tsx)) keeps informational styling; the gate is modal-level.

#### Elevated advisory, fraud-adjacent (display-only, `status-error` chroma)

High-salience indexer/client signals that are **not** DISPUTED FSM but must not be confused with VERIFIED accent. Canonical classes: `elevatedAdvisoryChip`, `elevatedAdvisoryPanel`, `elevatedAdvisoryText` in [`instrument-classes.ts`](../lib/design/instrument-classes.ts).

| Signal | Trigger | Surfaces |
|--------|---------|----------|
| Duplicate VIN | Indexer `vin_index` duplicate detection | [`listing-card.tsx`](../components/marketplace/listing-card.tsx) chip; [`passport-instrument-readouts.tsx`](../components/passport/passport-instrument-readouts.tsx); [`passport-actions-panel.tsx`](../components/passport/passport-actions-panel.tsx) |

Chip: `border-status-error/40`, `bg-status-error/10`, `text-status-error`. Panel: same border + tint fill. Buy-time acknowledgment remains gated in `BuyRiskModal` only (table above) — display surfaces use full error chroma; the modal list keeps `border-status-error/30` + neutral body text.

#### Caution, display-only (`status-warning`)

| Signal | Trigger |
|--------|---------|
| Metadata updated after verification (reset count) | Indexer `verificationResetCount` — already shipped on `status-warning` in [`passport-trust-banner.tsx`](../components/passport/passport-trust-banner.tsx) |
| On-chain vs indexer status drift (passport detail only) | Client `compareListingStatus` / chain RPC vs Ponder — [`passport-chain-status-banner.tsx`](../components/passport/passport-chain-status-banner.tsx) |
| Verifier inactive | On-chain `isActiveVerifier` false |
| Re-inspection recommended | Client `recommendsReInspection` — **spec target**: currently neutral `border-border-default`; moves to `status-warning` in a follow-up code pass |
| Smart-wallet upload preflight | Client: contract account kind — **spec target**: currently `status-error` border; downgrades to `status-warning` in a follow-up code pass (not gated, was over-colored) |
| Identity metadata diff summary (pre-save display, outside the confirm dialog) | Client metadata diff — dual with the gated dialog above |
| Messaging nav unread dot | Client unread total — already shipped on `status-warning` in [`messaging-nav-status.tsx`](../components/messaging/messaging-nav-status.tsx) |

Where a signal appears in both the gated-acknowledgment table and the elevated-advisory table (duplicate VIN), display surfaces use elevated-advisory error chroma; only the gating component (`BuyRiskModal`) uses the modal list pattern. Identity diff: display uses `status-warning`; gate uses [`metadata-change-confirm-dialog.tsx`](../components/passport/metadata-change-confirm-dialog.tsx). Where a gating dialog is preceded by an earlier informational/caution banner about the same consequence, the earlier banner's color reflects what *that element* does, not the downstream gate — e.g. [`edit-passport-wizard.tsx`](../components/passport/edit-passport-wizard.tsx) inline verified-anchor warning targets `status-warning`; the gate is [`metadata-change-confirm-dialog.tsx`](../components/passport/metadata-change-confirm-dialog.tsx).

**§4.14 amendment:** Disputed passport layout (`DisputeStatusSection`) must use `status-error` for the status label. Any `text-accent-warm` on a "Disputed" eyebrow is non-compliant once component code catches up.

**Record / timeline log items:** No success chroma on entries — neutral `border-border-default` only. Do not use `border-emerald-500` or other non-token greens. `status-success` is reserved for commerce-confirmed readouts (§12.7), not passport log ticks. Verification-reset ticks in URI history follow the same log-neutral rule — `border-border-default`, no `status-error` on border or label. The event remains legible via the row's text label; log visual language does not carry status chroma at any severity.

**Token parity:** `--color-status-success` / `status-success` in [`lib/design-tokens.ts`](../lib/design-tokens.ts) and [`instrument-classes.ts`](../lib/design/instrument-classes.ts) (`commerceConfirmedPanel`, `commerceConfirmedLabel`, `trustStampSuccess`) — **shipped** IL-5. `--color-status-warning` / `status-warning` in [`app/globals.css`](../app/globals.css) **must differ** from `--color-accent-warm` (caution amber vs verified gold). Elevated advisory surfaces use existing `--color-status-error` / `status-error` — no new token. Canonical elevated-advisory classes in [`instrument-classes.ts`](../lib/design/instrument-classes.ts). Existing `status-warning` usage in [`passport-trust-banner.tsx`](../components/passport/passport-trust-banner.tsx) (metadata reset) and [`messaging-nav-status.tsx`](../components/messaging/messaging-nav-status.tsx) (unread dot) remains compliant after the warning hex decoupling.

---

### 10.4 Log vs feed

Two intentional visual languages. Do not merge notification row structure into the passport timeline component.

| Pattern | Purpose | Reference implementation | Visual language |
|---------|---------|--------------------------|-----------------|
| **Log** | Immutable on-chain history | [`passport-log-section.tsx`](../components/passport/passport-log-section.tsx) via [`passport-records-timeline.tsx`](../components/passport/passport-records-timeline.tsx) and [`passport-uri-history.tsx`](../components/passport/passport-uri-history.tsx) | Chronological entries; Level A `bg-bg-surface` shell; Level B list items on `bg-bg-primary/80` (§10.6) |
| **Feed** | Ephemeral alerts / social activity | [`notifications-client.tsx`](../components/notifications/notifications-client.tsx), [`notification-row.tsx`](../components/notifications/notification-row.tsx) | Grouped rows; unread affordances; distinct from log layout |

**Shared rule:** All timestamps in log and feed patterns use `font-mono tabular-nums` (with `text-text-tertiary` or `text-text-secondary` as appropriate).

**Log-neutral rule:** Verification-reset ticks in URI history ([`passport-uri-history.tsx`](../components/passport/passport-uri-history.tsx)) use `border-border-default` and neutral label text — no status chroma on borders or labels. The event is legible via the "Verification reset" row label; at scale, red-bordered log rows would visually compete with DISPUTED, which this separation exists to prevent (see §10.3 record/timeline log items).

**Status:** §4.12 Messages timestamps and the components covered by the mono-timestamp session are already in compliance with this rule if that session's changes are present in the working tree (verify per step 4 above) — if so, do not add a "supersedes/stale" note here, since there is nothing stale to flag.

---

### 10.5 Iconography

No literal vehicle iconography (car, wheel, road silhouettes) in **system chrome**. Prefer abstract instrument or navigation motifs (brackets, ticks, coordinates, compass).

| Item | Status |
|------|--------|
| Mobile bottom nav Marketplace tab | **`grid`** (Mono Icons `GridIcon`) — shipped in [`mobile-bottom-nav.tsx`](../components/shell/mobile-bottom-nav.tsx) |
| §4.8 Marketplace icon | `GridIcon` on bottom nav — marketplace discovery motif (§11.2) |

Icon sizing and semantics: §7 Iconography.

---

### 10.6 Container scale

Three padding levels, one radius. **Radius** is uniform (`rounded-md`) across all card, panel, and row containers — no `rounded-sm` on those surfaces. `rounded-full` remains reserved for pills, avatars, and circular icon holders (out of scope here).

| Level | Radius | Padding | Use for |
|-------|--------|---------|---------|
| **A — Primary card** | `rounded-md` | `p-6` (`md:p-8` where already present) | Self-contained top-level unit: listing card, verifier directory card, pro showroom card, passport log section, generic [`Card`](../components/ui/card.tsx) primitive |
| **B — Panel** | `rounded-md` | `p-4` | Functional sub-panel: buy-panel blocks, banners/alerts, side panels, log list items |
| **C — Dense row** | `rounded-md` | `p-3` or `px-4 py-3` (keep existing horizontal/vertical split where present) | Compact list row: verifier picker, profile passport row, inbox row, consignment row |

**Background:** `bg-bg-card` for Level A primary cards and banners that carry a status/trust signal (trust banner, chain-status banner, pro mini-card). `bg-bg-surface` for Level B/C functional panels and rows with no status signal of their own (profile rows, inbox, drift/account banners, log section shells). Log list items (Level B) use `bg-bg-primary/80` as nested contrast inside the log shell. No container may render with no explicit background token when it visually reads as a bordered card.

**Hover:** `hover:border-border-hover` for interactive Level A/C containers (cards, rows). No `hover:border-accent-warm` on any container — accent is a status indicator (§10.2), never a hover/decoration effect.

---

### 10.7 Empty and loading states

Canonical empty UI lives in [`components/ui/empty-state.tsx`](../components/ui/empty-state.tsx). Use `variant` to distinguish **content-empty** (nothing to show yet in a feature area) from **infrastructure-empty** (wallet disconnected, indexer down, or similar blocker). Loading-state rules: §10.8.

#### Variant rules

| Variant | Container | Typography | Icon |
|---------|-----------|------------|------|
| **`content`** | No forced border or background — caller supplies Level A/B shell when needed (e.g. profile verified tab keeps an outer `rounded-md border p-8` wrapper). Level A adds `py-8 text-center`; Level B adds `text-center`. | Level A: `title` → `font-display text-fluid-h2`; `description` → `text-sm text-text-secondary`. Level B: `title` → `text-sm font-medium text-text-primary`; optional `description` → `text-sm text-text-secondary`. | Optional `IconComponent`; size **48** (Level A) or **32** (Level B) via `size` prop. |
| **`infrastructure`** | Default: **Level B panel** — `rounded-md border border-border-default bg-bg-surface p-4` (ignores `level` for container weight). With `nested={true}`: typography only inside a caller-owned Level B shell (no second panel). | `title` and `description` both `text-sm text-text-secondary` — diagnostic copy, not a primary empty-page moment. | Optional `IconComponent`; size **32** via `size` prop. |

**`nested` (infrastructure only):** Use when an infrastructure message lives inside a parent that already provides the Level B bordered shell (e.g. [`metadata-diff-panel.tsx`](../components/passport/metadata-diff-panel.tsx)). Renders the same infrastructure typography and semantics (`role`, icon, action, `children`) without adding a second `rounded-md border bg-bg-surface p-4` wrapper. Ignored when `variant="content"`. Do not strip panel chrome via `className` — use `nested` instead.

**`className` on infrastructure (non-nested):** layout/spacing only (`mx-auto`, `max-w-sm`, margins). Never border or background overrides.

**`action`:** optional text-style CTA (`href` → Link, `onClick` → button) using the accent-hover pattern from profile passport empty CTAs.

**`children`:** optional slot inside the panel (e.g. `pnpm ponder:dev` code snippet on ponder-unavailable states).

**Wallet connect:** do not embed [`WalletLoginButton`](../components/wallet-login-button.tsx) in `EmptyState`. Render it as a **sibling** in a `space-y-3` wrapper — see the file comment in `empty-state.tsx`.

**ARIA:** infrastructure panels default to `role="status"`; pass `role="alert"` for indexer/ponder failures.

#### Empty-state migration status

Content-empty and infrastructure-empty migrations are **complete** for all verified call sites (July 2026 backlog pass).

**Remaining exclusions** (intentionally not using `EmptyState`):

- [`components/marketplace/listing-card.tsx`](../components/marketplace/listing-card.tsx) — inline card media micro-placeholder (`No image`); not a section-level empty state
- [`components/profile/consigned-vehicles-tab.tsx`](../components/profile/consigned-vehicles-tab.tsx) — past consignments section uses `omitWhenEmpty`; no empty UI is rendered when the list is empty

Loading-state rules: see §10.8.

---

### 10.8 Loading states

Skeleton shape must match the §10.6 level of the content it replaces. If a skeleton already exists for a content type, reuse it — do not duplicate the same shape.

| Content type | Canonical skeleton | Reference loaded component |
|---|---|---|
| Listing card grid | [`ListingCardSkeleton`](../components/marketplace/listing-card-skeleton.tsx) | [`ListingCard`](../components/marketplace/listing-card.tsx) (Level A); grid + shell from [`listing-card-grid.ts`](../lib/marketplace/listing-card-grid.ts); image frame from [`listing-card-media.ts`](../lib/marketplace/listing-card-media.ts) |
| Consignment authorization row | `AwaitingCardSkeleton` | `AuthorizedAwaitingCard` (Level C) |
| Notification feed | `NotificationRowSkeletonList` | Notification list (Level A shell + Level C rows) |
| Verifier directory grid | Level A `bg-bg-card` card with internal bars matching `VerifierCard` | [`VerifierCard`](../components/verifier/verifier-directory.tsx) grid layout |
| Verifier picker (dialog) | Level C `bg-bg-card` row matching picker `VerifierCard` | Picker row — distinct from directory grid |
| Inline text placeholder | `rounded-sm` inline bar | ENS name, stake amount, single value — not card-level |
| Detail pages, forms, single-value reads | Text or `—` acceptable | No skeleton unless content is card/grid-shaped |

Pagination ("Loading more…") and pre-query gates (e.g. FX rates panel) are out of scope for skeleton grids.

Loading spinners use `SpinnerIcon` with `animate-spin` at the call site — no loading-context exception.

---

## 11. Design philosophy

Kargain is a **provenance navigator** for transport technology — not a dealership showroom. The UI is an instrument panel over immutable protocol facts: on-chain state, Arweave metadata, KarPro verification, and indexed history.

**North star:** Every screen answers *what is recorded on-chain, by whom, and in what trust state?*

### 11.1 Three visual layers

| Layer | Role | Typography | Color |
|-------|------|------------|-------|
| **Foundation** (§1–9) | Surfaces, spacing, motion, accessibility | Geist Sans display · Inter body · Geist Mono data | Token palette only |
| **Instrument** (§10) | Facts, serials, statuses, logs | Mono + `tabular-nums` for all on-chain fields | `accent-warm` = verified/active; `status-error` = disputed; neutral otherwise |
| **Narrative** | Human explanations, form labels, section titles | Sans, sentence case | `text-primary` / `text-secondary` |

When Foundation and Instrument conflict on factual typography or accent usage, **§10 wins**.

### 11.2 Navigator metaphor (future-proof)

Kargain does not sell the beauty of a vehicle — it charts **provenance** the way a navigator charts position:

| Concept | Product meaning | Visual language |
|---------|-----------------|-----------------|
| **Course** | Ownership, sales, verification trajectory | Log pattern (§10.4) — timeline with ticks |
| **Coordinates** | Token ID, chain, tx hash, block | Serial mono (§10.1) |
| **Log** | Immutable on-chain records | `PassportLogSection` |
| **Grid** | Marketplace discovery | `GridIcon` on bottom nav (§4.8, §10.5) |
| **Stamp** | KarPro / VERIFIED trust | Badge border `accent-warm` |

**System chrome** must not use literal vehicle silhouettes (cars, wheels, roads). Prefer abstract instrument motifs: brackets, ticks, coordinates, compass, serial stamps. This keeps the brand valid as transport technology categories evolve beyond road vehicles.

### 11.3 Brass accent semantics

`accent-warm` (`#d4a574`) is **instrument brass** — the metal of gauges and vernier scales — not a generic warm CTA color. Use it only where the interface reports an **active trust or navigation state** (§10.2–10.3). Prices, serial numbers, and resting body links never use accent.

### 11.4 UI review checklist

Before shipping any component, answer:

1. **Fact or narrative?** On-chain / numeric → mono. Explanations → sans.
2. **Status or decoration?** Verified/active → accent border or badge. Disputed → `status-error`. Else → neutral borders.
3. **Log or feed?** Immutable history → log shell (§10.4). Ephemeral alerts / social → feed rows.

### 11.5 Marketing surface (out of scope for `app/`)

Product UI (`app/`) stays flat and instrument-first per §9. **IL-6 marketing shell was skipped (July 2026)** — no separate landing route; **`/`** is marketplace browse and **`/about`** is public prose.

If a marketing shell is added later, it may use larger display type and coordinate-grid backgrounds built from CSS tokens. It must **not** introduce shadows, font weights above 500, vehicle hero photography, or tokens outside `globals.css`. Reference: §12.8.

---

## 12. Instrument Layer — implementation roadmap

**Phase 2 complete (July 2026).** Read **§10** (rules) before **§12** (shipped iteration log). **§13** is mobile contracts that reference §12.

**Status:** IL-0–IL-5 **shipped**; **IL-6 skipped** (no marketing shell). §10 spec and Groups A–F (empty, loading, mono timestamps) are **shipped**.

### 12.1 Phase overview

| Phase | Goal | Risk | Depends on |
|-------|------|------|------------|
| **IL-0** Primitives | Single source for link, serial, frame, timeline classes | Low | — | **Shipped** |
| **IL-1** Accent audit | Full §10.2 compliance; fix global `.link` utilities | Medium | IL-0 | **Shipped** |
| **IL-2** Signature visuals | Timeline axis, corner brackets, stamp badges | Medium | IL-0 | **Shipped** |
| **IL-3** Mobile pass | Touch order, sticky commerce, safe areas, drawer density | Medium | IL-1 | **Shipped** |
| **IL-4** Page restructuring | Passport detail + marketplace detail information architecture | High | IL-2, IL-3 | **Shipped** |
| **IL-5** Token parity | `status-success` UI consumption + purchase-confirmed semantics | Low | IL-1 | **Shipped** |
| **IL-6** Marketing shell | Optional public landing (separate route group) | Low | IL-0 | **Skipped** |

Instrument Layer Phase 2 **complete** (July 2026). IL-6 marketing shell declined — product entry remains `/` marketplace + `/about`.

### 12.2 IL-0 — Shared primitives — shipped

| Module | Purpose |
|--------|---------|
| [`lib/design/instrument-classes.ts`](../lib/design/instrument-classes.ts) | Canonical Tailwind class strings: `serialLabel`, `monoLink`, `monoTimestamp`, `instrumentFrame`, `categoryLabel`, `ctaLink`, `shellControlHover`, `trustStamp*`, `commerceConfirmed*`, `sectionScrollAnchor`, `instrumentReadoutPanel`, `profileTabActive` / `profileTabInactive` |
| [`components/ui/instrument-link.tsx`](../components/ui/instrument-link.tsx) | Mono address / explorer link — rest `text-text-secondary`, accent on `:hover` / `:focus-visible` only |
| [`components/ui/instrument-frame.tsx`](../components/ui/instrument-frame.tsx) | Corner-bracket registration frame — passport gallery hero + VIN block (**shipped** IL-2) |
| [`components/ui/instrument-timeline.tsx`](../components/ui/instrument-timeline.tsx) | Vertical hairline axis + tick marks — passport log sections (**shipped** IL-2) |

**`globals.css`:** `.link` / `.link-underline` rest `text-text-secondary`; accent on hover/focus — **shipped**.

**`lib/design-tokens.ts`:** `statusSuccess` exported — **shipped** (UI consumption shipped IL-5).

**IL-0 adoption:** `EnsWalletLink` defaults, `PassportIdLabel` serial, `ListingDisplayPrice` → `browsePrice`; passport/marketplace `link-underline` accent overrides removed.

### 12.3 IL-1 — Accent audit — shipped

Run before each IL phase ships:

```bash
rg -n 'text-accent-warm|hover:border-accent-warm' components app --glob '*.tsx' \
  | rg -v 'focus-visible|focus:border-accent-warm|border-accent-warm text-accent-warm|VERIFIED|verified|active \?|checked &&'
```

**IL-1 shipped (July 2026):** extended `instrument-classes` (`categoryLabel`, `ctaLink`, `shellControlHover`, `narrativeEyebrow`); `Button` secondary/outline + `FILTER_TRIGGER_BASE` use neutral shell hover; shell controls, category labels, body links, and informational copy migrated; `hover:border-accent-warm` eliminated from codebase. Remaining `text-accent-warm` hits are trust status, nav/filter **active** state, documented exceptions (§12.3.1), or hover-only link accents.

#### Compliant accent (keep)

| Pattern | Examples |
|---------|----------|
| Trust status | `PassportStatusBadge` VERIFIED, VERIFIED listing card border, log item `verified` border |
| Nav / filter **active** state | Mobile bottom nav icon + label `text-accent-warm`, market filter chip selected, currency row selected |
| Focus rings | `focus:border-accent-warm`, `--focus-ring` |
| Unread affordance | `notification-row` `border-l-2 border-accent-warm` when unread |
| Gallery selection | Active photo thumb border (selection state, not price) |
| Switch on | `border-accent-warm bg-accent-warm` |
| FAB center disc | Mobile create passport solid `bg-accent-warm` disc with `text-bg-primary` `AddIcon` (primary nav affordance; §12.3.1 exception) |

#### Fixed in IL-1 (was accent at rest or hover border on non-status controls)

| Area | Files | Issue |
|------|-------|-------|
| ~~Global links~~ | ~~`app/globals.css` `.link`, `.link-underline`~~ | ~~Accent at rest~~ — IL-0 |
| ~~Passport detail~~ | ~~`passport-detail-view.tsx`, `passport-records-timeline.tsx`~~, `passport-uri-history.tsx` | URI/explorer links → `monoLink` |
| Pro showroom | `app/pro/[slug]/page.tsx` | Body links → `sansLink` / `monoLink` |
| Verifier directory | `verifier-directory.tsx` | Category → `categoryLabel`; custom button → `shellControlHover` |
| Profile / KarPro | `profile-page.tsx`, `karpro-status-widget.tsx`, `messaging-settings-section.tsx`, `profile-edit-client.tsx` | Non-status labels → `categoryLabel`; website CTA → `ctaLink` |
| Agent / consignment | `agent-authorization-status.tsx`, `listing-agent-buyer-attribution.tsx`, `consigned-vehicles-tab.tsx` | Category labels; hover-only name links |
| Shell controls | `app-top-nav.tsx`, `wallet-login-button.tsx`, `currency-selector.tsx`, `verifiers-intent-banner.tsx`, `button.tsx`, `filter-constants.ts` | `shellControlHover` — no accent hover border |
| Marketplace | `buy-risk-modal.tsx`, `listing-edit-client.tsx`, `return-cooldown-display.tsx`, `nostr-comments-section.tsx` | Informational copy + cancel reply |
| Metadata | `metadata-diff-panel.tsx` | Re-inspect line → `text-text-primary` |
| EmptyState CTA | `empty-state.tsx` | Uses shared `ctaLink` (§12.3.1 exception) |
| Flow pages | `created/page.tsx`, `purchased/page.tsx` | H1 neutral; scan links → `sansLinkUnderline` |

#### 12.3.1 Documented accent exceptions (after IL-1)

| Exception | Rule |
|-----------|------|
| `EmptyState` `action` / `ctaLink` | Accent at rest allowed; hover → `text-text-primary` |
| Nav / filter / tab **active** slot | `border-accent-warm` + optional `text-accent-warm` on **current route or selected value** only |
| `EnsWalletLink` / `InstrumentLink` / `monoLink` / `sansLink` | Rest `text-text-secondary`; accent hover/focus only |
| Trust badges / VERIFIED cards | `listing-card`, `passport-status-badge`, `kar-pro-badge`, log verified border |
| KarPro membership stamp | `kar-pro-identity-strip` ✓ KarPro line; Overview `✓ Active KarPro` readout |
| Unread feed | `notification-row` left border when unread |
| Gallery thumb selection | `passport-photo-gallery`, `listing-detail-gallery` |
| Switch on | `switch.tsx` |
| FAB solid accent disc | `mobile-bottom-nav` center create affordance — `bg-accent-warm text-bg-primary`, no border or ring |
| Watchlist active | `watchlist-button` selected state |
| KarPro active verifier icon | `verifiers-intent-banner` `UserCheckIcon` |
| Narrative eyebrows | Static pages (`about`, `terms`, `privacy`, `kar-pro`), global `.eyebrow`, `sheet` title |
| Focus rings | Inputs, `focus:border-accent-warm` |

### 12.4 IL-2 — Signature visuals — shipped

**IL-2 shipped (July 2026):** `InstrumentTimeline` wired in `passport-log-section` (records + URI history); `InstrumentFrame` on gallery hero (verified corners when VERIFIED) and VIN block; `trustStamp*` squared badges on `PassportStatusBadge` and `KarProBadge`.

#### Timeline axis (pilot)

Upgrade [`passport-log-section.tsx`](../components/passport/passport-log-section.tsx) / [`passport-records-timeline.tsx`](../components/passport/passport-records-timeline.tsx):

```
┌─ Level A shell (bg-bg-surface)
│  ├─ vertical hairline (border-l border-border-default) + tick per entry
│  └─ Level B items (bg-bg-primary/80) aligned to ticks
```

- Tick: 1px horizontal mark at each entry timestamp (mono, §10.1).
- Mobile: axis stays left; entries stack full width — no horizontal scroll on axis.
- Do **not** add success green on log entries (§10.3).

#### Corner bracket frame

Wrap [`passport-photo-gallery.tsx`](../components/passport/passport-photo-gallery.tsx) hero in `InstrumentFrame`:

- Four L-shaped corners via pseudo-elements or nested borders (1px `border-border-default`, optional `border-accent-warm/40` when passport VERIFIED).
- VIN row in [`passport-spec-grid.tsx`](../components/passport/passport-spec-grid.tsx): bracket frame + serial mono.

#### Stamp badges

Consolidate VERIFIED / KarPro into one stamp pattern: mono caps, hairline border, no fill glow. Shared classes: `trustStampBase` + variants in [`instrument-classes.ts`](../lib/design/instrument-classes.ts); **`rounded-sm`** registration shape (not pill). Reference: [`kar-pro-badge.tsx`](../components/ui/kar-pro-badge.tsx), [`passport-status-badge.tsx`](../components/ui/passport-status-badge.tsx).

### 12.5 IL-3 — Mobile instrument pass — shipped

**IL-3 shipped (July 2026):** commerce aside `order-1` before main column on `< lg`; `sectionScrollAnchor` for hash targets; gallery chevrons `h-11` on mobile; filter drawer/bar mono inputs `min-h-11`; currency sheet `max-h-[90dvh]` + `min-h-11` rows; notification body `line-clamp-2`. **Exception:** disputed passports keep early gallery before title for evidence review.

| Surface | Current | Target |
|---------|---------|--------|
| **Passport / listing detail** | `lg:grid` sidebar; buy panel in aside | Mobile: **commerce block immediately after** title + status badges (before long-scroll attributes). Desktop: keep sticky aside. |
| **Bottom nav** | `pb-16` on main; safe-area on bar | Audit `scroll-mt-*` anchors (`#passport-actions`, `#passport-comments`) for FAB overlap; prefer `scroll-mt-28` on mobile |
| **Filter** | Drawer on mobile (`market-filter-drawer.tsx`) | Ensure mono price inputs keep `min-h-11`; active filter count stays mono tertiary unless chip is selected |
| **Currency sheet** | `max-h-[90dvh]` | Keep; verify 13-row list scroll + 44px row height |
| **Messaging / notifications** | Level C rows | Peer name sans; timestamp mono — already shipped; verify truncate + badge dots at 320px width |
| **Touch** | `min-h-11` on controls | Gallery prev/next: bump to `h-11 w-11` on mobile (currently `h-9`) |
| **Passport create FAB** | Center `-mt-3` | Keep; document as primary nav affordance (not trust status) |

**Mobile layout wireframe (listing detail, `< lg`):**

```
[Back link]
[Trust banner / dispute alert]
[Status badges + serial]
[Buy panel / offers]          ← moved up (IL-4)
[Photo gallery + brackets]
[Description]
[Attributes + VIN frame]
[History log + axis]
[Actions]
[Comments]
[URI history]
```

### 12.6 IL-4 — Page restructuring — shipped

**IL-4 shipped (July 2026):** [`passport-instrument-readouts.tsx`](../components/passport/passport-instrument-readouts.tsx) Level B panel under title (serial, custody, chain banner, verifier, UNVERIFIED hint, ancillary trust); passport detail grid split into commerce / main / ancillary columns (single `ListingDetailClientIsland`); `PassportTrustBanner` UNVERIFIED branch removed (readout hint + badge only); attributes + log Level A shells `p-4 sm:p-6` on mobile; profile tab classes centralized; attestations feed `divide-y` + dispute/attestation `serialLabel` eyebrows.

#### Passport / marketplace detail (`passport-detail-view.tsx`)

1. **Commerce island** — `WatchlistButton` + buy/offers/agent/return in `order-1` column; sticky right on `lg+`; after readouts panel on `< lg`.
2. **Instrument readouts** — grouped Level B panel under title (`instrumentReadoutPanel`).
3. **Trust dedup** — one primary status readout per viewport; UNVERIFIED full trust card removed.

#### Profile (`profile-page.tsx`)

- Tab bar: `profileTabActive` / `profileTabInactive` — accent bottom border only.
- Disputes / attestations: log vs feed separation (§10.4) with panel eyebrows.

**Mobile layout wireframe (listing detail, `< lg`):**

```
[Back link]
[Dispute alert if DISPUTED]
[Title + status badge]
[Instrument readouts panel]
[Watchlist + buy panel / offers]
[Photo gallery + brackets]
[Description]
[Attributes + VIN frame]
[History log + axis]
[Actions]
[Comments]
[URI history]
```

### 12.7 IL-5 — Status success semantics — shipped

**IL-5 shipped (July 2026):** `commerceConfirmedPanel`, `commerceConfirmedLabel`, `trustStampSuccess` in [`instrument-classes.ts`](../lib/design/instrument-classes.ts); external payment readout in [`listing-detail-client-island.tsx`](../components/marketplace/listing-detail-client-island.tsx); purchase complete panel on [`purchased/page.tsx`](../app/marketplace/[tokenId]/purchased/page.tsx); offers panel confirmed row; KarPro slug *Available* moved off success chroma.

Use `status-success` **only** for post-confirmation commerce states — not for VERIFIED passport (that remains `accent-warm`).

| State | Color |
|-------|-------|
| VERIFIED passport / KarPro active | `accent-warm` |
| Purchase / external payment confirmed | `status-success` border or mono label |
| DISPUTED | `status-error` |

### 12.8 IL-6 — Marketing shell (optional) — skipped

**Skipped (July 2026):** No `app/(marketing)/` landing shipped. Product UI stays instrument-first at `/` (marketplace browse) and `/about` for prose. Reference spec retained if a public landing is requested later:

- Separate Next.js route group `app/(marketing)/` if needed

- Coordinate grid background via CSS `linear-gradient` on tokens only.
- Large `text-fluid-display` headlines; same Geist/Inter/Mono stack.
- CTA → wallet connect or `/` marketplace.
- **No** duplication of product components; link into app routes.

### 12.9 Verification plan (per phase)

| Check | Command / method |
|-------|------------------|
| Types | `pnpm tsc --noEmit` |
| Unit tests | `pnpm test` |
| Build | `pnpm build` |
| Accent grep | §12.3 ripgrep audit |
| Visual | Manual: 320px, 390px, 768px, 1280px — passport detail, `/`, `/messages`, `/verifiers` |
| a11y | Focus ring visible; touch targets ≥ 44px; contrast on `text-text-secondary` body |

### 12.10 Definition of done (full IL program)

- [x] IL-0 primitives merged; `globals.css` link utilities compliant
- [x] IL-1 accent audit clean (exceptions only per §12.3.1)
- [x] IL-2 timeline axis + gallery bracket frame shipped on passport detail
- [x] IL-3 mobile commerce order + touch target pass
- [x] IL-4 passport detail IA restructure on mobile and desktop
- [x] IL-5 `statusSuccess` in `design-tokens.ts` + purchase flows
- [x] IL-6 skipped (marketing shell not required)
- [x] ROADMAP + HANDOFF updated; milestone row in AGENTS.md after ship

---

## 13. Mobile layout contracts

Mobile-specific rules supplement §4.7–4.8 and §6. Instrument Layer rules (§10) apply unchanged on small viewports.

### 13.1 Safe areas and chrome

| Element | Contract |
|---------|----------|
| Main scroll | `min-h-dvh pb-16 md:pb-0` via [`site-chrome.tsx`](../components/shell/site-chrome.tsx) |
| Bottom nav | `pb-[env(safe-area-inset-bottom)]`; `md:hidden` |
| Sticky top nav | `sticky top-0 z-50`; height `h-14` |
| Section anchors | `scroll-mt-24` minimum; `scroll-mt-28` on mobile when FAB overlaps (`md:scroll-mt-24`) — use `sectionScrollAnchor` from [`instrument-classes.ts`](../lib/design/instrument-classes.ts) |

### 13.2 Navigation duplication

Below `md`, primary actions live in **bottom nav only** (Messages, Create FAB, Alerts, Profile). Top nav: logo, currency, Auctions (when enabled), Verifiers, optional KarPro, wallet — per §4.7.

### 13.3 Commerce-first mobile detail

On viewports `< lg`, transactional panels (buy, offers, delist, agent actions) render **before** photo gallery and long-form attributes. See §12.5 wireframe.

### 13.4 Density tiers on mobile

| Tier | Padding | Use |
|------|---------|-----|
| Level A card | `p-4 sm:p-6` when sole column width &lt; 640px (`p-6` from `sm` up) | Shipped IL-4 on passport attributes + log shells |
| Level C row | `px-4 py-3` | Inbox, notifications, consignment lists |
| Filter drawer | Full-width mono inputs, `min-h-11` | §4.10 |

### 13.5 Instrument readability

- Serial and price lines: allow `text-xs` mono on very narrow screens; never switch factual fields to sans.
- Horizontal thumb strips (gallery): `overflow-x-auto` with `pb-1` — keep selected thumb `border-accent-warm` (selection state).

### 13.6 Passport right rail and modals

**Scope:** sticky tabs (not modals). Desktop right rail for commerce + Discussion. Mobile compact Discussion at bottom of Overview.

| Element | Contract |
|---------|----------|
| Tabs | Sticky under header: Overview / History & records / Actions — `?tab=` |
| Lazy panels | Records/Actions mount on first visit, then `hidden` when inactive |
| Desktop layout | `md:grid-cols-[1fr_22rem]` from header down; rail sticky `top-24` — commerce + compact Discussion (aligned with title) |
| Mobile discussion | Always at bottom of Overview (after commerce); compact density |
| Comments feed | Single `ListingCommentsProvider` per passport page |
| Deep link | `?e=` → scroll to `#comment-{id}` on `#passport-comments` |

### 13.7 Passport detail gallery (all breakpoints)

| Element | Contract |
|---------|----------|
| Plate | Constrained photo plate — `w-full max-w-3xl md:max-w-4xl` (not full document width) |
| Aspect | `aspect-[4/3]` mobile; `md:aspect-[16/10]` desktop |
| Swipe | 40px horizontal threshold on hero and lightbox (touch devices) |
| Overlays | Mono `N / total` counter + tappable dots when multiple photos |
| Lightbox | Tap/click hero → fullscreen viewer (full viewport); body scroll lock; Escape / arrow keys |
| Chevrons | `h-11 w-11` on mobile; `md:h-9 md:w-9` on desktop |

---

*Document version: 5.72 (July 2026 — bridge fee reflects URI-length lzReceive gas §4.19). Update when tokens, app shell, or component contracts change.*