# DanjiOn Frontend — v5 Product App

## Purpose

This directory turns the approved v5 information architecture into maintainable product code without modifying the historical prototype files in `03_HTML결과물`.

The canonical functional reference remains:

`03_HTML결과물/05_실사사진중심_v5/.../danjion-neighbor-life-v5-responsive.html`

This implementation is not a redesign. It is a product-code migration of the v5 interaction model.

## Stack

- React 19
- TypeScript
- Vite 8
- CSS with the v5 visual tokens and responsive rules

## Current screens

- Home
- Search / business listing
- Relation filter
- Category filter
- Business detail
- Bookmark state
- Resident benefits
- Complex news
- My information
- Desktop navigation
- Mobile 5-tab bottom navigation

Business registration, real contact reveal, admin UI, storage upload and production authentication are intentionally left for the next integration gates.

## Data adapters

The UI does not import mock arrays directly. It uses `DataAdapter`.

### Mock mode

```env
VITE_DATA_MODE=mock
```

Uses the v5 fixture data in `src/data/mock.ts` and requires no backend.

### API mode

```env
VITE_DATA_MODE=api
VITE_COMPLEX_SLUG=bangnim-myeongji-roadhill
VITE_DEV_AUTH_USER=dev-resident-001
```

The same UI calls the Cloudflare Worker API.

During local development Vite proxies `/api` to `http://localhost:8787`.

The development actor header is emitted only by Vite development builds. Production bypass remains blocked by the backend environment guard.

## Local run

```bash
npm install
npm run dev
```

For API mode, run the backend Worker separately on port 8787.

## Build gate

```bash
npm run typecheck
npm run build
```

## Visual continuity with v5

Preserved intentionally:

- warm neutral canvas `#F7F7F4`
- white content surfaces
- dark ink body text
- coral primary action `#D84F32`
- green verified-resident state `#277A53`
- large search field
- relationship-first listing
- large touch targets
- 320px-friendly mobile layout
- fixed mobile 5-tab navigation
- reduced-motion support

## Source-of-truth rule

- `00~03`: planning/design/prototype history; do not rewrite from product code.
- `04_개발/frontend`: maintainable production frontend.
- `04_개발/backend`: API/database/auth boundary.
