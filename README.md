# History Awaits

A browser-based geopolitical grand-strategy game. Command your nation with natural language — a small language model running entirely in your browser (no server, no API key, no recurring cost) translates it into a structured action that a deterministic simulation engine validates and applies.

Covers ~195 sovereign countries plus a curated set of disputed/non-UN territories (Taiwan, Palestine, Western Sahara, Kosovo, Northern Cyprus, Somaliland), each with real admin-1 (state/province) borders, economy, military, government, and diplomacy simulation.

## Architecture

```
Player command → Local AI (WebGPU, in-browser) → Structured action → Validator → Simulation engine → World state
                       ↓ (unavailable / low confidence)
                 Deterministic fallback parser ──────────────┘
```

- The AI never touches world state directly. Both the AI parser and the fallback parser produce the same `StructuredAction` candidate; `src/simulation/validators/actionValidator.ts` is the sole gate that checks legality against live game state and applies it via the simulation engine.
- The fallback parser (`src/command/fallbackParser.ts`) is the guaranteed path — the game is fully playable with the AI off.
- The simulation runs in a Web Worker (`src/simulation/worker/`) so UI stays responsive.
- Everything is client-side: no backend, no database. Saves live in the browser's IndexedDB (via Dexie). This is a static site — Render hosts a few MB of app code; the ~1GB AI model (when enabled) is fetched by the player's own browser from Hugging Face's CDN and cached locally, so hosting cost stays flat regardless of how much the game is played.

## Local AI model

[`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) running **Qwen2.5-0.5B-Instruct** (q4f16 quantized, ~1GB) via WebGPU. Requires a WebGPU-capable browser (Chrome/Edge desktop) and a real GPU. If unavailable or it fails to load, the game automatically and silently uses the deterministic fallback parser instead — nothing breaks.

## Data

- Country identity from [`mledoze/countries`](https://github.com/mledoze/countries); population/GDP/military baselines are hand-seeded for ~55 major powers and procedurally estimated (tagged `dataConfidence: "estimated"`) for the rest — see `scripts/generate-baseline-data.ts`.
- Admin-1 region borders from [Natural Earth](https://www.naturalearthdata.com/) (10m Admin-1 States/Provinces), processed with `mapshaper` into a ~1.3MB TopoJSON file — see `scripts/build-geo-topology.ts`.
- All generated data is committed as static JSON under `src/data/generated/` and `public/geo/` — no runtime network calls for game data.

## Development

```bash
npm install
npm run dev          # start the dev server
npm test              # run the vitest suite (engine, parser, validator)
npm run sim:headless  # run N simulated turns with no UI, checks for NaN/instability
```

To regenerate the baseline data or geo topology (not needed unless you're changing the data pipeline):

```bash
npm run gen:geo   # downloads Natural Earth shapefiles, rebuilds public/geo/*.topojson
npm run gen:data  # rebuilds src/data/generated/*.json
```

### Project layout

- `src/domain/schemas/` — zod schemas, the single source of truth for game data shapes (also used to constrain the AI's JSON output).
- `src/simulation/` — the deterministic engine: per-domain modules (`economy.ts`, `military.ts`, `diplomacy.ts`, `war.ts`, `territory.ts`, `government.ts`), the turn loop, the action validator, and the Web Worker that owns live game state.
- `src/command/` — the fallback parser, the AI parser, and the orchestrator that picks between them.
- `src/ui/` — React components (map, panels, command console).
- `src/state/` — Zustand store + Web Worker client.
- `src/persistence/` — Dexie (IndexedDB) save/load/autosave.
- `scripts/` — one-off data-generation scripts (not part of the shipped app).

### QA scripts

`scripts/smoke-test*.mjs` are Playwright-driven end-to-end checks (menu → new game → map click → region click → commands → end turn → save/load/refresh). Not part of the app bundle. Run against a dev server, a `vite preview` build, or a deployed URL:

```bash
npx playwright install chromium   # once
node scripts/smoke-test.mjs [baseUrl]             # core flow (defaults to localhost:5173)
node scripts/smoke-test-disputed.mjs [baseUrl]    # starting as a disputed entity
node scripts/smoke-test-commands.mjs [baseUrl]    # command variety (mobilize/treaty/alliance/sanction)
node scripts/smoke-test-longplay.mjs [baseUrl] 40 # N-turn stability + news generation
node scripts/smoke-test-ai.mjs [baseUrl]          # local AI enable flow (needs a real GPU to fully succeed)
```

## Deployment

Static site, deployable anywhere that serves a `dist/` folder. `render.yaml` configures it for [Render](https://render.com) as a free Static Site (`npm ci && npm run build`, publish `dist`).

## Limitations

- Regions carry population/GDP/unrest/infrastructure stats *derived proportionally* from their country, not independently simulated economies — this is what keeps a world of ~4,400 regions performant.
- Non-major-power country data is procedurally estimated, not hand-researched — treat it as gameplay flavor, not a factbook.
- The fallback parser's command families are the guaranteed contract; the AI is an enhancement layer for everything else, tested against a curated set of phrasings rather than arbitrary English.
- No cross-device cloud saves — saves are per-browser (IndexedDB).
