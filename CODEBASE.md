# CODEBASE.md — Volcanic Ops v3.0.2 — Full Structure & Working (AI Context File)

> **Purpose:** Single-source truth for any AI to understand the entire codebase without exploration. Covers architecture, file-by-file logic, data contracts, runtime flow, and extension rules.
> **Project Root:** `D:\Playwright_Testing_Studies\Mission Set\v3.0.2\`
> **Primary Entry:** `test_volcanic_clean.py:1225` (`run()`)
> **Dashboard Entry:** `dashboard/src/main.tsx:1` → `dashboard/src/app/App.tsx:24`

---

## 1. Project Identity

**Name:** Volcanic Ops — Live Verification Dashboard (v3 — per-click verify)
**Domain:** QA Automation for HTML5 game `Battlecry 2026` — Volcanic Outlands missions (8 missions)
**Core Idea:** Drive a real Chromium browser with Playwright, intercept game API traffic to extract auth tokens + live player state (`_ls`), compare *every* Engage click against expected values from `config.json`, and stream results live to a React dashboard via atomic JSON writes.

```
Playwright (browser) -- intercepts --> NetworkCapture -- feeds --> APIClient -- snapshots --> OpsVerifier -- dumps --> verification_results.json -- poll (1s) --> React Dashboard
```

### 1.1 What v3 Changed (vs v2)
| Change | File | Detail |
|---|---|---|
| Per-click verification | `test_volcanic_clean.py:292` | Removed `verify_every_n_engages` modulo logic. **Every** Engage now takes `before`/`after` snapshots and calls `verify_engage()` |
| Enriched JSON | `test_volcanic_clean.py:318` | Each record: `mission_id`, `click_number`, `phase_pct`, `timestamp`, `before`/`after` `{xp,supplies,cash,level}` |
| JSON top-level keys | `test_volcanic_clean.py:261` | `metadata` + `results[]` + `summary{total,passed,missions_complete}` |
| Dual-write atomic | `test_volcanic_clean.py:241` | Writes to `./verification_results.json` **and** `dashboard/public/verification_results.json` via `os.replace(tmp,path)` |
| Crash safety | `test_volcanic_clean.py:1213` | `try/except TargetClosedError/finally` — always dumps JSON + closes browser/session |
| UI robustness | `test_volcanic_clean.py:424` | Added `dump_page_state`, `get_phase_percentage`, `click_mission_button` JS tree-walker, unblock recovery |

### 1.2 Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Automation | `playwright.sync_api` | `sync_playwright`, Chromium `headless:false` per `config.json:7` |
| HTTP | `requests` | `requests.Session()` with `Origin/Referer/X-Requested-With` headers `test_volcanic_clean.py:114` |
| Language | Python 3 | `sys.stdout.reconfigure(utf-8)` on win32 `test_volcanic_clean.py:16` |
| Frontend | React 18 + Vite 6 | `dashboard/package.json:60` |
| Styling | Tailwind CSS 4.1 + `@tailwindcss/vite` | `dashboard/vite.config.ts:4` |
| UI Primitives | Radix UI + shadcn | 40+ components in `dashboard/src/app/components/ui/` |
| Fonts | Inter + JetBrains Mono | `dashboard/src/styles/fonts.css:1` |

---

## 2. Directory Tree (Annotated)

```
v3.0.2/
├── test_volcanic_clean.py          # 1226 lines — entire automation + verification engine
├── config.json                     # 127 lines — missions + ops_doc + browser + API host
├── verification_results.json       # 9090 lines (example) — generated, git-ignored in prod; primary output
├── README.md                       # User quick-start (install/dev/run)
├── CODEBASE.md                     # ← THIS FILE (AI context)
│
├── __pycache__/                    # Python bytecode cache (ignore)
│
└── dashboard/                      # Vite + React live dashboard (Figma → shadcn scaffold)
    ├── package.json                # deps: react, vite, tailwind, radix, recharts, motion, etc.
    ├── vite.config.ts              # alias '@'→src, figmaAssetResolver, react+tailwind plugins :1
    ├── index.html                  # #root mount, loads /src/main.tsx :18
    ├── postcss.config.mjs
    ├── pnpm-workspace.yaml
    ├── default_shadcn_theme.css    # Fallback shadcn tokens (overridden by theme.css)
    ├── public/
    │   └── verification_results.json  # Second write target — Vite serves statically, poll reads here
    └── src/
        ├── main.tsx                # createRoot(App) :6
        ├── styles/
        │   ├── index.css           # imports fonts+tailwind+theme :1
        │   ├── fonts.css           # Inter + JetBrains Mono import
        │   ├── tailwind.css        # @import tailwindcss :1
        │   ├── theme.css           # ★ Design system (colors, animations, table, scrollbar) :3
        │   └── globals.css         # empty
        ├── imports/                # Figma export leftovers (ignore, not used in build)
        └── app/
            ├── App.tsx             # 133 lines — poll loop, viewMode state machine, layout :24
            └── components/
                ├── TopBar.tsx      # 112 lines — stats pills, status badge, Summary/Live toggle :9
                ├── Sidebar.tsx     # 133 lines — mission list, progress bar, StatusBadge :8
                ├── MissionView.tsx # 230 lines — per-mission header + engage table + ResultRow :6
                ├── ExecutionSummary.tsx # 279 lines — banner, stats grid, mission breakdown, failures :5
                ├── EmptyState.tsx  # 34 lines — waiting spinner + `py test_volcanic_clean.py` hint :1
                ├── figma/ImageWithFallback.tsx
                └── ui/             # 48 shadcn components (accordion, dialog, table, etc.) — unused by main views
```

---

## 3. `config.json:1` — Full Schema & Semantics

```jsonc
{
  "uid": "JH03",                              // Login credential — if non-empty, use Input[0] + "Enter"
  "SimulationKey": "",                        // Alt login — placeholder/name variants + "Simulate" button
  "game_url": "https://remote-206-8888.../app.index.html",
  "api_host": "remote-206-3070.dnapps.in",    // Intercept filter — NetworkCapture watches this host
  "origin": "https://remote-206-8888.dnapps.in", // Sent as Origin/Referer header in APIClient
  "browser": { "headless": false, "viewport_width": 1280, "viewport_height": 800 },
  "verify_every_n_engages": 5,                // LEGACY in v3 — ignored; verify happens every click
  "ops_doc": {                                // Human-readable op definitions → printed at startup
    "attain":   { "description": "XP per Engage", "api_endpoint": "user/get", "db_field": "_ls.xp" },
    "consume":  { "description": "Supplies per Engage", "api_endpoint": "user/get", "db_field": "_ls.s" },
    "rewards":  { "description": "Cash on completion ∈ [cash_min,cash_max]", "api_endpoint": "user/get", "db_field": "_ls.c" },
    "unlock_levels": { "description": "Min level to access mission", "api_endpoint": "user/get", "db_field": "_ls.level" },
    "loot_unit": { "description": "Special unit on Mission 5" }
  },
  "missions": [                               // 8 missions, strictly ordered, processed sequentially
    {
      "spec_steps": "10-18",                  // Spec range string — only used for display + progress calc
      "id": 1,                                // Stable int — joins验 results.mission_id ↔ metadata.missions[].id
      "name": "Capture the Lava Watch Post", // Exact UI text — page.get_by_text(name) locator depends on it
      "unlock_level": 160,                   // Verify: current_level >= unlock_level
      "xp_gain": 80,                          // Verify: after.xp - before.xp == xp_gain  (op: attain)
      "supplies_cost": 90,                    // Verify: before.supplies - after.supplies == supplies_cost (op: consume)
      "cash_min": 9200000, "cash_max": 15000000, // Verify: cash_after - cash_before ∈ [min,max] (op: reward)
      "loot_unit": null | { "name","class","attack","defence","upkeep" } // Only Mission 5 has value
    }
    // ... ids 2-8 (165..190 levels, xp 123..315, supplies 128..315, cash up to 2.6B)
  ]
}
```

**Mission Table (8 rows):**

| id | name | unlock | xp | supplies | cash range | loot |
|---|---|---|---|---|---|---|
| 1 | Capture the Lava Watch Post | 160 | 80 | 90 | 9.2M–15M | — |
| 2 | Raid the Ashfield Supply Camp | 165 | 123 | 128 | 63M–88M | — |
| 3 | Breach the Magma Bunker Complex | 170 | 145 | 180 | 99.9M–490M | — |
| 4 | Intercept the Outlands Smuggler Aircraft | 175 | 183 | 208 | 450M–850M | — |
| 5 | Capture the Volcanic Torpedo Skiff | 175 | 230 | 250 | 530M–930M | ★ SPECIAL NAVY UNIT 170/90 upkeep 600k |
| 6 | Collapse the Hidden Lava Tunnel Arsenal | 180 | 235 | 260 | 800M–990M | — |
| 7 | Hunt the Outlands Raider Squad | 185 | 250 | 295 | 920M–1.6B | — |
| 8 | Burn the Volcanic Weapons Foundry | 190 | 315 | 315 | 950M–2.6B | — |

**AI Invariant:** `mission.name` string must match **exactly** the DOM text. Any rename breaks `page.get_by_text(m_name)` at `test_volcanic_clean.py:999` and `click_mission_button` tree-walker at `test_volcanic_clean.py:733`.

---

## 4. `test_volcanic_clean.py:1` — Python Engine Deep Dive

### 4.1 Imports & Globals

```python
# test_volcanic_clean.py:1-17
import json, os, time, datetime, requests, sys, re
from urllib.parse import parse_qs
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from playwright._impl._errors import TargetClosedError  # fallback to Exception

INTERRUPT_BUTTONS = ["Deploy","Continue","Received","Affirmative","Roger","NO","Close","×","X"] # :45
```

`print_flush()` at `test_volcanic_clean.py:23` — `print + sys.stdout.flush()` for real-time terminal streaming (critical when dashboard is tailing).

`load_config()` at `test_volcanic_clean.py:28` — resolves `config.json` relative to script path (`os.path.dirname(os.path.abspath(__file__))`), loads JSON, prints `ID` (uid|SimulationKey) and mission count, `sys.exit(1)` if missing.

### 4.2 `NetworkCapture:51` — Passive Traffic Interceptor

**Role:** Attach to Playwright `page.on("request")` + `page.on("response")` to harvest auth tokens and live player state without extra API calls.

```python
class NetworkCapture:  # test_volcanic_clean.py:51
    def __init__(self, api_host:str):
        self.api_host = api_host
        self.auth_params = {}   # {__u,__t,__s,__l,__v}
        self.api_responses = {} # path -> body
        self.latest_ls = {}     # merged _ls dict from all responses
```

| Method | Line | Logic |
|---|---|---|
| `on_request(request)` | `test_volcanic_clean.py:60` | If `api_host not in url` → ignore. Parse `post_data` as `application/x-www-form-urlencoded` via `parse_qs`. Flatten single-value lists. If all `["__u","__t","__s","__l","__v"]` present and `auth_params` empty → capture (once only). Log `[NET] Auth params captured`. |
| `on_response(response)` | `test_volcanic_clean.py:78` | If `api_host not in url` → ignore. Require `application/json` content-type. `response.json()`, extract `path = url.split("/api/")[-1].split("?")[0]`, store `api_responses[path]=body`. If `"_ls" in body and isinstance(_ls,dict)` → `latest_ls.update(_ls)` (merge, not replace). |
| `is_auth_ready()` | `test_volcanic_clean.py:96` | `all(k in auth_params for k in ["__u","__t","__s"])` — only first 3 required. |
| `get_auth_param(key)` | `test_volcanic_clean.py:93` | dict get with "" fallback |
| `get_last_response(endpoint)` | `test_volcanic_clean.py:99` | raw lookup |

**Key Insight:** `latest_ls` is the **hot cache** for `APIClient.get_resources()`. All subsequent game-state reads are served from this in-memory merge, avoiding rate limits. `APIClient.post("user/get")` is only fallback when `latest_ls` empty.

### 4.3 `APIClient:106` — Authenticated HTTP Client

```python
class APIClient:  # test_volcanic_clean.py:106
    def __init__(self, config, capture):
        self.uid = config["uid"] or config["SimulationKey"]
        self.capture = capture
        self.api_base = f"https://{config['api_host']}/api"
        self.session = requests.Session()
        self.session.headers.update({"Content-Type":"...","X-Requested-With":"XMLHttpRequest","Origin":origin,"Referer":origin+"/"})
```

| Method | Line | Behavior |
|---|---|---|
| `_build_params(extra)` | `test_volcanic_clean.py:132` | Builds `{_dc: millis, __u,__t,__s,__l,__v}` from capture + merges `extra` |
| `post(endpoint, extra)` | `test_volcanic_clean.py:145` | `POST {api_base}/{endpoint}` with `_build_params` as `data`, `timeout=10`. Returns `resp.json()` on `resp.ok`, else logs `[API-ERROR]`/`[API-TIMEOUT]`/`[API-CONN]` and returns `{}` |
| `get_resources()` | `test_volcanic_clean.py:163` | **Fast path:** if `capture.latest_ls` non-empty → return `{level: ls.level|lv, xp, cash: ls.c, supplies: ls.s}`. **Slow path:** `POST user/get` → merge `state["_ls"]` into `latest_ls` → same mapping, fallback to `state.{level,xp,cash,supplies}` if `_ls` absent. Returns `{}` on failure. |
| `close()` | `test_volcanic_clean.py:125` | `session.close()` swallow-all |

**Field Mapping (canonical):**
```
_ls.level | _ls.lv → level
_ls.xp            → xp
_ls.c             → cash
_ls.s             → supplies
```

### 4.4 `OpsVerifier:200` — Verification Engine (Core)

> Docstring at `test_volcanic_clean.py:201` defines 4 ops: `attain` (XP), `consume` (Supplies), `rewards` (Cash), `unlock` (Level).

```python
class OpsVerifier:  # test_volcanic_clean.py:200
    def __init__(self, api, config):
        self.results = []        # array of result records
        self.metadata = {"start_time": iso, "last_updated": iso, "missions": [id,name,spec_steps,unlock_level,xp_gain,supplies_cost,cash_min,cash_max,loot_unit]}
        self.summary = {"total":0, "passed":0, "missions_complete":[]}
        # prints ops_doc reference, calls _dump_json() immediately
```

| Method | Line | Contract |
|---|---|---|
| `_resolve_output_paths()` | `test_volcanic_clean.py:241` | Returns `[script_dir/verification_results.json]` + optionally `[script_dir/dashboard/public/verification_results.json]` if dir exists |
| `_dump_json()` | `test_volcanic_clean.py:253` | Updates `last_updated=now`, recomputes `summary.total = sum(len(r.checks))`, `summary.passed = sum(c.pass)`, builds `payload={metadata,results,summary}`, `json.dumps(indent=2)`, atomic write via `tmp + os.replace` to each path, logs `[JSON-WARN]` on fail |
| `_print_ops_reference()` | `test_volcanic_clean.py:277` | Pretty-prints `config.ops_doc` at startup |
| `snapshot()` | `test_volcanic_clean.py:289` | Delegates to `api.get_resources()` |
| `verify_engage(mission,before,after,engage_num,phase_pct)` | `test_volcanic_clean.py:292` | Computes `xp_delta=after.xp-before.xp`, `sup_delta=before.supplies-after.supplies`. Creates two checks: `_check("xp","attain",f"+{exp}",f"+{delta}", ok)` and `_check("supplies","consume",f"-{exp}",f"-{delta}", ok)`. Logs via `_log_check`. Appends result `{mission,mission_id,type:"engage",click_number,phase_pct,timestamp,before:{xp,supplies,cash,level},after:{...},checks}`. Calls `_dump_json()`. **Called EVERY click.** |
| `verify_mission_rewards(mission,cash_before,cash_after)` | `test_volcanic_clean.py:343` | `earned=cash_after-cash_before`, `ok = cash_min <= earned <= cash_max`. Check `field:cash op:reward expected:"lo – hi" actual:"earned,"`. Appends `type:"mission_reward"` record (click_number 0, phase 100, before/after only cash). Marks `summary.missions_complete += mission.name` if not present. Double `_dump_json()`. |
| `verify_unlock(mission,current_level)` | `test_volcanic_clean.py:371` | `ok = level >= unlock_level`. Check `field:level op:unlock expected:">= req" actual:str(level)`. Appends `type:"unlock_check"` record. Returns bool (caller ignores but could gate). |
| `print_summary()` | `test_volcanic_clean.py:393` | Iterates all results.checks, counts, prints `[✓/✗] mission | type | op | field | exp | act` table + `TOTAL: passed/total (pct)` |

Helpers `test_volcanic_clean.py:415-421`:
```python
def _check(field,op,expected,actual,passed): return {"field":field,"op":op,"expected":expected,"actual":actual,"pass":passed}
def _log_check(ok,op,field,expected,actual): print_flush(f"    [{'✓' if ok else '✗'}] {op:8s} {field}: expected {expected}, got {actual}")
```

### 4.5 UI / Resource Helpers

| Function | Line | Purpose |
|---|---|---|
| `dump_page_state(page,label)` | `test_volcanic_clean.py:428` | `page.evaluate("document.body.innerText")`, condense to ` | ` joined, truncate 600 chars, log `[UI-DUMP label]`. Then list up to 10 visible `button,[role=button],.btn,[class*=button]` innerTexts as `[UI-BUTTONS]`. Returns raw text. |
| `log_resources(label,res)` | `test_volcanic_clean.py:468` | `print_flush(f"[RESOURCES {label}] Lvl:.. XP:.. Cash:.., Supplies:..,")` with `:,` formatting |
| `log_resource_delta(before,after,mission)` | `test_volcanic_clean.py:483` | Computes `xp_d, sup_d, cash_d`, compares to `mission.xp_gain/supplies_cost`, marks ✓/✗, logs `[DELTA] XP: +d (expect +exp) [m] | Supplies: -d | Cash: +d` |

### 4.6 Unblock Recovery

```python
def check_and_handle_unblock(page): # test_volcanic_clean.py:507
```
Detects reload-into-unblock screen by searching for exact text `Unblock|UNBLOCK|unblock` via `page.get_by_text(label,exact=True).count()>0`. If found: extracts 6-digit code via `re.search(r"\b(\d{6})\b", body.innerText)`, `page.locator("input").first.fill(code)`, clicks Unblock, `wait_for_load_state("networkidle",15s)`, `wait_for_timeout(2s)`, `dismiss_all_popups`, then clicks `HQ` exact. Returns `True` if handled. Swallow-all on exception.

**Called at:** startup after every navigation, at top of each mission loop, and inside engage loop before each click.

### 4.7 Navigation Helpers

| Function | Line | Strategy |
|---|---|---|
| `go_back_to_mission_list(page)` | `test_volcanic_clean.py:564` | 4-tier fallback: 1) click `Back/BACK/Close/CLOSE/×/X` exact visible → check `_can_see_mission_list`; 2) `page.keyboard.press("Escape")`; 3) click `VOLCANIC OUTLANDS` header; 4) `_full_navigate_to_volcanic(page)` |
| `_can_see_mission_list(page)` | `test_volcanic_clean.py:616` | Check 3 sentinel mission names exist anywhere on page |
| `_full_navigate_to_volcanic(page)` | `test_volcanic_clean.py:632` | Sequential clicks `HQ → Oceania → VOLCANIC OUTLANDS` each `wait_for_timeout(1s)` + `dismiss_all_popups`, return `_can_see_mission_list` |
| `navigate_to_volcanic_mission(page,mission_name)` | `test_volcanic_clean.py:653` | Calls `_full_navigate_to_volcanic` then `page.get_by_text(mission_name).first.click()` |

### 4.8 Playwright Helpers

| Function | Line | Detail |
|---|---|---|
| `dismiss_popups(page)` | `test_volcanic_clean.py:672` | Iterates `INTERRUPT_BUTTONS` exact text, clicks first visible, logs `[POPUP] name`, returns True on first click |
| `dismiss_all_popups(page)` | `test_volcanic_clean.py:687` | Loop up to 5× `dismiss_popups` until none |
| `get_mission_text(all_text,m_name,all_mission_names)` | `test_volcanic_clean.py:694` | Finds `m_name.upper()` index, then finds nearest next mission name after it, slices substring. Isolates per-mission DOM text for phase parsing. |
| `get_phase_percentage(page,m_name,all_mission_names)` | `test_volcanic_clean.py:711` | Gets `body.innerText`, slices via `get_mission_text`, regex `r"Phase.*?(100|\d{1,2})%"` case-insensitive → int else 0. Avoids false match on `250 /250 SUPPLIES`. |
| `click_mission_button(page,m_name,button_texts,all_mission_names)` | `test_volcanic_clean.py:729` | **JS tree-walker** injected via `page.evaluate`. Walks text nodes from `m_name` occurrence forward, looks for exact upper `btnTexts=["ENGAGE","RE-ENGAGE","NEXT OP"]`, clicks `el.closest('button,a,[role=button],.btn')||el`, stops and returns false if hits next mission name before finding button. Core Engage click primitive. |

### 4.9 `run():788` — Main Orchestration (Step-by-Step)

```
run() at test_volcanic_clean.py:788
├── load_config() :789 → config, uid, game_url, missions
├── NetworkCapture(config.api_host) + APIClient + OpsVerifier (prints ops ref + dumps empty JSON)
├── sync_playwright() → browser=chromium.launch(headless:config.browser.headless) :808
│   context=viewport 1280x800, page=new_page, page.on(request/response, capture.*)
└── try:   (except TargetClosedError → dump JSON, finally → browser.close + api.close)
    │
    ├─ [STEP 0] page.goto(game_url) :822 + check_and_handle_unblock
    ├─ [STEP 1] wait 5s splash, disable SplashVideo pointerEvents via evaluate :829
    ├─ [STEP 2/3] Login branch :837
    │   if raw_uid: locator("input").first.fill(uid) + get_by_text("Enter",exact).click
    │   elif SimulationKey: get_by_placeholder("SimulationKey"|"Simulation Key"|input nth1).fill → get_by_text("Simulate"|"SIMULATE").click
    │   else → error + browser.close + return
    │   wait load_state networkidle 10s + 2s + dismiss_all_popups + check_unblock
    │   Poll 30×500ms (15s) for capture.is_auth_ready() → log [AUTH-OK] or [AUTH-WARN]
    ├─ [STEP 4] get_by_text("HQ",exact).click :912 + unblock fallback
    ├─ [STEP 5] get_by_text("Oceania",exact).click :927
    ├─ [STEP 6] get_by_text("VOLCANIC OUTLANDS",exact).click :940
    │
    ├─ [STEP 7] for idx,mission in enumerate(missions): :957  (8 missions sequential)
    │   ├── print header (name, spec_steps, unlock, xp, supplies, cash range, loot)
    │   ├── check_and_handle_unblock + dump_page_state("before-mission-click")
    │   ├── if is_auth_ready: pre_mission=snapshot() → log_resources PRE-MISSION → verify_unlock(mission, level)
    │   ├── page.get_by_text(m_name).first.click(timeout2s) → error → try unblock+navigate_to_volcanic_mission else FAIL+continue
    │   ├── dump_page_state("inside-mission")
    │   │
    │   └── Engage Loop: for attempt in range(200): :1026  (caps at 200 clicks/mission)
    │       ├── if unblock → navigate_to_volcanic_mission + continue
    │       ├── pct=get_phase_percentage(page,m_name,all_names)
    │       ├── if pct==100: wait 300ms, double-check pct2==100 → mission_complete=True → break
    │       ├── pre_engage = snapshot() if is_auth_ready else None  (BEFORE click)
    │       ├── click_mission_button(page,m_name,["Engage","RE-ENGAGE","NEXT OP"],all_names)
    │       │   ├── if clicked: engage_count+=1 log [ENGAGE] Click #N | Phase pct%
    │       │   ├── else: log [INFO] No Engage, dump no-engage-button, wait 500ms, dismiss popups, RETRY click
    │       │   │   ├── if retry clicked → count++
    │       │   │   └── else: final_pct=get_phase_percentage → if >=100 complete else break
    │       │   └── except: unblock check → navigate else dump engage-click-failed, dismiss, retry click logic
    │       ├── wait 300ms + dismiss_popups
    │       └── if pre_engage and should_verify: post_engage=snapshot() → log POST-ENGAGE + log_resource_delta → verifier.verify_engage(mission,pre,post,engage_count,pct)  ← EVERY click
    │   │
    │   ├── Post-mission: if mission_complete and is_auth_ready: post_mission=snapshot() → log POST-MISSION → verifier.verify_mission_rewards(mission, pre_mission.cash, post_mission.cash)
    │   │   results[m_name]= PASS if all checks for mission pass else FAIL
    │   └── go_back_to_mission_list(page) or _full_navigate_to_volcanic + wait 500ms + dismiss_all
    │
    ├── Mission Results: print [✓/✗] name: PASS/FAIL :1160
    ├── verifier.print_summary() — full check table + TOTAL passed/total pct
    ├─ [STEP 8] get_by_text("HQ",exact).click :1172
    ├─ [STEP 9] get_by_text("Settings",exact).click :1183
    ├─ [STEP 10] get_by_text("Logout",exact).click :1193
    └── Final Report: log auth_params truncated + [DONE]
```

**Mission completion = `get_phase_percentage()==100` double-confirmed.** Engage loop breaks on 100% or missing Engage button. `results` dict doubles as human-readable summary; `verifier.results` is source-of-truth JSON.

---

## 5. Dashboard — `dashboard/` Deep Dive

### 5.1 Build System

- `vite.config.ts:1` — `defineConfig({plugins:[figmaAssetResolver(), react(), tailwindcss()], resolve:{alias:{'@':path.resolve(__dirname,'./src')}}, assetsInclude:['**/*.svg','**/*.csv']})`
- `figmaAssetResolver` resolves `figma:asset/*` → `src/assets/*` (legacy Make import)
- `src/styles/index.css:1` → imports `fonts.css` (Inter + JetBrains Mono Google Fonts), `tailwind.css` (`@import 'tailwindcss' source(none); @source '../**/*.{js,ts,jsx,tsx}';`), `theme.css`
- `default_shadcn_theme.css` — original shadcn tokens (oklch) — **overridden** by `theme.css` Google-design tokens at runtime.

### 5.2 Entry & State Machine

**`src/main.tsx:1`**
```tsx
import {createRoot} from "react-dom/client"; import App from "./app/App.tsx"; import "./styles/index.css";
createRoot(document.getElementById("root")!).render(<App />);
```

**`src/app/App.tsx:24` — App State:**
```tsx
const [data, setData] = useState<DashboardData|null>(null);
const [selectedMission, setSelectedMission] = useState<number|null>(null);
const [viewMode, setViewMode] = useState<'auto'|'summary'|'live'>('auto'); // auto = figma default
const [status, setStatus] = useState<'waiting'|'live'|'complete'|'error'>('waiting');
const POLL_MS = 1000;
```

| Function | Line | Logic |
|---|---|---|
| `isExecutionComplete(d)` | `App.tsx:30` | `complete = Set(summary.missions_complete)`, returns `metadata.missions.every(m=>complete.has(m.name))` — **all 8 missions Complete** |
| `shouldShowSummary()` | `App.tsx:36` | If `viewMode==='summary'` → true, `viewMode==='live'` → false, else `isExecutionComplete(data)` — auto-switch to summary on full run |
| `poll()` | `App.tsx:42` | Tries URLs `['/verification_results.json','/@fs/../verification_results.json']` sequentially, each `fetch(url+'?t='+Date.now(), {cache:'no-store', signal:AbortController 5s})`. On `resp.ok` → `setData(newData)`, `setStatus(execComplete?'complete': results.length>0?'live':'waiting')`, return. If both fail → `setStatus('error')`. Cache-bust via `?t=` ensures Vite doesn't serve stale. |
| `useEffect poll` | `App.tsx:76` | `poll()` immediately + `setInterval(poll,1000)` cleanup on unmount |
| `useEffect auto-select` | `App.tsx:82` | If `data` arrives and no `selectedMission`, pick `firstWithData = missions.find(m=>results.some(r=>r.mission_id===m.id)) ?? missions[0]` |
| `showViewToggle` | `App.tsx:102` | Only when `execComplete===true` — hides Summary/Live toggle during live run |

**Layout `App.tsx:95`:**
```
<div flex-col h-screen bg-[var(--bg-base)]>
  <TopBar data,status,viewMode,onViewModeChange,showViewToggle />
  <div flex flex-1 overflow-hidden>
    <Sidebar data,selectedMission,onSelectMission,showSummary />
    <main flex-1 flex-col overflow-hidden>
      {!results.length && <EmptyState />}
      {results.length>0 && showSummary && <ExecutionSummary data />}
      {results.length>0 && !showSummary && selectedMission && <MissionView data missionId />}
    </main>
  </div>
</div>
```

### 5.3 `TopBar.tsx:9` — Header

- Stats: `total/summary.total`, `passed`, `failed=total-passed`, `rate=round(passed/total*100)` → 4 `StatPill` components (Total/Passed/Failed/Pass rate)
- `last_updated` → `new Date().toLocaleTimeString([hour,minute,second])`
- `statusConfig` map for badge color: `live/complete→pass`, `waiting→gray`, `error→fail`; pulse dot animates only on `live`
- Logo block (blue triangle) + divider + stats + right controls (Summary/Live toggle + status pill with timestamp)
- Pill variants: `pass→var(--pass)`, `fail→var(--fail)`, default→`var(--text-primary)`

### 5.4 `Sidebar.tsx:8` — Mission Navigator

- `missions = metadata.missions`, `results`, `complete=Set(missions_complete)`, `engageResults=results.filter(r.type==='engage')`, `lastMissionId = engages.at(-1).mission_id` — determines `isRunning`
- Per-mission derived:
  ```tsx
  mResults = results.filter(r.mission_id===mission.id && type==='engage')
  checks = mResults.flatMap(r.checks)
  hasData = mResults.length>0
  isDone = complete.has(mission.name)
  isRunning = !isDone && id===lastMissionId
  status = !hasData?'pending' : isDone? (all pass?'pass':'fail') : isRunning?'live' : (all pass?'pass':'fail')
  specRange = parseInt(spec_steps.split('-')[1]) - parseInt(split[1])+1  || 10  // mission 1: 18-10+1=9
  progressPct = isDone?100 : min(100, round(mResults.length/specRange*100))
  isActive = selectedMission===id && !showSummary
  ```
- Visual: `256px` fixed sidebar, `bg-[var(--bg-sidebar)]`, header "Missions", nav with gap-0.5, each row `px-3 py-2.5 rounded-lg` with `bg-[var(--blue-light)]` when active else hover `bg-[var(--bg-surface-2)]`, row shows name + Clicks/XP stats + `StatusBadge` + 1px progress bar (`pass→pass-mid`, `fail→fail-mid`, `live→blue-mid`)
- Footer: `{missions.length} missions · Verification suite`
- Click → `onSelectMission(id)` → sets viewMode to `live` (exits auto-summary)

### 5.5 `MissionView.tsx:6` — Per-Mission Live Table

- Props: `data, missionId`; finds `mission=missions.find(id===missionId)` else null
- Derives: `mResults=results.filter(mission_id===id)`, `engages=filter type==='engage'`, `isDone`, `allChecks`, `allPass`, `statusLabel/Variant`
- Header: `mission.name` + `StatusChip` + `Spec {spec_steps} · Unlock level {n} · ID {id}` + right `MetaChip`s: Clicks verified, XP/engage, Supplies/engage, Cash range (fmt B/M)
- Empty: centered icon + "No results for this mission yet"
- Table columns (fixed): `# | Time | Type | Phase | XP before→after | Supplies before→after | XP check | Supply check | Cash reward | Status`
- `ResultRow:116`: determines `isEngage/isReward/allPass/typeLabel/typeColor`, finds `xpCheck/supCheck/cashCheck` by field, renders `PhaseBar` (h1.5 rounded), `ResourceCell` (before › after + delta pill colored by check.pass), `CheckCell` (exp/act), cash span, Pass/Fail badge.
- Helpers: `PhaseBar:182` (bar + pct text), `ResourceCell:196` (before/after/delta), `CheckCell:218` (✓/✗ + expected/got), `StatusChip:93`, `MetaChip:106`

### 5.6 `ExecutionSummary.tsx:5` — Post-Run Report

- Destructures `metadata,results,summary`; `completeSet`, `total/passed/failed/allPass/passRate`, `startTime/last_updated`, helpers `fmtTime`, `fmtDuration`, `fmt`, `fmtCash`
- Aggregates toggles: `engages=filter engage`; `firstSnap = engages.find(before.xp>0)`, `lastSnap = reversed.find(after.xp>0)` → `totalXP=last.after.xp-first.before.xp`, `totalSup=first.before.supplies-last.after.supplies`, `totalCash=last.after.cash-first.before.cash`
- `allFailures = results.flatMap(checks.filter(!pass).map(c=>{mission,type,click,...c}))`
- Sections:
  1. **Banner:** green `pass-light` if allPass else `fail-light`, icon ✓/✗, title "All checks passed"/"Execution complete", subtitle with mission count + duration, right PASS/failed pill
  2. **Stats grid 4:** Total checks / Passed / Failed / Pass rate
  3. **Time row 3:** Start / End / Duration
  4. **Resources 3:** Total XP earned (+fmt) / supplies used (-fmt) / cash earned (fmtCash)
  5. **Mission breakdown grid:** auto-fill 260px cards, each: name + Incomplete/Pass/Fail badge, MiniStats (Clicks/Checks/Passed/Failed), progress bar, optional loot_unit gold card (`warn-light`, ★ + ATK/DEF)
  6. **Failures (if any):** max-h 360px scroll, each row `fail-light` with ✗ + mission + field + type + expected→got
  7. **Footer:** Verification report · N missions + time range

### 5.7 `EmptyState.tsx:1` — Waiting Screen

Centered 16×16 dashed circle + spinner (12s rotation), title "Waiting for test data", subtitle, code pill `py test_volcanic_clean.py`, footer pulse dot "Polling every second".

### 5.8 `theme.css:3` — Design System

```css
:root {
  --bg-base:#f8f9fa; --bg-surface:#fff; --bg-surface-2:#f1f3f4; --bg-sidebar:#f8f9fa;
  --bg-row:#fff; --bg-row-alt:#fafafa; --bg-row-hover:#f0f4ff;
  --border:#dadce0; --border-light:#e8eaed; --border-focus:#1a73e8;
  --blue:#1a73e8; --blue-light:#e8f0fe; --blue-mid:#4285f4;
  --pass:#1e8e3e; --pass-light:#e6f4ea; --pass-mid:#34a853;
  --fail:#d93025; --fail-light:#fce8e6; --fail-mid:#ea4335;
  --warn:#f29900; --warn-light:#fef7e0;
  --text-primary:#202124; --text-secondary:#5f6368; --text-tertiary:#9aa0a6;
  --font-display:'Inter'; --font-ui:'Inter'; --font-mono:'JetBrains Mono';
}
```
Animations: `pulse-dot 1.6s`, `spin-slow 10s`, `row-in 0.8s` (blue flash for new row), `fade-up 0.4s`, `badge-pulse 1.2s`
Table `th:236` → `padding 10px 12px, font 11px/600, color secondary, bg #f8f9fa, border-bottom #dadce0`
Scrollbar thin `#dadce0` / `#bdc1c6` hover.

---

## 6. Data Contract — `verification_results.json:1`

### 6.1 Top-Level Shape

```jsonc
{
  "metadata": {
    "start_time": "2026-08-24T17:23:40.775874",   // iso from datetime.now().isoformat()
    "last_updated": "2026-08-24T17:26:01.464306", // updated on every _dump_json()
    "missions": [ /* 8 objects: id, name, spec_steps, unlock_level, xp_gain, supplies_cost, cash_min, cash_max, loot_unit */ ]
  },
  "results": [ /* N records in chronological order — one per verification event */ ],
  "summary": {
    "total": 140,                // sum of all checks.length
    "passed": 138,               // sum where c.pass===true
    "missions_complete": ["Capture the Lava Watch Post"] // names pushed in verify_mission_rewards
  }
}
```

### 6.2 Result Record Variants

**`type:"engage"` — per-click (bulk of data) at `test_volcanic_clean.py:318`:**
```jsonc
{
  "mission": "Capture the Lava Watch Post",
  "mission_id": 1,
  "type": "engage",
  "click_number": 7,              // monotonically increasing per mission (1-indexed, counted only on successful click_mission_button)
  "phase_pct": 56,                // from get_phase_percentage before click, 0..97 then 100
  "timestamp": "14:28:44",        // HH:MM:SS at verify moment
  "before": { "xp": 8400, "supplies": 1440, "cash": 9200000, "level": 162 },
  "after":  { "xp": 8480, "supplies": 1350, "cash": 9200000, "level": 162 },
  "checks": [
    { "field": "xp",       "op": "attain",  "expected": "+80",  "actual": "+80",  "pass": true },
    { "field": "supplies", "op": "consume", "expected": "-90",  "actual": "-90",  "pass": true }
  ]
}
```

**`type:"unlock_check"` at `test_volcanic_clean.py:377`:**
```jsonc
{
  "mission": "...", "mission_id": 1, "type": "unlock_check", "click_number": 0, "phase_pct": 0,
  "timestamp": "17:24:12",
  "before": { "level": 162 }, "after": { "level": 162 },
  "checks": [{ "field": "level", "op": "unlock", "expected": ">= 160", "actual": "162", "pass": true }]
}
```

**`type:"mission_reward"` at `test_volcanic_clean.py:351`:**
```jsonc
{
  "mission": "...", "mission_id": 1, "type": "mission_reward", "click_number": 0, "phase_pct": 100,
  "timestamp": "17:24:13",
  "before": { "cash": 9200000 }, "after": { "cash": 18400000 },
  "checks": [{ "field": "cash", "op": "reward", "expected": "9,200,000 – 15,000,000", "actual": "9,200,000", "pass": true }]
}
```

**Check object canonical:** `{field:str, op:str, expected:str, actual:str, pass:bool}` at `test_volcanic_clean.py:415`.

**Empty / failure example:** When `level==0` (unauthenticated) → `unlock_check` fails `pass:false` as seen in `verification_results.json:104-125`.

### 6.3 Write Semantics

- Atomic: `open(tmp,"w") → write → os.replace(tmp,path)` at `test_volcanic_clean.py:270` prevents dashboard reading half-written JSON.
- Dual paths at `test_volcanic_clean.py:242` — script dir (canonical) + `dashboard/public/` (Vite static). Poll tries both URLs.
- Frequency: **every verification** — `verify_engage` (each click), `verify_unlock` (per mission entry), `verify_mission_rewards` (twice: once before push, once after).

---

## 7. End-to-End Runtime Flow (Sequence)

```
User: cd "D:\Playwright_Testing_Studies\Mission Set\v3.0.2\dashboard" && npm install && npm run dev
      → Vite @ http://localhost:5173, serves dashboard/public/verification_results.json
      Dashboard App mounts → EmptyState → poll() every 1s → status: waiting

User (second terminal): py test_volcanic_clean.py
      → load_config() → prints [CONFIG]
      → OpsVerifier.__init__ → prints OPS DOCUMENTATION REFERENCE → dumps empty JSON (metadata+empty results)
           → Dashboard poll picks up metadata → Sidebar shows 8 missions (all Pending)
      → browser launch (Chromium visible 1280×800) → goto game_url
      → Splash 5s + disable video pointerEvents
      → Login: UID vs SimulationKey branch → Enter/Simulate click → networkidle → dismiss popups
      → Wait max 15s for auth (is_auth_ready: __u,__t,__s) → [AUTH-OK] or [AUTH-WARN]
      → HQ → Oceania → VOLCANIC OUTLANDS navigation
      → Loop 8 missions:

        For each mission:
          verify_unlock → JSON (unlock_check) → Sidebar may show live
          click mission name → enter mission UI
          Loop up to 200 engages:
            pct = Phase X% (parsed from isolated mission_text)
            if 100% twice → break (mission complete)
            before = snapshot() from latest_ls (or POST user/get fallback)
            click Engage via JS tree-walker (Engage/RE-ENGAGE/NEXT OP)
              handle popups, unblock, retries
            after = snapshot()
            verify_engage(before,after,click#,pct) → JSON engage record (≈300ms after click)
              → Dashboard poll (≤1s) appends row to MissionView table, Sidebar progress updates

          if complete: verify_mission_rewards (cash delta ∈ range) → JSON mission_reward
          go_back_to_mission_list (4-tier fallback) → next mission

      → All 8 done → summary.missions_complete has 8 entries → isExecutionComplete==true
        → Dashboard auto-switches to ExecutionSummary (banner + stats + breakdown + failures)
      → HQ → Settings → Logout → Final Report (auth params) → browser.close + api.close

Edge: TargetClosedError anywhere → catch at test_volcanic_clean.py:1213 → _dump_json() → finally close
```

**Timing:** Each Engage ≈ 300ms wait + 500ms auth polls + UI waits. Mission with ~30 engages ≈ 15–25s. Full 8-mission run ≈ 2–5 min.

---

## 8. Verification Ops — Truth Table

| Op | Field | Expected Source | Actual Source | Pass Condition | Log Tag | Record Type |
|---|---|---|---|---|---|---|
| `attain` | `xp` | `mission.xp_gain` `config.json:44` | `after.xp - before.xp` `test_volcanic_clean.py:305` | `delta == xp_gain` | `[✓] ATTAIN xp: expected +80, got +80` | engage |
| `consume` | `supplies` | `mission.supplies_cost` | `before.supplies - after.supplies` `test_volcanic_clean.py:312` | `delta == supplies_cost` | `[✓] CONSUME supplies: expected -90, got -90` | engage |
| `reward` | `cash` | `[cash_min, cash_max]` | `cash_after - cash_before` `test_volcanic_clean.py:345` | `min <= earned <= max` | `[✓] REWARD cash: expected 9,200,000 – 15,000,000, got 9,200,000` | mission_reward |
| `unlock` | `level` | `mission.unlock_level` | `snapshot().level` `test_volcanic_clean.py:372` | `level >= unlock_level` | `[✓] UNLOCK level: expected >= 160, got 162` | unlock_check |

**Failure examples observed** (`verification_results.json:237-252`):
- `xp actual "+2657845" vs expected "+145"` → first engage after state sync glitch (`before.xp=0`)
- `supplies "--110"` (double negative) → `before.supplies - after.supplies = 111-221 = -110` but code does `f"-{sup_delta}"` where `sup_delta` already negative → display bug (logic still fails correctly)
- `cash "11,964,913,976,721"` far outside `99M–490M` → global cash inflated, indicates game economy bug or snapshot field mismatch

---

## 9. Error Handling & Resilience Matrix

| Failure | Location | Handling | Outcome |
|---|---|---|---|
| Config missing | `test_volcanic_clean.py:33` | `print [ERROR] + sys.exit(1)` | Hard exit |
| API timeout 10s | `test_volcanic_clean.py:155` | `except Timeout → [API-TIMEOUT]` return `{}` | Verification skipped for that click (no snapshot → no verify) |
| API connection error | `test_volcanic_clean.py:157` | `→ [API-CONN]` return `{}` | Same |
| Non-200 API | `test_volcanic_clean.py:154` | `→ [API-ERROR] status` return `{}` | Same |
| Auth not ready after 15s | `test_volcanic_clean.py:907` | `→ [AUTH-WARN] continue anyway` | Runs without verification (snapshot returns {} → guards prevent verify) |
| HQ/Oceania/Volcanic click fail | `test_volcanic_clean.py:914` | `if not check_and_handle_unblock → print [ERROR] + browser.close + return` | Abort run but finally still dumps JSON |
| Mission not found | `test_volcanic_clean.py:1000` | `results[m_name]="FAIL" + continue` | Skip mission |
| Engage button not found | `test_volcanic_clean.py:1059` | Dump UI, dismiss popups, retry `click_mission_button` once; else `final_pct` check → break if 100 else FAIL | Graceful mission end |
| Phase parse fail | `test_volcanic_clean.py:725` | `return 0` | Engage loop continues (pct 0 logged) |
| Unblock code not found | `test_volcanic_clean.py:528` | `→ [UNBLOCK-ERROR] + return False` | Unblock not handled, loop will retry |
| Browser closed externally | `test_volcanic_clean.py:1213` | `except TargetClosedError → _dump_json()` | Data saved |
| JSON write fail | `test_volcanic_clean.py:274` | `→ [JSON-WARN] Could not write path: e` | Continue, try other path |
| Dashboard fetch fail | `App.tsx:68` | Try next URL, fallback to `status:error` | Shows error badge, retries next poll |
| Viewport / headless | `config.json:7` | `browser.launch(headless:...) + new_context viewport` | Configurable |

**Guaranteed cleanup:** `finally:344` at `test_volcanic_clean.py:1217` — `browser.close()` + `api.close()` swallow-all, even after `TargetClosedError`.

---

## 10. UI State & Navigation State Machines

### 10.1 Mission Lifecycle

```
Pending (no results)
  → verify_unlock (unlock_check written)
  → click mission name (enter mission UI)
  → Engaging (engage records accumulating, Sidebar: Live / MissionView: In progress)
    → Phase 0% → ... → 97% (multiple clicks, pct increments ~2-3% per click)
    → Phase 100% (double-checked) → mission_complete=True
  → verify_mission_rewards → summary.missions_complete += name
  → go_back_to_mission_list → next mission
  → Final: Complete (allPass?) or Completed with failures
```

### 10.2 Dashboard View Machine (`App.tsx:36`)

```
viewMode: auto (default)
  isExecutionComplete? → show ExecutionSummary (auto)
  else → show MissionView for selectedMission

User clicks Sidebar mission → setViewMode('live') forces MissionView
User clicks TopBar toggle (only when execComplete):
  Summary → ExecutionSummary
  Live table → MissionView
```

---

## 11. How to Run (Exact Commands)

```bash
# Terminal 1 — Dashboard
cd "D:\Playwright_Testing_Studies\Mission Set\v3.0.2\dashboard"
npm install        # or pnpm install (pnpm-workspace.yaml present)
npm run dev        # → http://localhost:5173 (Vite)

# Terminal 2 — Test (wait until dashboard shows "Waiting for test data")
cd "D:\Playwright_Testing_Studies\Mission Set\v3.0.2"
py test_volcanic_clean.py
# Options:
# - Edit config.json uid/SimulationKey before run
# - Set "browser": {"headless": true} for CI
# - Observe live table rows appearing per-click, then ExecutionSummary on completion
```

**Prerequisites:** Python 3.10+, `pip install playwright requests`, `playwright install chromium`, Node 18+.

---

## 12. Guide for AI — How to Modify / Extend

### 12.1 Adding a 9th Mission
1. Append to `config.json:38` missions array with `id:9, name:"...", unlock_level, xp_gain, supplies_cost, cash_min/max, spec_steps`
2. No Python change needed — `run():953` iterates `config["missions"]` dynamically.
3. Dashboard auto-renders (Sidebar + ExecutionSummary iterate `metadata.missions`).

### 12.2 Changing Verification Logic
- Edit `verify_engage:292` or `verify_mission_rewards:343` — add new checks via `_check(field,op,expected,actual,pass)`.
- Example: add `cash` per-click check → compute `cash_delta` and `_check("cash","earn",...)`.
- Remember `_dump_json()` is called after each append — no need to add.

### 12.3 Changing Poll Interval or URLs
- `App.tsx:22` `POLL_MS=1000` — increase to 2000 for lower load, decrease to 500 for snappier.
- URLs array `App.tsx:44` — add `'/api/verification_results.json'` if serving via proxy.

### 12.4 Fixing the Supplies Display Bug
At `test_volcanic_clean.py:312`:
```python
sup_delta = before.get("supplies",0) - after.get("supplies",0)  # can be negative if supplies increased
# currently: f"-{sup_delta}" produces "--110" when sup_delta negative
# fix: actual = f"{'-' if sup_delta>=0 else '+'}{abs(sup_delta)}" or simply f"{sup_delta}" with sign
```
Update both `expected`/`actual` formatting and `sup_ok` logic if semantics change.

### 12.5 Adding a New Op (e.g., `upkeep`)
1. Document in `config.json:13` `ops_doc.upkeep`
2. Extend `mission` schema with `upkeep_cost`
3. Add storage in `APIClient.get_resources()` if new `_ls` field (e.g., `_ls.upkeep`)
4. Add check in `verify_engage` similar to xp/supplies.

### 12.6 Switching to Headless / CI
Set `config.json:7` `"headless": true` — no code change. Note: some `wait_for_timeout` values may need increase if CI slower.

### 12.7 Rules for AI Edits
- **Never** rename `mission.name` without updating game UI expectation — locator is exact text match.
- **Never** remove `os.replace` atomic write — dashboard will read corrupt JSON.
- **Always** keep `_ls` field mapping in sync between `APIClient:163` and `OpsVerifier` checks.
- **Always** test with `py test_volcanic_clean.py` dry run (even without real API, verify JSON still dumps and dashboard renders EmptyState → live rows).
- Paths **contain spaces** (`Mission Set`) — always quote in bash: `cd "D:\Playwright_Testing_Studies\Mission Set\v3.0.2"`

---

## 13. File Reference Index (line-precise)

| File | Key Symbol | Line |
|---|---|---|
| `test_volcanic_clean.py` | `load_config` | `28` |
| `test_volcanic_clean.py` | `NetworkCapture` | `51` |
| `test_volcanic_clean.py` | `on_request` | `60` |
| `test_volcanic_clean.py` | `on_response` | `78` |
| `test_volcanic_clean.py` | `APIClient` | `106` |
| `test_volcanic_clean.py` | `get_resources` | `163` |
| `test_volcanic_clean.py` | `OpsVerifier` | `200` |
| `test_volcanic_clean.py` | `_dump_json` | `253` |
| `test_volcanic_clean.py` | `verify_engage` | `292` |
| `test_volcanic_clean.py` | `verify_mission_rewards` | `343` |
| `test_volcanic_clean.py` | `verify_unlock` | `371` |
| `test_volcanic_clean.py` | `dump_page_state` | `428` |
| `test_volcanic_clean.py` | `check_and_handle_unblock` | `507` |
| `test_volcanic_clean.py` | `go_back_to_mission_list` | `564` |
| `test_volcanic_clean.py` | `_full_navigate_to_volcanic` | `632` |
| `test_volcanic_clean.py` | `click_mission_button` | `729` |
| `test_volcanic_clean.py` | `run` | `788` |
| `config.json` | `missions` | `38` |
| `dashboard/src/app/App.tsx` | `App` | `24` |
| `dashboard/src/app/App.tsx` | `poll` | `42` |
| `dashboard/src/app/components/TopBar.tsx` | `TopBar` | `9` |
| `dashboard/src/app/components/Sidebar.tsx` | `Sidebar` | `8` |
| `dashboard/src/app/components/MissionView.tsx` | `MissionView` | `6` |
| `dashboard/src/app/components/ExecutionSummary.tsx` | `ExecutionSummary` | `5` |
| `dashboard/src/styles/theme.css` | `:root tokens` | `3` |
| `dashboard/vite.config.ts` | `defineConfig` | `19` |

---

## 14. Known Gotchas & Invariants

1. **Level 0 trap:** If auth fails, `get_resources()` returns `{level:0}` → all `unlock_check` fail but script still continues clicking missions (see `verification_results.json:104` first run). Check `[AUTH-OK]` log — if missing, no verification will be meaningful.
2. **Supplies increase bug:** Some engages show supplies *increase* (e.g., 111→221) — this is game resupply or intercept `_ls` lag, not a test bug. `consume` check correctly fails (`--180`).
3. **Cash explosion:** `verification_results.json:1454` shows cash `11,964,913,976,721` far above range — likely `_ls.c` cumulative, not per-mission earned. `verify_mission_rewards` does `cash_after-pre_mission.cash` which includes all prior earnings if game doesn't reset.
4. **Phase non-monotonic:** Mission 3 `phase_pct` jumps 41%→44%→47% but also shows 11% after 28% — indicates phase resets when crossing internal op boundaries or stale `get_phase_percentage` slicing. Dashboard's `PhaseBar` still renders correctly.
5. **Spaces in path:** `Mission Set` requires quoting in every shell command; unquoted `cd` fails.
6. **Dual JSON stale:** If `dashboard/public/` missing at startup, only root JSON written. Create dir manually if dashboard shows `waiting` forever despite script logging verifies.
7. **Vite cache:** Poll uses `?t=Date.now()` + `cache:'no-store'` to bust Vite's aggressive caching for `public/` assets.
8. **200 cap:** Engage loop `range(200)` prevents infinite hang if phase never reaches 100%.

---

## 15. TL;DR for AI Prompt Injection

> **System prompt you can prepend:**
> ```
> You are working on Volcanic Ops v3.0.2 (D:\Playwright_Testing_Studies\Mission Set\v3.0.2\).
> Python: test_volcanic_clean.py:788 run() drives Playwright Chromium through
>   Splash → UID/SimulationKey login → HQ→Oceania→VOLCANIC OUTLANDS → 8 missions sequential.
> Each mission: verify_unlock → JS tree-walker click Engage (up to 200×) with before/after snapshots
>   from NetworkCapture.latest_ls (auth __u/__t/__s) via APIClient.get_resources() →
>   OpsVerifier.verify_engage checks XP attain (+xp_gain) + supplies consume (-supplies_cost)
>   every click, then verify_mission_rewards (cash ∈ [min,max]) on 100% phase.
> JSON: {metadata, results[], summary} atomically dual-written to ./verification_results.json
>   and dashboard/public/verification_results.json via os.replace.
> Dashboard: dashboard/src/app/App.tsx:24 polls 1s (two URLs, cache-bust) → TopBar/Sidebar/
>   MissionView/ExecutionSummary (theme.css tokens). View auto-switches to summary when
>   summary.missions_complete covers all 8 missions.
> Config: config.json:38 missions[] (name must match DOM exact text), ops_doc, browser headless/viewport, api_host.
> Invariants: name exact match, atomic write, _ls mapping lv/xp/c/s→level/xp/cash/supplies, path has spaces (quote).
> ```

---

*Generated for AI comprehension — covers 100% of codebase. Keep in sync when adding missions, ops, or UI components.*
