# VOLCANIC OPS — Live Verification Dashboard

## What changed in `test_volcanic_clean.py` (v3)

| # | Change | Detail |
|---|--------|--------|
| 1 | **Per-click verification** | Removed all `verify_every_n_engages` / `% verify_freq` logic. Every single Engage click now takes a pre/post snapshot and runs full XP + Supplies verification. |
| 2 | **Enriched JSON output** | Each result record now includes: `mission_id`, `click_number`, `phase_pct`, `timestamp`, `before` snapshot `{xp, supplies, cash, level}`, `after` snapshot. |
| 3 | **JSON structure** | File now has three top-level keys: `metadata` (mission configs + timestamps), `results` (array of every check), `summary` (totals + completed missions). |
| 4 | **Dual-write** | Writes to both `verification_results.json` (script dir) **and** `dashboard/public/verification_results.json` whenever that directory exists. Uses atomic `os.replace()` to avoid partial reads. |
| 5 | **TargetClosedError handling** | Wraps the entire test body in `try/except/finally` — saves all data and exits cleanly if the browser closes unexpectedly. Always cleans up browser + HTTP session. |
| 6 | **Syntax fixes** | Fixed duplicate interrupt buttons, removed debug response text leak, added API timeout handling, added auth wait timeout (15s). |

---

## Dashboard quick-start

### Requirements
- Node.js 18+ (check with `node -v`)

### 1 — Install

```bash
cd D:\Playwright_Testing_Studies\v3.0.1\dashboard
npm install
```

### 2 — Start dev server

```bash
npm run dev
```

Vite opens `http://localhost:5173` automatically.

### 3 — Run the test (in a separate terminal)

```bash
cd D:\Playwright_Testing_Studies\v3.0.1
py test_volcanic_clean.py
```

Watch the dashboard update live as the Playwright script runs. Every Engage click appears as a new row within ~1 second.

---

## File layout

```
v3.0.1/
├── test_volcanic_clean.py          ← Python script (v3)
├── config.json                     ← mission config + API keys
├── verification_results.json       ← auto-created by script (primary)
├── README.md
│
└── dashboard/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── src/
    │   ├── main.js
    │   └── style.css
    └── public/
        └── verification_results.json  ← auto-updated by script (for Vite)
```

---

## JSON schema

```jsonc
{
  "metadata": {
    "start_time": "2026-05-28T14:23:01",   // ISO timestamp when script started
    "last_updated": "2026-05-28T14:31:45", // ISO timestamp of last write
    "missions": [ /* mission config objects from config.json */ ]
  },
  "results": [
    {
      "mission":      "Capture the Lava Watch Post",
      "mission_id":   1,
      "type":         "engage",            // engage | mission_reward | unlock_check
      "click_number": 7,
      "phase_pct":    56,
      "timestamp":    "14:28:44",
      "before":  { "xp": 8400, "supplies": 1440, "cash": 9200000, "level": 162 },
      "after":   { "xp": 8480, "supplies": 1350, "cash": 9200000, "level": 162 },
      "checks": [
        { "field": "xp",       "op": "attain",  "expected": "+80", "actual": "+80", "pass": true },
        { "field": "supplies", "op": "consume", "expected": "-90", "actual": "-90", "pass": true }
      ]
    }
  ],
  "summary": {
    "total":              140,   // total individual checks run
    "passed":             138,   // checks that passed
    "missions_complete":  ["Capture the Lava Watch Post"]
  }
}
```
