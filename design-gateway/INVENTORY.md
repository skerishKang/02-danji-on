# DanjiOn Static Design Version Inventory

Baseline: `f23c4e1f5622a2313c51c94d2ac54df568b2ea9a`
Task: `#395`
Mode: `STATIC_DESIGN_VERSION_PACKAGER`

## Retained minimum set

| Version | Classification | Source | Entry | Why retained |
|---|---|---|---|---|
| `v2-runtime` | `COMPARISON_KEEP` | `04_개발/frontend` at current main | `index.html` | Current React runtime surface; comparison only, source remains untouched |
| `v3-current` | `DESIGN_AUTHORITY` | `frontend/` at current main | `index.html` | Current static V3 design authority documented by `README_V3_PROMOTION_20260906.md` |
| `legacy-a` | `COMPARISON_KEEP` | `03_HTML결과물/05_실사사진중심_v5/01_단지온_v5_반응형기능기준.html` | `index.html` | Canonical V5 functional/information-architecture reference for visual comparison |
| `legacy-b` | `COMPARISON_KEEP` | `03_HTML결과물/08_실리나이스_다색기능_v7/01_단지온_v7_실리나이스_다색기능.html` | `index.html` | Distinct V7 color/keyart exploration; second V7 file is byte-identical and dropped |
| `pr378` | `COMPARISON_KEEP` | PR #378 `[최종-v3]/` at `b618cad4...` | `site/index.html` | Frozen comparison artifact; central direction says DO_NOT_MERGE |

## Classification of other candidates

| Candidate | Classification | Reason |
|---|---|---|
| `frontend/index2.html`, `frontend/app2.html`, `frontend/01_이웃가게_발견_v2.html`, `frontend/03_주민혜택_쿠폰_v2.html` | `ARCHIVE_ONLY` | Explicit V2 comparison branch/history; V3 is the documented current static authority and these are already represented through the V2 runtime comparison |
| `frontend/00_APP_390_통합검토.html`, `frontend/00_주민혜택_AB비교.html` | `DUPLICATE_DROP` | Review launchers, not independent product/design versions; their underlying variants are retained or classified separately |
| `03_HTML결과물/01_통합커뮤니티_v1` | `ARCHIVE_ONLY` | Earlier broad concept, superseded by later information-architecture and authority references |
| `03_HTML결과물/02_이웃생활경제_v2` | `ARCHIVE_ONLY` | Historical stage represented by current V2 comparison and later V3/static work |
| `03_HTML결과물/03_편집형브랜드_v3` | `ARCHIVE_ONLY` | Historical editorial concept; no distinct current gateway comparison need after V3 authority selection |
| `03_HTML결과물/04_세련디자인_v4` | `ARCHIVE_ONLY` | Historical visual iteration with no current authority or separate retained decision |
| `03_HTML결과물/05_실사사진중심_v5/02_단지온_v5_실사사진중심_참고.html` | `DUPLICATE_DROP` | Reference companion, not the canonical functional V5 entry |
| `03_HTML결과물/06_울트라블루_키아트_v6` and `07_색상3안_키아트_v6` | `ARCHIVE_ONLY` | Visual exploration family; V7 is retained as the later distinct color-system comparison |
| `03_HTML결과물/08_실리나이스_다색기능_v7/02_단지온_v7_실리나이스_키아트.html` | `DUPLICATE_DROP` | Exact same SHA as selected V7 file |
| `03_HTML결과물/09_살아있는이웃가게_M1_모션검증` | `ARCHIVE_ONLY` | Narrow motion verification slice, not a complete retained version |
| `02_디자인팀/00_공통탐색자료/danjion-D-typography-grid-static-pack/*` | `ARCHIVE_ONLY` | Typography/token exploration materials, not end-to-end app versions |
| `02_디자인팀/03_편집형브랜드_v3`, `06_울트라블루_키아트_v6`, `07_색상3안_키아트_v6`, `08_실리나이스_다색기능_v7`, `09_살아있는이웃가게_M1_모션검증` | `ARCHIVE_ONLY` | Design-team working/source exploration; retained in repository history, not duplicated into unmanaged gateway bundles |
| `04_개발/frontend/src/v2` | `DESIGN_AUTHORITY` for production React V2 only | Not copied into static bundles; production React V2 remains the product authority and is outside this packaging PR |

## Safety boundary

- This PR adds static artifacts and registry metadata only.
- It does not modify `04_개발/frontend/src`, V2 routing, production Pages configuration, or the gateway implementation owned by KILO1.
- No production API write, production secret, Cloudflare binding, or deployment is included.
- `PR #378` is frozen comparison material and remains `DO_NOT_MERGE`.
- PR #378's source `app.html` referenced a missing `index3.html`; the bundle adds a byte-identical frozen alias to make the retained entry self-contained without changing the PR source.
- Stable public subpaths and gateway deployment require a later KILO1 gateway implementation/deployment gate; this PR only prepares independently addressable bundle directories.
