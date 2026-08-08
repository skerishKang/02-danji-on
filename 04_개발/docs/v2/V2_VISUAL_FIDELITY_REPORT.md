# DanjiOn V2 Visual Fidelity Report

Status: `V2_A_VISUAL_READY` candidate / Track V2-A / Issue #26

## 1. Source lock

Track A implementation was grounded in the fixed reference required by #25, #26, #32 and `V2_PARALLEL_WORK_ORDER.md`.

- canonical HTML: `01_단지온_8월현장시연_통합시제품_v1_이미지리프레시.html`
- Drive ID: `18Tl6-J5q9_7ZXx0Rb9FZS--QifQ09aZB`
- byte size: `98,456`
- verified SHA256: `70d925fffdb24f752cce489fccd97bda2b5856edafe982be4a7e6abc54546f85`
- sibling asset folder verified for this upload set: Drive folder `18okVG8Ed06amcenb7wwrtLNC2EYgYxmj` (`05_실행자산`)
- manifest: `이미지출처_및_교체내역.md`, Drive ID `1B5zISgrwg58tH_Mi4t3EPLcEv5BkVbvR`
- checksum manifest: `SHA256.txt`, Drive ID `1yYI_kUqmWcwnznBufyT4mrjqoET5Rbdy`

The canonical HTML was downloaded as raw bytes and read from first byte to last byte before implementation. Its SHA matched the source lock exactly, so no source-lock exception was required.

## 2. `05_실행자산` audit

All nine sibling assets were downloaded and inspected. Their bytes matched `SHA256.txt`.

| asset | dimensions / form | SHA256 |
|---|---|---|
| `scene-beauty.webp` | 960×660 | `05dd0a33bcd7f7b68b51e059d7d3a27f0ad367f80f74bdc104591249e4e06ad9` |
| `scene-car.webp` | 960×660 | `c6f342c9c1420fd242bddc3b396a9aeec5b838595b5908b2cbd215f343d00620` |
| `scene-craft.webp` | 960×660 | `17ed4494146e1cb745cdcc64b93e980deef1d7b4880ebc60dd42228b8d7f03bc` |
| `scene-food.webp` | 960×660 | `62945189df24e330089d26b2f947c88e616f10976764586ff7d27d9766c21564` |
| `scene-home-care.webp` | 1200×825 | `865a61477a9aa0ffbf00b12835d8e156a089dfe902957b080cf6464b51dfa41a` |
| `scene-learning.webp` | 960×660 | `62b6985c1174c7cf9a0a25a358077b2287ef3ceec403bfe5d5ad22d70b45c4d8` |
| `scene-photo.webp` | 960×660 | `25bd40d65593acae62e481de3ecbc4ac8a8e9a631745850ddee5a9e0a188d714` |
| `scene-professional.webp` | 740×400 | `06398410f98bf3f59b9204071f825bcbba7270a1c4a622d2ca9828944df03fcf` |
| `ui-icons.svg` | 9-symbol stroke sprite | `4ed97cf798fcea13eeb0c5e646f325478f05e99330fc5eb0027efaccd5efeada` |

The fallback set is deliberately work-detail photography: cooking hands, teaching, repair tools, document work, craft, car maintenance, beauty work and camera operation. The SVG establishes the thin 1.8px rounded-line icon language used by the V2 primitives.

The image-refresh manifest states that the public demo uses eight new Unsplash real-photo scenes while the above WebP set is fallback-only. The React visual data therefore preserves the exact canonical Unsplash CDN URLs and separately records each canonical fallback asset path.

## 3. Reference characteristics mapped to React

### Fixed editorial topbar

Implemented in `src/v2/visual/V2Topbar.tsx`.

Preserved:
- fixed translucent canvas topbar with blur;
- strong `단지온` wordmark + complex label;
- centered desktop navigation;
- verified-resident pill;
- accent underline tied to current scene/category;
- compact mobile bottom navigation;
- top scroll progress primitive.

### First-screen hero

Implemented in `V2Hero.tsx`.

Preserved:
- asymmetric ~46/54 copy/photo split;
- three-line large Korean editorial headline;
- search visible above the fold;
- real-photo food scene with delayed mask reveal and slow settle zoom;
- duplicated blurred foreground crop for depth;
- live-scene note and green activity dot;
- browse/register CTAs and compact product statistics.

### Cinematic sticky scenes

Implemented in `V2CinematicScenes.tsx`.

Preserved:
- 360vh desktop scroll world with 100vh sticky stage;
- 64/36 image / information composition;
- four source scenes: food, learning, home-care, professional;
- category-specific image, dark surround, panel color and foreground ink;
- scene number, editorial caption, product facts and actions;
- scroll-derived scene selection plus manual tabs;
- short manual-selection lock so scroll does not immediately undo a clicked tab;
- image cross-scene transition with depth/clip/opacity motion;
- vertical scene rail and scene tab controls.

### Category color transition

The source color contract is preserved as data rather than hard-coded product logic:

- food `#E95C3E` / dark `#4A1F17`
- learning `#4057E8` / dark `#18265E`
- home-care `#BDE53E` / dark `#384217`
- professional `#6840A5` / dark `#2E173D`

`V2VisualFrame` receives the active scene and promotes its color to `--v2-accent`; the scene component separately transitions panel, surrounding dark field and text ink.

### Product landing / explorer primitives

Implemented in `V2ExplorerPrimitives.tsx` and source-locked visual data in `visual-data.ts`.

Provided for Track B integration without owning product logic:
- editorial section heading;
- controlled category and resident-relation filter controls;
- featured, medium and row photo-card variants;
- relation badges, visual save affordance, metadata accents and text-only rows;
- 7 canonical demo shop visual records using the image-refresh photo set.

Track A does **not** filter API data or decide business ordering in production. The components accept controlled values/callbacks for Track B.

### Benefit visual primitive

`V2BenefitVisual.tsx` preserves the source's dark photo field + light foreground benefit card and controlled `available / stored / used` display states. It does not claim or mutate a benefit itself.

## 4. Motion and responsive behavior

The CSS entrypoint `src/v2/v2-visual.css` imports namespaced Track A fragments under `src/v2/visual/`; every selector is scoped/prefixed for the V2 surface so V1 is not silently restyled.

Preserved breakpoints and intent:
- desktop: full-height hero and sticky cinematic scroll;
- <=1050px: navigation reduction, 46/54 hero, 58/42 scene split;
- <=800px: hero becomes image-first vertical composition, cinematic sticky behavior becomes sequential, tabs become a 2×2 grid, shop cards become stacked, benefit composition becomes vertical, and mobile navigation appears;
- <=380px: headline / service / control typography tightens without removing product actions.

Reduced motion is implemented through both `prefers-reduced-motion: reduce` and an explicit `reducedMotion` prop/data attribute. In that mode:
- reveal/zoom/cross-scene transitions stop;
- top scroll progress is hidden;
- cinematic section loses the 360vh sticky dependency and becomes normal document flow;
- information and tab access remain intact.

## 5. File ownership / isolation audit

Track A changes are restricted to #32 ownership:

- `04_개발/frontend/src/v2/visual/**`
- `04_개발/frontend/src/v2/v2-visual.css`
- this report

Not changed:
- V1 `App.tsx` / V1 CSS;
- `main.tsx` / gateway / variant selector;
- V2 product flow composition;
- backend / Auth / DB / migrations / gateway / workflows;
- production Drive or deployment configuration.

## 6. Intentional fidelity gaps / integration handoff

1. **Fallback asset packaging:** the exact `05_실행자산` bytes were verified and their canonical paths are preserved in `visual-data.ts`, but Track A does not add a second public-asset topology. The visual image primitive accepts a `fallbackSrc`, and Track B/C integration may map the verified WebPs into the final V2 asset-serving location without changing component semantics. Until then, the canonical Unsplash image-refresh URLs are the primary rendered photography and a neutral accessible placeholder is used if a remote image fails.
2. **Product flows:** register wizard, operator approval, promo generation, dialogs and real data filtering are Track B territory. Track A exposes only visual primitives and callbacks.
3. **Gateway/build entry:** Track A does not edit `main.tsx`, `V2App.tsx` or gateway files. The visual module is independently typecheckable/importable and is intended to be composed by Track B, then selected by Track C during integration.
4. **Automated screenshot parity:** Track D owns visual/e2e parity gates. Track A does not self-declare pixel-perfect PASS before the integrated V2 surface is mounted and tested.

## 7. Integration contract

Preferred consumption from Track B:

```ts
import {
  V2VisualFrame,
  V2SectionHeading,
  V2FilterBar,
  V2ExplorerGrid,
  V2BenefitVisual
} from './visual';
```

`src/v2/visual/index.ts` imports `v2-visual.css` once and exports the visual primitives/data. Product state should be passed through callbacks/props instead of copied into Track A.

## 8. Track A verdict

When frontend typecheck and production build are green at the published branch head, the allowed intermediate verdict is:

`V2_A_VISUAL_READY`

This is not `V2_INTEGRATION_GREEN`, `V2_PREVIEW_READY`, or `PRODUCTION_READY`.
