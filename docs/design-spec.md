# Kargain — Design Specification

Canonical reference for website UI components. All new work must conform to this document. Do not invent one-off styles.

**Related public docs:** [README.md](../README.md) · [passport-v1.1-spec.md](./passport-v1.1-spec.md) · [CONTRIBUTING.md](../CONTRIBUTING.md) · [KIPs](https://github.com/kargain-com/kips)

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
| Desktop (`md+`) | Logo | flex spacer | Verifiers (secondary button) · Alerts · Messages · Become KarPro (when eligible) · Create passport · Chain selector · Wallet |

**Marketplace search:** lives in the **filter bar** on `/` ([`market-filter-bar.tsx`](../components/marketplace/market-filter-bar.tsx)), not in the top navbar.

**Logo:** [`KargainLogo`](../components/ui/kargain-logo.tsx) at 24px + wordmark "Kargain". Mobile: icon only — wordmark `hidden sm:block`.

**Messages:** Lucide `Inbox` (20px, `strokeWidth={1.5}`). Unread: dot badge via [`XmtpUnreadBadge`](../components/messaging/xmtp-unread-badge.tsx). Desktop only (`hidden md:inline-flex`); requires wallet connected.

**Alerts:** Lucide `Bell` (20px, `strokeWidth={1.5}`). Unread: dot badge via [`NotificationsUnreadBadge`](../components/notifications/notifications-unread-badge.tsx). Desktop only (`hidden md:inline-flex`); link always visible, badge when wallet connected.

**Become KarPro:** [`useShowBecomeKarPro`](../hooks/use-show-become-karpro.ts) — shown when wallet connected and not an active verifier. Mobile top nav: compact **KarPro** label; desktop: **Become KarPro**.

**"Create passport":** Secondary border style — `border border-border-hover bg-transparent`. Desktop only (`hidden md:inline-flex`); mobile uses bottom-nav center FAB.

**Verifiers:** Link to `/verifiers`. Secondary bordered button in the **right action cluster** (first before Alerts): `ShieldCheck` + **Verifiers** label on desktop (`md+`); compact bordered icon on mobile. Active on `/verifiers`: `border-accent-warm`, `text-accent-warm`, `bg-bg-surface`. Hover: accent border and text.

**Chain selector:** [`ChainSelector`](../components/shell/chain-selector.tsx) — Radix dropdown, full network name. Wrong-chain: red status dot. Desktop only (`hidden md:flex`).

**Wallet:** [`WalletLoginButton`](../components/wallet-login-button.tsx) — identicon + ENS or short address + ChevronDown. Radix dropdown: View on Basescan, Copy address, Disconnect. Disconnected: opens connect dialog.

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

**Display currency:** Global preference (USD / EUR / ETH) via [`currency-selector.tsx`](../components/shell/currency-selector.tsx) in top nav; stored in `localStorage` (`kargain_display_currency`). [`display-currency-context.tsx`](../lib/marketplace/display-currency-context.tsx) + Chainlink feeds (`use-chainlink-rates.ts`) drive [`convertPrice()`](../lib/marketplace/display-currency-context.tsx) on listing cards. Browse shows **all** active listings regardless of listing fiat currency (no currency filter chip).

**Price filter + sort (FX):** User-entered min/max use the active display currency at apply time; `priceCurrency` is persisted in the URL when bounds are set (e.g. `?priceMin=4&priceCurrency=ETH`). Live Chainlink rates (`eurUsdRate`, `ethUsdRate`) are sent per-request to Ponder — not stored in URL. Shared normalization in [`price-normalize.ts`](../lib/marketplace/price-normalize.ts); filter/sort logic in [`listing-query.ts`](../lib/marketplace/listing-query.ts). Non-USD price apply and price-asc/desc sort are gated until rates load.

**Price chip labels:** Active filter chips use URL `priceCurrency`, not the live display preference — so bookmarked filters keep semantic meaning if display currency changes.

**Removed:** `market-filters.tsx` sidebar, `marketplace-filter-controls.tsx` — do not reintroduce duplicate filter UIs.

**Known issue:** Desktop filter row uses `overflow-hidden`; controls may clip around ~768px — prefer wrap or horizontal scroll if extending.

**Error state** ([`market-browse.tsx`](../components/marketplace/market-browse.tsx)): when Ponder is unreachable —

- `AlertTriangle` icon in bordered square
- Title: "Marketplace unavailable"
- Hint: `pnpm ponder:dev` in `<code>` — **never** expose env variable names (`PONDER_SQL_API_URL`, etc.) in UI copy

**Homepage stats (`/`):** [`app/page.tsx`](../app/page.tsx) server-fetches stats and passes `activeListings`, `verifiedCount`, `activeVerifiers` to [`market-browse.tsx`](../components/marketplace/market-browse.tsx). Compact ambient line above [`market-filter-bar.tsx`](../components/marketplace/market-filter-bar.tsx): `font-mono text-xs text-text-tertiary tabular-nums` (e.g. `42 listings · 12 verified · 5 active verifiers`). Hidden when all stats are 0.

**Verifiers page (`/verifiers`):** No intro band. [`VerifiersIntentBanner`](../components/verifier/verifiers-intent-banner.tsx) in top container; [`VerifierDirectory`](../components/verifier/verifier-directory.tsx) in `#verifier-grid` section.

**Listing card:** [`listing-card.tsx`](../components/marketplace/listing-card.tsx) — VERIFIED listings use permanent `border-accent-warm` on the card (not hover-only). UNVERIFIED / DISPUTED use `border-border-default`; hover → `border-border-hover` (never accent on hover). VERIFIED + non-empty `row.verifier` shows ShieldCheck attribution linking to `/profile/{address}`.

**Photo upload (mint wizard):** [`photo-upload-zone.tsx`](../components/passport/photo-upload-zone.tsx) — drag-and-drop zone with file picker fallback; used on `/passport/new`.

**Irys upload progress (create + edit):** [`passport-upload-progress.tsx`](../components/passport/passport-upload-progress.tsx) — batch photo status, fee hint, progress bar. Shown during `phase === "uploading"`. Errors use `whitespace-pre-line` for multi-line smart-wallet messages.

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
| KarPro stats | Compact mono line on `profile-page.tsx` (active verifier only): verifications · active since · `0.05 ETH` staked (owner only) |
| Action banner | `ProfileActionBanner` — five contextual cases (visitor+KarPro send request, owner become KarPro, owner open disputes, etc.) |
| KarPro widget | `KarProStatusWidget` — owner + active verifier only; link to `/kar-pro` |
| Tabs | Counts in tab labels; **Verified** and **Attestations** when subject is active verifier (visible to all visitors); **Disputes** owner + active verifier only |
| Dispute cards | Vehicle make/model/year, reason, relative time, disputer, Resolve link to marketplace detail |

Do not vary avatar shape by role. **IdentityAvatar** / **EnsAvatar:** round only; used in profile header, verifier directory, pro showroom, mobile bottom nav, and XMTP inbox rows.

---

### 4.12 Messages

Implementation: [`message-inbox-client.tsx`](../components/messaging/message-inbox-client.tsx), [`conversation-thread-client.tsx`](../components/messaging/conversation-thread-client.tsx).

| Element | Rule |
|---------|------|
| Layout | `max-w-lg`, full viewport height minus nav |
| `?to=` pre-fill | `/messages?to={address}` opens existing DM or creates a new conversation; URL param stripped on mount; invalid address, self, or disconnected wallet → normal inbox |
| Thread header | Peer avatar + display name + KarPro badge + link to `/profile/{address}` |
| Own bubble | `bg-white text-bg-primary` |
| Peer bubble | `bg-bg-surface text-text-primary` |
| Timestamps | Below bubble, `text-xs text-text-tertiary`, aligned with sender side |
| Composer | `Input` + icon `Button`; Enter sends |

No per-message sender label in the bubble list.

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

Implementation: [`passport-detail-view.tsx`](../components/passport/passport-detail-view.tsx).

- Page shell: `py-24`, `max-w-7xl`
- **Disputed:** full-width `DisputeStatusSection` at top (before gallery and title) — reason, disputer, withdrawn state, role-specific "what happens next"; links scroll to `#passport-actions`
- `PassportActionsPanel` wrapped with `id="passport-actions"` and `scroll-mt-24` for dispute anchor
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

Implementation: [`listing-detail-client-island.tsx`](../components/marketplace/listing-detail-client-island.tsx) + [`listing-buy-panel.tsx`](../components/marketplace/listing-buy-panel.tsx).

| Rule | Value |
|------|-------|
| Buy panel | Price in seller fiat + optional display-currency hint; ETH / USDC payment toggle |
| Disclosure | Bordered panel: seller receives, you pay, rate at settlement, platform fee — method-specific rows |
| USDC buy | ERC-20 `approve` then `buyWithUsdc`; disabled when USDC not configured on chain |
| Seller delist | Ghost button with Trash2 icon; seller-only when listing active; phases: Confirm in wallet → Delisting… |
| Seller manage | Link to `/marketplace/{tokenId}/edit` when viewer is seller |
| Guest / buyer | `ListingBuyPanel` + `SellerContactButton` (XMTP) |

Sentence case in UI copy. No `font-bold` / `font-semibold` on disclosure labels.

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
