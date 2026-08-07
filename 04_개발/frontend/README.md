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

## Resident app

Entry: `/`

Current flows:

- Home
- Search / business listing
- Relation filter
- Category filter
- Business detail
- Bookmark state
- Resident benefits
- Complex news
- My information
- Business/service application form
- My application status
- Verified-resident contact reveal
- Desktop navigation
- Mobile 5-tab bottom navigation

## Operations app

Entry: `/admin.html`

This is intentionally separate from the resident navigation.

Current operations flows:

- Business application list
- Status filter
- Review note
- Request changes
- Reject
- Approve
- Complex-news publishing
- Resident-benefit creation

Production authorization still belongs to the backend and Neon Auth. The admin screen itself is not an authorization boundary.

## Data adapters

### Mock mode

```env
VITE_DATA_MODE=mock
```

Uses v5 fixture data and requires no backend. Resident and operations screens can be reviewed independently while infrastructure accounts are not connected.

### API mode

```env
VITE_DATA_MODE=api
VITE_COMPLEX_SLUG=bangnim-myeongji-roadhill
VITE_DEV_AUTH_USER=dev-resident-001
VITE_DEV_ADMIN_AUTH_USER=dev-manager-001
```

The resident app calls the core Worker routes and `/admin.html` calls the manager/admin routes.

During local development Vite proxies `/api` to `http://localhost:8787`.

The development actor headers are emitted only by Vite development builds. The backend still resolves the actual role and membership from database fixtures; production bypass is blocked by the backend environment guard.

## Local run

```bash
npm install
npm run dev
```

- Resident UI: `http://localhost:5173/`
- Operations UI: `http://localhost:5173/admin.html`

For API mode, run the backend Worker separately on port 8787.

## Build gate

```bash
npm run typecheck
npm run build
```

The Vite production build includes both `index.html` and `admin.html`.

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
- `04_개발/frontend`: maintainable product frontend and operations UI.
- `04_개발/backend`: API/database/auth boundary.
