# Marketplace submission kit — working doc

Everything the marketplace.liferay.com wizard asks for, in wizard order, with
our drafts. Facts from learn.liferay.com "Publishing Apps in Marketplace" +
Marketplace FAQ (2026); where the new platform documents no spec, we follow
the stricter legacy guideline.

## Status checklist

| Asset | Spec | Status |
|---|---|---|
| Publisher account | "Become a Publisher" form → admin approval | ☐ pending (do first — gates everything) |
| App icon | Square PNG ≤5 MB, not animated | ✅ marketplace/icon/ (gradient + light variants, 1024 + 90) |
| Screenshots ×5 | PNG/JPG ≤5 MB each, uniform 1920×1080, 1 optional caption each | ☐ to produce (shot list below) |
| Video | Not supported for apps | — n/a |
| Built zip | `npm run build:cx` → dist/liferay-copilot-voice-deployable.zip | ✅ pipeline ready |
| Name / description / notes | Drafts below | ◐ draft |
| Category / areas / tags | Decisions below | ◐ proposed |
| Support URLs ×7 | All ready except email/phone | ◐ see below |
| LICENSE file in repo | MIT | ✅ LICENSE added (review before pushing) |
| Version compatibility | scripts/smoke-liferay.js per release | ◐ master ✅ 8/8; quarterlies pending |

## Step 2 — Profile

**Name** (≤50 chars, front-load first ~18; "Liferay" in the name must not
imply official certification — DECISION PENDING):

- Option A: `Liferay Copilot Voice` (current branding everywhere)
- Option B: `Copilot Voice for Liferay` (safer wrt. the naming guideline)

**Description** (plain paragraphs, English):

> Create Liferay content with your voice. Copilot Voice is a hands-free
> authoring copilot for Liferay CMS: press a key, say "create content",
> dictate — and it's published.
>
> Key features:
> - Voice-driven flows for web content, blog entries, document uploads and
>   your own content structures (custom Objects): picklists, booleans,
>   numbers and dates are all dictatable.
> - Runs inside your portal as a custom element client extension: no extra
>   servers, no credentials, no configuration. It uses the signed-in user's
>   session, permissions and language (Spanish, English, Italian, Portuguese, German and French).
> - Accessibility-first: every prompt, option list and confirmation is
>   mirrored to screen-reader live regions. The whole flow works
>   ears-and-voice only.
> - Deterministic format review (capitalisation, punctuation, question
>   wrapping) before publishing — optionally pluggable to your own LLM
>   endpoint.
> - Everything spoken is also clickable and typable; voice never locks
>   you in.
>
> Requirements: a browser with the Web Speech API (Chrome, Edge or Safari),
> a microphone, and Liferay 2026.Q3 or newer (the copilot uses the Liferay
> CMS content space APIs, GA since 2026.Q3; on 2026.Q1/Q2 enable the
> Liferay CMS feature flags).
> Documentation: https://marcoscv-work.github.io/liferay-copilot-voice/

**Category** (choose exactly one from: Batch, Checkout, Fragments, Object
Action, Other, Payment Methods, Prompt, Site Initializer, Theme, Workflow
Action): → **Other** (none of the specific ones fits a custom element widget).

**Areas** (≥1): → **Content Management & Operations** + **Experience
Management**.

**Tags** (≥1): `voice`, `accessibility`, `content creation`, `dictation`,
`client extension`, `speech recognition`.

## Step 3 — Build

- Type: **Client Extension** → upload `dist/liferay-copilot-voice-deployable.zip`.
- Supported versions: declare only what we smoke-test, **starting at
  2026.Q3** (first GA of the new CMS — "zero configuration" holds there).
  2026.Q1/Q2 only with feature flags (LPD-17564 + deps) enabled — declare
  them only if we document that requirement in the listing. Earlier
  releases (7.4 GA / 2025.Qx) lack the `/o/cms` space APIs entirely.

### Compatibility matrix (run `node scripts/smoke-liferay.js` per release)

| Portal | Date | User | Result |
|---|---|---|---|
| DXP master (local dev build) | 2026-09-02 | admin | ✅ 8/8 — spaces (typed), web content, blog, document (json+base64), listing, Objects, cleanup |
| 2026.Q1 / Q2 / Q3 quarterlies | ☐ pending | non-admin too | run before submission |

Note: the smoke run against master caught a real bug — `/o/cms/basic-documents`
no longer accepts multipart (415); the app now posts JSON with an embedded
base64 FileEntry and keeps multipart as legacy fallback.

## Step 4 — Storefront (5 screenshots @1920×1080)

1. Idle keycap + mic on a clean portal page — caption: "Press a key, talk —
   Copilot Voice lives inside your Liferay portal."
2. Listening bars + side panel of command pills mid-dictation (title +
   content filled) — "Dictate content hands-free, with voice commands for
   every field."
3. Space picker cards — "Pick your content space by voice or click."
4. Dynamic Object flow (picklist or date panel with part-by-part chips) —
   "Your content structures become guided voice flows automatically."
5. Format review modal — "Review formatting before publishing — you always
   approve the result."

## Step 5 — Version

- Version: **1.0.0** (bump package.json from 0.1.0 at submission).
- Release notes draft:
  > First public release. Voice-driven creation of web content, blogs,
  > documents and custom Object entries; space creation by voice; Spanish,
  > English, Italian, Portuguese, German and French; full screen-reader support.

## Steps 6–7 — Pricing / Licensing

- **Free** → perpetual, no trial, no payment/tax info needed.

## Step 8 — Support (all seven ready before starting the wizard)

| Field | Value |
|---|---|
| Support URL | https://github.com/marcoscv-work/liferay-copilot-voice/issues |
| Publisher website | https://marcoscv-work.github.io/liferay-copilot-voice/ |
| Support email | ☐ DECIDE (personal address recommended for a personal app) |
| Support phone | ☐ DECIDE |
| Documentation URL | https://marcoscv-work.github.io/liferay-copilot-voice/ |
| Install/uninstall guide URL | https://marcoscv-work.github.io/liferay-copilot-voice/#install |
| Privacy policy (link it in the description) | https://marcoscv-work.github.io/liferay-copilot-voice/privacy.html |
| EULA URL | leave empty → Marketplace-standard EULA applies (inferred from live listings) |

## Step 9 — Submit

- Listing is frozen while "Pending"; review ≈15 working days (can stretch).
- Legacy-documented checks: metadata sanity, antivirus, deploys cleanly,
  basic functional smoke test. No source review.

## Publisher profile (public page)

- Needs: publisher logo (reuse app icon) + short publisher description:
  > Independent publisher building voice and accessibility tooling for
  > Liferay.
