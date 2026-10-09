# History Awaits

A browser-based geopolitical grand-strategy game. Command your nation with natural language — a small language model running entirely in your browser (no server, no API key, no recurring cost) translates it into a structured action that a deterministic simulation engine validates and applies.

Covers ~195 sovereign countries -- including the Palestinian Authority (West Bank; Gaza held by Hamas; contested by Israel) and Western Sahara (contested by Morocco), played as independent nations -- plus a curated set of disputed/non-UN territories (Taiwan, Kosovo, Northern Cyprus, Somaliland), each with real admin-1 (state/province) borders, economy, military, government, and diplomacy simulation.

## Calendar, turns & victory

- The game runs from **January 1, 2026 to January 1, 2126**. The world advances in 3-day ticks, and every tick is an *event round*: at least one world event happens every 3 in-game days (`forceWorldEvent` in `src/simulation/modules/worldEvents.ts` fills in quiet ticks).
- Before ending a turn the player picks how long it lasts: 3 days (1 event round), 30 days (10), 60 days (20), 90 days (30), or 6 months (60). The player's commands apply first; then every AI country acts on every tick of the turn.
- The world starts mid-history (`src/simulation/openingScenario.ts`): the Russia–Ukraine war is underway (Luhansk occupied; Donetsk, Zaporizhzhia, Kherson and Kharkiv contested) and Thailand–Cambodia border tension is simmering. Both run through the normal AI simulation from there.
- **Victory** (`src/simulation/victory.ts`): on January 1, 2126 countries are ranked in three categories: **Largest Country** (land area controlled, from `regionAreas.json`), **Strongest Economy** (GDP ÷ (1 + debt-to-GDP), so debt counts against you), and **Strongest Military**. The country that leads the most categories wins (ties go to the best combined rank). The **Standings** button shows the live race at any time.

## IGPT -- the internal decision engine

Every country that isn't the player's is run by **IGPT** (`src/igpt/`), and IGPT can also advise the player or run their country on autopilot. It is a scoring engine, not a language model: it runs inside the simulation worker with no model download, no network calls and no tokens, and decides for ~200 countries in a few milliseconds per tick.

- **Doctrines** (`doctrines.ts`) -- hand-written personalities (aggression, expansionism, economic/military focus, diplomacy, sanctions use, risk tolerance, plus claims, countries it protects, and rivals) for ~50 key countries, with government-type defaults for the rest. E.g. Switzerland is neutral, Russia claims Ukraine, the US protects Taiwan.
- **Lessons** (`lessons.ts`) -- plain-English rules of thumb ("Never start a war you can't win", "Don't attack a country a great power has promised to defend", "Debt above 100% of GDP calls for discipline") that push specific moves up or down. Each lesson that influenced a decision is shown to the player as part of its explanation. Adding a lesson changes every country's behavior.
- **Brain** (`brain.ts`) -- each country lists its options (war, peace, sanctions, alliances, trade deals, aid, relations, tax/military spending, research, arms, mobilization), scores them from its doctrine and situation (threat level, war odds including allies and protectors, debt, unrest, victory-race ranks), applies lessons and learned experience, and acts on its best foreign and best domestic move if they clear a threshold. Countries at war think every 6 days, others every 30.
- **Learning** (`memory.ts`) -- every decision is judged ~3 months later by how the country's standing in the three victory races changed relative to the world; moves that paid off are favored, ones that backfired avoided, per country and world-wide. This memory is saved with the game.
- **In the UI** -- the **IGPT** button shows ranked suggestions with reasons and a one-click "Do it" (executed through the same action validator as typed commands), a feed of what every country decided and why, what IGPT has learned, and an **autopilot** toggle. Autopilot decisions are listed in the turn summary.

`npx tsx scripts/igpt-report.ts [years]` plays N years headless and prints what IGPT decided.

## Architecture

```
Player command → Local AI (WebGPU, in-browser) → Structured action → Validator → Simulation engine → World state
                       ↓ (unavailable / low confidence)
                 Deterministic fallback parser ──────────────┘
```

- The AI never touches world state directly. Both the AI parser and the fallback parser produce the same `StructuredAction` candidate; `src/simulation/validators/actionValidator.ts` is the sole gate that checks legality against live game state and applies it via the simulation engine.
- The fallback parser (`src/command/fallbackParser.ts`) is the guaranteed path — the game is fully playable with the AI off.
- The simulation runs in a Web Worker (`src/simulation/worker/`) so UI stays responsive.
- **AI Advisor** (`src/ui/AdvisorPanel.tsx`, `src/ai/advisorChat.ts`): a free-form chat with the same local model, for discussing strategy, asking "what if" questions, or getting an explanation of why something happened. It's strictly read-only — it only ever reads a compact summary of world state (`src/ai/advisorContext.ts`) to build its prompt and has no function available to it that touches state; to act on its suggestions, the player still types a normal command. Conversation history is saved per-game and auto-summarized once it gets long, so it never grows unbounded.
  - Context is rebuilt fresh from live state on **every message** (never cached), includes the current in-game calendar date, and is question-aware — it only pulls in the military/economy/diplomacy detail sections (and a named country's data) relevant to what was actually asked, instead of dumping the whole world.
  - Opening the panel auto-starts the (one-time, browser-cached) local model download — there's no separate "enable AI" step to find first. The advisor is usable immediately regardless, via a deterministic no-model fallback (`src/ai/advisorFallback.ts`) that answers a handful of common questions straight from live state.
  - A status line shows which of two sources is answering: Local AI, or Basic fallback parser.
  - The simulation, not the model, is the source of truth for numbers: `src/ai/factCheck.ts` scans the model's reply for the player's own stats and appends a correction if a figure is well outside a reasonable rounding of the live value (e.g. the model repeating a stale number from earlier in the conversation).
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
npm run sim:headless  # simulate the whole century (or N ticks) with no UI, checks for NaN/instability and prints the winners
```

To regenerate the baseline data or geo topology (not needed unless you're changing the data pipeline):

```bash
npm run gen:geo   # downloads Natural Earth shapefiles, rebuilds public/geo/*.topojson
npm run gen:data  # rebuilds src/data/generated/*.json
npm run gen:areas # rebuilds src/data/generated/regionAreas.json (region land areas, from the geo topology)
```

### Project layout

- `src/domain/schemas/` — zod schemas, the single source of truth for game data shapes (also used to constrain the AI's JSON output).
- `src/igpt/` — IGPT, the decision engine for AI countries and player advice/autopilot (see above).
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
node scripts/smoke-test-advisor.mjs [baseUrl]     # AI Advisor panel open/close/enable-prompt flow
node scripts/smoke-test-igpt.mjs [baseUrl]        # IGPT advice, executing a suggestion, world feed, autopilot
node scripts/smoke-test-disputed-click.mjs [baseUrl] # clicking Gaza, West Bank, Western Sahara, Kosovo, South Sudan opens their country
node scripts/smoke-test-new-nations.mjs [baseUrl]  # starting a game as the Palestinian Authority / Western Sahara
```

## Deployment

Static site, deployable anywhere that serves a `dist/` folder. `render.yaml` configures it for [Render](https://render.com) as a free Static Site (`npm ci && npm run build`, publish `dist`).

## Limitations

- Regions carry population/GDP/unrest/infrastructure stats *derived proportionally* from their country, not independently simulated economies — this is what keeps a world of ~4,400 regions performant. Region panels correctly show real per-region identity (name, current controller, original owner, capital/disputed/frontline status) but explicitly say "Data unavailable" for anything genuinely not tracked (major cities, terrain, roads/rail/ports, region-level troop deployments) rather than inventing it.
- Non-major-power country data is procedurally estimated, not hand-researched — treat it as gameplay flavor, not a factbook.
- The fallback parser's command families are the guaranteed contract; the AI is an enhancement layer for everything else, tested against a curated set of phrasings rather than arbitrary English.
- The simulation does not model true fog-of-war — every number is deterministically known internally. The Advisor *talks* about foreign militaries the way an intelligence briefing would (rounded, "estimated"), but that's a phrasing convention, not a hidden-information mechanic.
- No cross-device cloud saves — saves are per-browser (IndexedDB).
