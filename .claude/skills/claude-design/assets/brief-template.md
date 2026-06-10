# Claude Design — starter brief template

Paste this as the `brief` to `create_design_system` (or the first message). The brief
becomes the design system's durable "hard rules", so encode structure here, not in
follow-up turns. Fill every `<…>`; delete what doesn't apply.

---

## Template (copy from here)

```
Build a design system for <Company> — <one line: what the product is + who uses it>.
This is the canonical, approved look; reproduce it faithfully, do not reinterpret.

## Design direction
- Look & feel: <e.g. cinematic dark, one vivid accent, flat depth — no glassmorphism on chrome>
- Theme(s): <dark only | light+dark | …>; default = <…>
- Color: accent = <name + intent>, themable via <--brand / --tenant-accent>; neutrals = <cool/warm, hue>
- Type: display = <family>, text = <family>, mono = <family>; weights = <…>
- Iconography: <lucide, single weight>; NO <sparkle/star/wand/…>
- Voice & locale: <language>, <casing>, currency = <format, e.g. Rp25.000 whole-rupiah>
- Surfaces/idioms: <web | Telegram Mini App | mobile | admin> — <platform rules, safe-areas, sheets>

## Token architecture (REQUIRED)
- Three layers: PRIMITIVE (raw oklch ramps, never used directly) → SEMANTIC aliases
  (--background, --foreground, --card, --muted, --primary, --accent, --border, --ring,
   --success/--warning/--destructive) → COMPONENT tokens.
- Components consume SEMANTIC tokens ONLY. Never raw hex, never a primitive directly.
- Color in oklch. One overridable accent token so a re-theme is a one-line change.

## Structure & naming (REQUIRED)
- One file per component. kebab-case names by IDENTITY, never by iteration
  (no foo-v2, no "Final", no spaces in filenames).
- Group files: tokens/ (or system/*.css), components/ , screens/ , preview/ .
  No loose files at the root.
- When revising, EDIT the existing file in place — do NOT create a near-duplicate.
- Emit a SKILL.md + README documenting the tokens and the rules above.

## Components to define first (start small, then layer)
<Button (primary/line/ghost; sm/md; icon), Input/Field, Card, Badge/Chip, Nav/TabBar,
 Sheet, StatCard, EmptyState…> — give variants/sizes/states explicitly.
Show 2–3 variations for <the key brand surface> so I can pick.

## Out of scope / hard NOs
- <e.g. no neon glow on UI chrome; cinematic blur/grain only on poster/video surface>
- <e.g. no emoji in chrome; emoji only as user data>
```

---

## Worked example (Flicka — a real design system on this account)

```
Build a design system for Flicka — a multi-tenant short-drama streaming app (ReelShort/
DramaBox style) for Indonesia: one React codebase ships a responsive web app, a Telegram
Mini App, and a tenant-owner /admin area. This is the canonical, approved look —
reproduce it faithfully, do not redesign.

## Design direction
- Look & feel: cinematic dark + one vivid accent, FLAT depth (opaque shadows + hairline
  borders). No glow/neon/glassmorphism on UI chrome. Cinematic blur/grain/vignette ONLY
  on the poster/video surface.
- Theme: dark only (default and only theme).
- Color: accent = "Ember" red-coral oklch(0.672 0.232 22), per-tenant overridable via a
  single --tenant-accent / --flicka-brand token (Violet/Azure/Lime demo presets). Neutrals
  = cool near-black, hue 275, very low chroma.
- Type: display = Sora, text = Plus Jakarta Sans, mono = JetBrains Mono. Icons: lucide,
  single weight. No sparkle/star/magic/wand icons.
- Voice & locale: Indonesian chrome, sentence case, second-person "kamu", no emoji in
  chrome (emoji only as user data). Money = whole-rupiah IDR (Rp25.000, dot thousands, no cents).
- Surfaces: Telegram Mini App must read safe-area tokens (dvh/svh, never fixed vh),
  BackButton on every non-root screen, MainButton only for subscriber Paywall/Checkout,
  forms open as bottom sheets, honor prefers-reduced-motion.

## Token architecture (REQUIRED)
- Three layers in oklch: PRIMITIVE ramps (--p-neutral-*, --p-brand-*, status) →
  SEMANTIC (--background, --foreground, --card, --muted, --primary, --accent, --border,
  --ring, --success/--warning/--destructive) → COMPONENT tokens. Components consume
  SEMANTIC ONLY — never raw hex, never a primitive directly.

## Structure & naming (REQUIRED)
- system/tokens.css = canonical layered tokens; colors_and_type.css = flattened export;
  miniapp.css = additive safe-area layer (load after tokens). One file per component.
  kebab-case by identity, no -v2/"Final"/spaces. Group: system/ , preview/ , ui_kits/<kit>/ .
  Edit in place on revisions. Emit SKILL.md + README + per-kit READMEs.

## Components first
Buttons (primary/line/ghost, sm, icon), Field/Input/Select/Textarea, Card, Badge/Chip,
TabBar/Nav, Sheet + form primitives, PosterCard, EpisodeRow, PlanCard/PaymentTile,
StatCard, Skeleton/Spinner, Empty/Error/Offline states. Provide preview/*.html spec cards
grouped by Colors / Type / Spacing / Components.
```

> To generate a starter tailored to a *different* project (e.g. Saru), copy the template,
> swap the design direction, and keep the Token-architecture + Structure-&-naming blocks
> verbatim — those are what keep output clean regardless of brand.
