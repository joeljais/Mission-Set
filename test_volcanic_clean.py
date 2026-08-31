import json
import os
import time
import datetime
import requests
import sys
import re
from urllib.parse import parse_qs
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
try:
    from playwright._impl._errors import TargetClosedError
except ImportError:
    # Fallback for older Playwright versions
    TargetClosedError = Exception

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")


# ═══════════════════════════════ UTILITIES ═══════════════════════════════


def print_flush(text):
    print(text)
    sys.stdout.flush()


def load_config():
    """Load configuration from config.json next to this script."""
    config_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "config.json"
    )
    if not os.path.exists(config_path):
        print_flush(f"[ERROR] Config not found: {config_path}")
        sys.exit(1)
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    uid_val = config.get('uid', '') or config.get('SimulationKey', '')
    print_flush(f"[CONFIG] Loaded — ID={uid_val}  API={config['api_host']}")
    print_flush(f"[CONFIG] Game URL: {config['game_url'][:60]}...")
    print_flush(f"[CONFIG] Missions: {len(config['missions'])}")
    return config


INTERRUPT_BUTTONS = ["Deploy", "Continue", "Received", "Affirmative", "Roger", "NO", "Close", "\u00d7", "X"]


# ═══════════════════════════════ NETWORK CAPTURE ═══════════════════════════════


class NetworkCapture:
    """Intercepts Playwright network traffic to extract auth params and API responses."""

    def __init__(self, api_host: str):
        self.api_host = api_host
        self.auth_params = {}
        self.api_responses = {}
        self.latest_ls = {}

    def on_request(self, request):
        url = request.url
        if self.api_host not in url:
            return
        try:
            post_data = request.post_data
            if post_data and "application/x-www-form-urlencoded" in request.headers.get(
                "content-type", ""
            ):
                params = parse_qs(post_data, keep_blank_values=True)
                flat = {k: v[0] if len(v) == 1 else v for k, v in params.items()}
                auth_keys = ["__u", "__t", "__s", "__l", "__v"]
                if all(k in flat for k in auth_keys) and not self.auth_params:
                    self.auth_params = {k: flat[k] for k in auth_keys}
                    print_flush("[NET] Auth params captured")
        except Exception:
            pass

    def on_response(self, response):
        url = response.url
        if self.api_host not in url:
            return
        try:
            if "application/json" not in response.headers.get("content-type", ""):
                return
            body = response.json()
            path = url.split("/api/")[-1].split("?")[0]
            self.api_responses[path] = body
            if "_ls" in body and isinstance(body["_ls"], dict):
                self.latest_ls.update(body["_ls"])
        except Exception:
            pass

    def get_auth_param(self, key):
        return self.auth_params.get(key, "")

    def is_auth_ready(self):
        return all(k in self.auth_params for k in ["__u", "__t", "__s"])

    def get_last_response(self, endpoint):
        return self.api_responses.get(endpoint, {})


# ═══════════════════════════════ API CLIENT ═══════════════════════════════


class APIClient:
    """Sends requests to the game API using captured auth tokens."""

    def __init__(self, config: dict, capture: NetworkCapture):
        self.config = config
        self.uid = config.get("uid", "") or config.get("SimulationKey", "")
        self.capture = capture
        self.api_base = f"https://{config['api_host']}/api"
        self.session = requests.Session()
        origin = config.get("origin", f"https://{config['api_host']}")
        self.session.headers.update(
            {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": origin,
                "Referer": origin + "/",
            }
        )

    def close(self):
        """Close the underlying HTTP session."""
        try:
            self.session.close()
        except Exception:
            pass

    def _build_params(self, extra: dict = None) -> dict:
        params = {
            "_dc": str(int(time.time() * 1000)),
            "__u": self.capture.get_auth_param("__u"),
            "__t": self.capture.get_auth_param("__t"),
            "__s": self.capture.get_auth_param("__s"),
            "__l": self.capture.get_auth_param("__l"),
            "__v": self.capture.get_auth_param("__v"),
        }
        if extra:
            params.update(extra)
        return params

    def post(self, endpoint: str, extra: dict = None) -> dict:
        params = self._build_params(extra)
        try:
            resp = self.session.post(
                f"{self.api_base}/{endpoint}", data=params, timeout=10
            )
            if resp.ok:
                return resp.json()
            else:
                print_flush(f"[API-ERROR] {endpoint} returned status {resp.status_code}")
        except requests.exceptions.Timeout:
            print_flush(f"[API-TIMEOUT] {endpoint}: request timed out after 10s")
        except requests.exceptions.ConnectionError as e:
            print_flush(f"[API-CONN] {endpoint}: connection error — {str(e)[:60]}")
        except Exception as e:
            print_flush(f"[API-ERROR] {endpoint}: {str(e)[:50]}")
        return {}

    def get_resources(self) -> dict:
        """Get current user resources including level, using the latest intercepted network traffic."""
        ls = self.capture.latest_ls
        if ls:
            return {
                "level": ls.get("level", ls.get("lv", 0)),
                "xp": ls.get("xp", 0),
                "cash": ls.get("c", 0),
                "supplies": ls.get("s", 0),
            }

        # Fallback to actively requesting if not intercepted yet
        state = self.post("user/get")
        if not state:
            return {}

        ls_resp = state.get("_ls", {})
        if ls_resp:
            self.capture.latest_ls.update(ls_resp)
            return {
                "level": ls_resp.get("level", ls_resp.get("lv", 0)),
                "xp": ls_resp.get("xp", 0),
                "cash": ls_resp.get("c", 0),
                "supplies": ls_resp.get("s", 0),
            }

        return {
            "level": state.get("level", 0),
            "xp": state.get("xp", 0),
            "cash": state.get("cash", 0),
            "supplies": state.get("supplies", 0),
        }


# ═══════════════════════════════ OPS VERIFIER ═══════════════════════════════


class OpsVerifier:
    """
    Cross-checks every game operation against expected values from config.
    Verifies on EVERY single click — no sampling, no modulo gating.

    Operations verified
    ───────────────────
    • attain   — XP gained per Engage click  (== mission.xp_gain)
    • consume  — Supplies spent per Engage   (== mission.supplies_cost)
    • rewards  — Cash earned on mission end  (∈ [cash_min, cash_max])
    • unlock   — Player level ≥ mission.unlock_level before entry
    """

    def __init__(self, api: APIClient, config: dict):
        self.api = api
        self.config = config
        self.ops_doc = config.get("ops_doc", {})
        self.results = []
        self.start_time = datetime.datetime.now().isoformat()
        self.metadata = {
            "start_time": self.start_time,
            "last_updated": self.start_time,
            "missions": [
                {
                    "id": m["id"],
                    "name": m["name"],
                    "spec_steps": m.get("spec_steps", ""),
                    "unlock_level": m["unlock_level"],
                    "xp_gain": m["xp_gain"],
                    "supplies_cost": m["supplies_cost"],
                    "cash_min": m["cash_min"],
                    "cash_max": m["cash_max"],
                    "loot_unit": m.get("loot_unit"),
                }
                for m in config["missions"]
            ],
        }
        self.summary = {"total": 0, "passed": 0, "missions_complete": []}
        self._print_ops_reference()
        self._dump_json()

    def _resolve_output_paths(self):
        """Return list of file paths to write the JSON to."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        paths = [os.path.join(script_dir, "verification_results.json")]

        # Also write to dashboard/public/ so Vite dev server picks it up instantly
        dashboard_public = os.path.join(script_dir, "dashboard", "public")
        if os.path.isdir(dashboard_public):
            paths.append(os.path.join(dashboard_public, "verification_results.json"))

        return paths

    def _dump_json(self):
        """Atomically write verification state to all output paths."""
        self.metadata["last_updated"] = datetime.datetime.now().isoformat()
        self.summary["total"] = sum(len(r["checks"]) for r in self.results)
        self.summary["passed"] = sum(
            1 for r in self.results for c in r["checks"] if c["pass"]
        )

        payload = {
            "metadata": self.metadata,
            "results": self.results,
            "summary": self.summary,
        }
        json_str = json.dumps(payload, indent=2)

        for path in self._resolve_output_paths():
            try:
                tmp = path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(json_str)
                os.replace(tmp, path)
            except Exception as e:
                print_flush(f"[JSON-WARN] Could not write {path}: {e}")

    def _print_ops_reference(self):
        print_flush(f"\n{'═' * 70}")
        print_flush("OPS DOCUMENTATION REFERENCE")
        print_flush(f"{'═' * 70}")
        for name, info in self.ops_doc.items():
            desc = info.get("description", str(info)) if isinstance(info, dict) else info
            db = info.get("db_field", "—") if isinstance(info, dict) else "—"
            print_flush(f"  {name:15s} │ {desc}")
            if db != "—":
                print_flush(f"  {'':15s} │   db field: {db}")
        print_flush(f"{'═' * 70}\n")

    def snapshot(self) -> dict:
        return self.api.get_resources()

    def verify_engage(
        self,
        mission: dict,
        before: dict,
        after: dict,
        engage_num: int,
        phase_pct: int = 0,
    ):
        """Verify XP attain + supplies consume for a single Engage click."""
        checks = []
        ts = datetime.datetime.now().strftime("%H:%M:%S")

        # XP attain
        xp_delta = after.get("xp", 0) - before.get("xp", 0)
        exp_xp = mission["xp_gain"]
        xp_ok = xp_delta == exp_xp
        checks.append(_check("xp", "attain", f"+{exp_xp}", f"+{xp_delta}", xp_ok))
        _log_check(xp_ok, "ATTAIN", "xp", f"+{exp_xp}", f"+{xp_delta}")

        # Supplies consume
        sup_delta = before.get("supplies", 0) - after.get("supplies", 0)
        exp_sup = mission["supplies_cost"]
        sup_ok = sup_delta == exp_sup
        checks.append(_check("supplies", "consume", f"-{exp_sup}", f"-{sup_delta}", sup_ok))
        _log_check(sup_ok, "CONSUME", "supplies", f"-{exp_sup}", f"-{sup_delta}")

        self.results.append(
            {
                "mission": mission["name"],
                "mission_id": mission["id"],
                "type": "engage",
                "click_number": engage_num,
                "phase_pct": phase_pct,
                "timestamp": ts,
                "before": {
                    "xp": before.get("xp", 0),
                    "supplies": before.get("supplies", 0),
                    "cash": before.get("cash", 0),
                    "level": before.get("level", 0),
                },
                "after": {
                    "xp": after.get("xp", 0),
                    "supplies": after.get("supplies", 0),
                    "cash": after.get("cash", 0),
                    "level": after.get("level", 0),
                },
                "checks": checks,
            }
        )
        self._dump_json()

    def verify_mission_rewards(self, mission: dict, cash_before: int, cash_after: int):
        """Verify cash reward earned on mission completion."""
        earned = cash_after - cash_before
        lo, hi = mission["cash_min"], mission["cash_max"]
        ok = lo <= earned <= hi
        checks = [_check("cash", "reward", f"{lo:,} – {hi:,}", f"{earned:,}", ok)]
        _log_check(ok, "REWARD", "cash", f"{lo:,} – {hi:,}", f"{earned:,}")

        self.results.append(
            {
                "mission": mission["name"],
                "mission_id": mission["id"],
                "type": "mission_reward",
                "click_number": 0,
                "phase_pct": 100,
                "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
                "before": {"cash": cash_before},
                "after": {"cash": cash_after},
                "checks": checks,
            }
        )
        self._dump_json()

        # Mark mission as complete in summary
        if mission["name"] not in self.summary["missions_complete"]:
            self.summary["missions_complete"].append(mission["name"])
        self._dump_json()

    def verify_unlock(self, mission: dict, current_level: int) -> bool:
        """Verify player level meets the unlock requirement for a mission."""
        req = mission["unlock_level"]
        ok = current_level >= req
        checks = [_check("level", "unlock", f">= {req}", str(current_level), ok)]
        _log_check(ok, "UNLOCK", "level", f">= {req}", str(current_level))
        self.results.append(
            {
                "mission": mission["name"],
                "mission_id": mission["id"],
                "type": "unlock_check",
                "click_number": 0,
                "phase_pct": 0,
                "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
                "before": {"level": current_level},
                "after": {"level": current_level},
                "checks": checks,
            }
        )
        self._dump_json()
        return ok

    def print_summary(self):
        print_flush(f"\n{'═' * 70}")
        print_flush("OPS VERIFICATION SUMMARY")
        print_flush(f"{'═' * 70}")
        total = passed = 0
        for r in self.results:
            for c in r["checks"]:
                total += 1
                if c["pass"]:
                    passed += 1
                m = "✓" if c["pass"] else "✗"
                print_flush(
                    f"  [{m}] {r['mission'][:28]:28s} │ {r['type']:16s} │ "
                    f"{c['op']:8s} │ {c['field']:10s} │ "
                    f"exp={c['expected']:>20s} │ act={c['actual']}"
                )
        print_flush(f"{'─' * 70}")
        pct = (passed / total * 100) if total else 0
        print_flush(f"  TOTAL: {passed}/{total} checks passed ({pct:.0f}%)")
        print_flush(f"{'═' * 70}")


def _check(field, op, expected, actual, passed):
    return {"field": field, "op": op, "expected": expected, "actual": actual, "pass": passed}


def _log_check(ok, op, field, expected, actual):
    m = "✓" if ok else "✗"
    print_flush(f"    [{m}] {op:8s} {field}: expected {expected}, got {actual}")


# ═══════════════════════════════ UI STATE CAPTURE ═══════════════════════════════


def dump_page_state(page, label=""):
    """
    Capture and log the visible UI state so we can see exactly
    what the script sees vs. what the user sees on screen.
    Returns the full page text for further inspection.
    """
    try:
        all_text = page.evaluate("document.body.innerText")
    except Exception:
        print_flush(f"  [UI-DUMP{' ' + label if label else ''}] Could not read page text")
        return ""

    # Condense: collapse blank lines, limit to 600 chars
    lines = [ln.strip() for ln in all_text.splitlines() if ln.strip()]
    condensed = " | ".join(lines)
    if len(condensed) > 600:
        condensed = condensed[:600] + "…"

    print_flush(f"  [UI-DUMP{' ' + label if label else ''}] {condensed}")

    # Also list visible buttons
    try:
        buttons = page.locator("button, [role=button], .btn, [class*=button]")
        btn_count = buttons.count()
        if btn_count > 0:
            btn_texts = []
            for i in range(min(btn_count, 10)):
                try:
                    txt = buttons.nth(i).inner_text(timeout=200)
                    if txt.strip():
                        btn_texts.append(txt.strip()[:30])
                except Exception:
                    pass
            if btn_texts:
                print_flush(f"  [UI-BUTTONS] {', '.join(btn_texts)}")
    except Exception:
        pass

    return all_text


def log_resources(label, res):
    """Pretty-print a resource snapshot."""
    if not res:
        print_flush(f"  [RESOURCES {label}] (no data)")
        return
    print_flush(
        f"  [RESOURCES {label}] "
        f"Lvl:{res.get('level','?')}  "
        f"XP:{res.get('xp','?')}  "
        f"Cash:{res.get('cash',0):,}  "
        f"Supplies:{res.get('supplies',0):,}"
    )


def log_resource_delta(before, after, mission):
    """Show what changed vs. what config expects."""
    if not before or not after:
        return
    xp_d = after.get("xp", 0) - before.get("xp", 0)
    sup_d = before.get("supplies", 0) - after.get("supplies", 0)
    cash_d = after.get("cash", 0) - before.get("cash", 0)

    exp_xp = mission["xp_gain"]
    exp_sup = mission["supplies_cost"]

    xp_m = "✓" if xp_d == exp_xp else "✗"
    sup_m = "✓" if sup_d == exp_sup else "✗"

    print_flush(
        f"  [DELTA] "
        f"XP: +{xp_d} (expect +{exp_xp}) [{xp_m}]  |  "
        f"Supplies: -{sup_d} (expect -{exp_sup}) [{sup_m}]  |  "
        f"Cash: {'+' if cash_d >= 0 else ''}{cash_d:,}"
    )


# ═══════════════════════════════ UNBLOCK RECOVERY ═══════════════════════════════


def check_and_handle_unblock(page):
    """
    Detect if the page reloaded into an unblock screen.
    Reads the dynamically generated 6-digit code from UI, types it, clicks Unblock.
    Returns True if an unblock was handled.
    """
    try:
        unblock_btn = None
        for label in ("Unblock", "UNBLOCK", "unblock"):
            loc = page.get_by_text(label, exact=True)
            if loc.count() > 0:
                unblock_btn = loc
                break
        if unblock_btn is None:
            return False

        print_flush("\n[UNBLOCK] ⚠ Reload detected — unblock screen found")

        all_text = page.evaluate("document.body.innerText")
        code_match = re.search(r"\b(\d{6})\b", all_text)
        if not code_match:
            print_flush("[UNBLOCK-ERROR] Could not find 6-digit code in UI text")
            print_flush(f"[UNBLOCK-DEBUG] Page text (first 300): {all_text[:300]}")
            return False

        code = code_match.group(1)
        print_flush(f"[UNBLOCK] Code found: {code}")

        code_input = page.locator("input").first
        code_input.fill(code)
        print_flush("[UNBLOCK] Code entered")

        unblock_btn.first.click(timeout=3000)
        print_flush("[UNBLOCK] Clicked Unblock — waiting for redirect…")

        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_timeout(2000)
        dismiss_all_popups(page)

        try:
            hq = page.get_by_text("HQ", exact=True)
            if hq.count() > 0:
                hq.first.click(timeout=2000)
                print_flush("[UNBLOCK] ✓ Navigated to HQ after unblock")
                page.wait_for_timeout(1000)
                dismiss_all_popups(page)
        except Exception:
            print_flush("[UNBLOCK-WARN] Could not click HQ after unblock")

        return True
    except Exception:
        return False


# ═══════════════════════════════ NAVIGATION HELPERS ═══════════════════════════════


def go_back_to_mission_list(page):
    """
    Navigate back from inside a mission to the Volcanic Outlands mission list.
    Tries multiple strategies: back/close buttons, Escape, re-navigation.
    """
    print_flush("[NAV] Returning to mission list…")
    dismiss_all_popups(page)

    # Strategy 1: look for back / close / × buttons
    for label in ["Back", "BACK", "Close", "CLOSE", "×", "X"]:
        try:
            btn = page.get_by_text(label, exact=True)
            if btn.count() > 0 and btn.first.is_visible(timeout=300):
                btn.first.click(timeout=1000)
                page.wait_for_timeout(500)
                dismiss_all_popups(page)
                print_flush(f"[NAV] Clicked '{label}'")
                # Check if we see missions now
                if _can_see_mission_list(page):
                    return True
        except Exception:
            pass

    # Strategy 2: press Escape key
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        dismiss_all_popups(page)
        if _can_see_mission_list(page):
            print_flush("[NAV] Escape worked")
            return True
    except Exception:
        pass

    # Strategy 3: click VOLCANIC OUTLANDS header if visible
    try:
        vo = page.get_by_text("VOLCANIC OUTLANDS", exact=True)
        if vo.count() > 0:
            vo.first.click(timeout=1000)
            page.wait_for_timeout(500)
            dismiss_all_popups(page)
            if _can_see_mission_list(page):
                print_flush("[NAV] Re-clicked VOLCANIC OUTLANDS")
                return True
    except Exception:
        pass

    # Strategy 4: full re-navigation HQ → Oceania → Volcanic Outlands
    print_flush("[NAV] Attempting full re-navigation…")
    return _full_navigate_to_volcanic(page)


def _can_see_mission_list(page) -> bool:
    """Check if any mission name is visible (meaning we're on the list)."""
    test_names = [
        "Capture the Lava Watch Post",
        "Raid the Ashfield Supply Camp",
        "Burn the Volcanic Weapons Foundry",
    ]
    for name in test_names:
        try:
            if page.get_by_text(name).count() > 0:
                return True
        except Exception:
            pass
    return False


def _full_navigate_to_volcanic(page) -> bool:
    """Full re-navigation: HQ → Oceania → Volcanic Outlands."""
    steps = [
        ("HQ", "HQ"),
        ("Oceania", "Oceania"),
        ("VOLCANIC OUTLANDS", "Volcanic Outlands"),
    ]
    for label, desc in steps:
        try:
            btn = page.get_by_text(label, exact=True)
            if btn.count() > 0:
                btn.first.click(timeout=2000)
                print_flush(f"[RE-NAV] {desc} clicked")
                page.wait_for_timeout(1000)
                dismiss_all_popups(page)
        except Exception as e:
            print_flush(f"[RE-NAV-ERROR] {desc}: {str(e)[:50]}")
            return False
    return _can_see_mission_list(page)


def navigate_to_volcanic_mission(page, mission_name: str) -> bool:
    """Full re-navigation from HQ all the way to a specific mission."""
    if not _full_navigate_to_volcanic(page):
        return False
    try:
        btn = page.get_by_text(mission_name)
        btn.first.click(timeout=1000)
        print_flush(f"[RE-NAV] ✓ Back on mission: {mission_name}")
        page.wait_for_timeout(500)
        dismiss_all_popups(page)
        return True
    except Exception as e:
        print_flush(f"[RE-NAV-ERROR] Mission click: {str(e)[:50]}")
        return False


# ═══════════════════════════════ PLAYWRIGHT HELPERS ═══════════════════════════════


def dismiss_popups(page):
    """Dismiss all visible popup buttons."""
    for btn_name in INTERRUPT_BUTTONS:
        try:
            btn = page.get_by_text(btn_name, exact=True)
            if btn.count() > 0:
                btn.first.click(timeout=500)
                print_flush(f"[POPUP] {btn_name}")
                page.wait_for_timeout(100)
                return True
        except Exception:
            pass
    return False


def dismiss_all_popups(page):
    """Dismiss all popups until none remain."""
    for _ in range(5):
        if not dismiss_popups(page):
            break


def get_mission_text(all_text: str, m_name: str, all_mission_names: list) -> str:
    """Extracts the substring from all_text that belongs strictly to m_name."""
    idx = all_text.upper().find(m_name.upper())
    if idx == -1:
        return ""

    next_idx = len(all_text)
    for other_m in all_mission_names:
        if other_m.upper() == m_name.upper():
            continue
        oi = all_text.upper().find(other_m.upper(), idx + len(m_name))
        if oi != -1 and oi < next_idx:
            next_idx = oi

    return all_text[idx:next_idx]


def get_phase_percentage(page, m_name: str, all_mission_names: list) -> int:
    """
    Extract mission progress percentage from UI, specifically for the given mission.
    """
    try:
        all_text = page.evaluate("document.body.innerText")
        mission_text = get_mission_text(all_text, m_name, all_mission_names)

        # Specifically look for "Phase X%" to avoid matching "250 /250 SUPPLIES".
        phase_match = re.search(r"Phase.*?(100|\d{1,2})%", mission_text, re.IGNORECASE)
        if phase_match:
            return int(phase_match.group(1))

        return 0
    except Exception:
        return 0


def click_mission_button(page, m_name: str, button_texts: list, all_mission_names: list) -> bool:
    """
    Finds the mission name in the DOM and traverses forward to click the first matching button
    before hitting another mission's name.
    """
    js_code = """([mName, btnTexts, allNames]) => {
        let walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let startNode = null;
        while(walker.nextNode()) {
            if (walker.currentNode.nodeValue.toUpperCase().includes(mName.toUpperCase())) {
                startNode = walker.currentNode;
                break;
            }
        }
        if (!startNode) return false;

        let current = startNode;
        while (current) {
            if (current.nodeType === 3) {
                let val = current.nodeValue.trim().toUpperCase();
                if (val) {
                    if (btnTexts.includes(val)) {
                        let el = current.parentElement;
                        let clickable = el.closest('button, a, [role="button"], .btn') || el;
                        clickable.click();
                        return true;
                    }

                    // Check if we hit the next mission
                    let isOther = false;
                    for (let name of allNames) {
                        if (name.toUpperCase() !== mName.toUpperCase() && val.includes(name.toUpperCase())) {
                            isOther = true;
                            break;
                        }
                    }
                    if (isOther) {
                        return false; // Reached next mission without finding the button
                    }
                }
            }

            if (current.firstChild) {
                current = current.firstChild;
            } else {
                while (current && !current.nextSibling) {
                    current = current.parentNode;
                }
                if (current) current = current.nextSibling;
            }
        }
        return false;
    }"""
    return page.evaluate(js_code, [m_name, [b.upper() for b in button_texts], all_mission_names])


# ═══════════════════════════════ MAIN FLOW ═══════════════════════════════


def run():
    config = load_config()
    uid = config.get("uid", "") or config.get("SimulationKey", "")
    game_url = config["game_url"]
    missions = config["missions"]
    # verify_every_n_engages is no longer used — verification happens on EVERY click.

    capture = NetworkCapture(config["api_host"])
    api = APIClient(config, capture)
    verifier = OpsVerifier(api, config)

    print_flush("=" * 70)
    print_flush("VOLCANIC OUTLANDS — PLAYWRIGHT + API TEST  (v3 — per-click verify)")
    print_flush(f"  ID/Key : {uid}")
    print_flush(f"  API    : {config['api_host']}")
    print_flush(f"  Game   : {game_url[:70]}…")
    print_flush("=" * 70)

    with sync_playwright() as p:
        bcfg = config.get("browser", {})
        browser = p.chromium.launch(headless=bcfg.get("headless", False))
        context = browser.new_context(
            viewport={
                "width": bcfg.get("viewport_width", 1280),
                "height": bcfg.get("viewport_height", 800),
            }
        )
        page = context.new_page()
        page.on("request", capture.on_request)
        page.on("response", capture.on_response)

        try:
            # ─── STEP 0: Load Game ──────────────────────────────────────────
            print_flush("\n[STEP 0] Loading game URL…")
            page.goto(game_url)
            print_flush("[OK] Game loaded")
            check_and_handle_unblock(page)

            # ─── STEP 1: Splash Screen ─────────────────────────────────────
            print_flush("\n[STEP 1] Waiting for splash screen (5 s)…")
            page.wait_for_timeout(5000)
            page.evaluate("""
                const video = document.getElementById('SplashVideo');
                if (video) video.style.pointerEvents = 'none';
            """)
            print_flush("[OK] Splash complete")
            check_and_handle_unblock(page)

            # ─── STEP 2 & 3: Login (UID vs SimulationKey) ───────────────────
            raw_uid = config.get("uid", "")
            sim_key = config.get("SimulationKey", "")

            if raw_uid:
                print_flush(f"\n[STEP 2] Login — entering UID: {raw_uid}")
                try:
                    uid_input = page.locator("input").first
                    uid_input.fill(raw_uid)
                    print_flush(f"[OK] UID entered: {raw_uid}")
                except Exception as e:
                    print_flush(f"[ERROR] Failed to enter UID: {str(e)[:50]}")
                    browser.close()
                    return

                print_flush("\n[STEP 3] Click Enter button…")
                try:
                    enter_btn = page.get_by_text("Enter", exact=True)
                    enter_btn.first.click(timeout=2000)
                    print_flush("[OK] Enter clicked")
                except Exception as e:
                    print_flush(f"[ERROR] Failed to click Enter: {str(e)[:50]}")
                    browser.close()
                    return
            elif sim_key:
                print_flush(f"\n[STEP 2] Login — entering SimulationKey: {sim_key}")
                try:
                    sim_input = page.get_by_placeholder("SimulationKey")
                    if sim_input.count() == 0:
                        sim_input = page.get_by_placeholder("Simulation Key")
                    if sim_input.count() == 0:
                        sim_input = page.locator("input").nth(1)

                    sim_input.first.fill(sim_key)
                    print_flush(f"[OK] SimulationKey entered: {sim_key}")
                except Exception as e:
                    print_flush(f"[ERROR] Failed to enter SimulationKey: {str(e)[:50]}")
                    browser.close()
                    return

                print_flush("\n[STEP 3] Click Simulate button…")
                try:
                    sim_btn = page.get_by_text("Simulate", exact=True)
                    if sim_btn.count() == 0:
                        sim_btn = page.get_by_text("SIMULATE", exact=True)
                    sim_btn.first.click(timeout=2000)
                    print_flush("[OK] Simulate clicked")
                except Exception as e:
                    print_flush(f"[ERROR] Failed to click Simulate: {str(e)[:50]}")
                    browser.close()
                    return
            else:
                print_flush("[ERROR] Both UID and SimulationKey are blank in config.")
                browser.close()
                return

            page.wait_for_load_state("networkidle", timeout=10000)
            page.wait_for_timeout(2000)
            dismiss_all_popups(page)
            check_and_handle_unblock(page)

            # Wait for auth (max 15 seconds)
            auth_ready = False
            for i in range(30):
                if capture.is_auth_ready():
                    print_flush(
                        f"[AUTH-OK] Auth ready: {capture.get_auth_param('__u')[:8]}\u2026"
                    )
                    auth_ready = True
                    break
                page.wait_for_timeout(500)
            if not auth_ready:
                print_flush("[AUTH-WARN] Auth params not captured after 15s — continuing anyway")

            # ─── STEP 4: Navigate to HQ ────────────────────────────────────
            print_flush("\n[STEP 4] Navigate to HQ…")
            try:
                hq_btn = page.get_by_text("HQ", exact=True)
                if hq_btn.count() == 0:
                    raise RuntimeError("HQ button not found")
                hq_btn.first.click(timeout=2000)
                print_flush("[OK] HQ clicked")
            except Exception as e:
                if not check_and_handle_unblock(page):
                    print_flush(f"[ERROR] HQ navigation failed: {str(e)[:50]}")
                    browser.close()
                    return
            page.wait_for_timeout(1000)
            dismiss_all_popups(page)

            # ─── STEP 5: Navigate to Oceania ────────────────────────────────
            print_flush("\n[STEP 5] Navigate to Oceania…")
            try:
                oceania_btn = page.get_by_text("Oceania", exact=True)
                oceania_btn.first.click(timeout=1000)
                print_flush("[OK] Oceania clicked")
            except Exception as e:
                if not check_and_handle_unblock(page):
                    print_flush(f"[ERROR] Oceania failed: {str(e)[:50]}")
                    browser.close()
                    return
            page.wait_for_timeout(1000)

            # ─── STEP 6: Navigate to Volcanic Outlands ──────────────────────
            print_flush("\n[STEP 6] Navigate to Volcanic Outlands…")
            try:
                volcanic_btn = page.get_by_text("VOLCANIC OUTLANDS", exact=True)
                volcanic_btn.first.click(timeout=1000)
                print_flush("[OK] Volcanic Outlands clicked")
            except Exception as e:
                if not check_and_handle_unblock(page):
                    print_flush(f"[ERROR] Volcanic Outlands failed: {str(e)[:50]}")
                    browser.close()
                    return
            page.wait_for_timeout(1000)

            # ─── STEP 7: Process All Missions ───────────────────────────────
            print_flush(f"\n[STEP 7] Processing {len(missions)} missions…")
            results = {}
            all_mission_names = [m["name"] for m in missions]

            for idx, mission in enumerate(missions, 1):
                m_name = mission["name"]

                # ── Mission header ──────────────────────────────────────────
                print_flush(f"\n{'─' * 70}")
                print_flush(f"MISSION {idx}/{len(missions)}: {m_name}")
                print_flush(f"  Spec Steps    : {mission['spec_steps']}")
                print_flush(
                    f"  Unlock Lvl    : {mission['unlock_level']}  |  "
                    f"XP/engage: +{mission['xp_gain']}  |  "
                    f"Supplies/engage: -{mission['supplies_cost']}"
                )
                print_flush(
                    f"  Cash range    : {mission['cash_min']:,} – {mission['cash_max']:,}"
                )
                if mission.get("loot_unit"):
                    lu = mission["loot_unit"]
                    print_flush(
                        f"  Loot Unit     : {lu['name']} ({lu['class']})  "
                        f"ATK:{lu['attack']}  DEF:{lu['defence']}  "
                        f"Upkeep:{lu['upkeep']:,}"
                    )
                print_flush(f"{'─' * 70}")

                # Unblock check
                check_and_handle_unblock(page)

                # Dump UI before clicking mission so we know what we see
                dump_page_state(page, "before-mission-click")

                # Pre-mission resource snapshot
                pre_mission = {}
                if capture.is_auth_ready():
                    pre_mission = verifier.snapshot()
                    log_resources("PRE-MISSION", pre_mission)

                    # Verify unlock level
                    lvl = pre_mission.get("level", 0)
                    verifier.verify_unlock(mission, lvl)

                # Click mission
                try:
                    mission_btn = page.get_by_text(m_name)
                    if mission_btn.count() == 0:
                        print_flush(f"[ERROR] Mission text not found on page: '{m_name}'")
                        results[m_name] = "FAIL"
                        continue
                    mission_btn.first.click(timeout=2000)
                    print_flush(f"[CLICK] Mission selected: '{m_name}'")
                except Exception as e:
                    if check_and_handle_unblock(page):
                        if not navigate_to_volcanic_mission(page, m_name):
                            results[m_name] = "FAIL"
                            continue
                    else:
                        print_flush(f"[ERROR] Could not click mission: {str(e)[:50]}")
                        results[m_name] = "FAIL"
                        continue

                page.wait_for_timeout(500)
                dismiss_all_popups(page)

                # Dump UI after entering mission
                dump_page_state(page, "inside-mission")

                # ── Engage loop ─────────────────────────────────────────────
                mission_complete = False
                engage_count = 0

                for attempt in range(200):
                    # Unblock recovery
                    if check_and_handle_unblock(page):
                        if not navigate_to_volcanic_mission(page, m_name):
                            break
                        continue

                    pct = get_phase_percentage(page, m_name, all_mission_names)

                    # Completion check
                    if pct == 100:
                        page.wait_for_timeout(300)
                        pct2 = get_phase_percentage(page, m_name, all_mission_names)
                        print_flush(f"[VERIFY] Double-check: {pct2}%")
                        if pct2 == 100:
                            print_flush("[✓] MISSION COMPLETE — Confirmed 100%")
                            mission_complete = True
                            break

                    # ── Pre-engage snapshot (taken BEFORE every single click) ──
                    pre_engage = None
                    should_verify = capture.is_auth_ready()
                    if should_verify:
                        pre_engage = verifier.snapshot()

                    # ── Click Engage ────────────────────────────────────────
                    try:
                        btn_clicked = click_mission_button(
                            page, m_name, ["Engage", "RE-ENGAGE", "NEXT OP"], all_mission_names
                        )
                        if btn_clicked:
                            engage_count += 1
                            print_flush(f"[ENGAGE] Click #{engage_count}  |  Phase: {pct}%")
                        else:
                            print_flush(
                                f"[INFO] No Engage button found for {m_name} at attempt {attempt + 1}"
                            )
                            dump_page_state(page, "no-engage-button")
                            page.wait_for_timeout(500)
                            dismiss_all_popups(page)

                            # Retry after popups dismissed
                            btn_clicked = click_mission_button(
                                page, m_name, ["Engage", "RE-ENGAGE", "NEXT OP"], all_mission_names
                            )
                            if btn_clicked:
                                engage_count += 1
                                print_flush(
                                    f"[ENGAGE] Retry Click #{engage_count}  |  Phase: {pct}%"
                                )
                            else:
                                final_pct = get_phase_percentage(page, m_name, all_mission_names)
                                print_flush(f"[FINAL-CHECK] Phase: {final_pct}%")
                                if final_pct >= 100:
                                    mission_complete = True
                                break

                    except Exception:
                        if check_and_handle_unblock(page):
                            if navigate_to_volcanic_mission(page, m_name):
                                continue
                        print_flush(f"[WARN] Could not click Engage at #{attempt + 1}")
                        dump_page_state(page, "engage-click-failed")
                        dismiss_all_popups(page)
                        page.wait_for_timeout(300)
                        try:
                            retry_clicked = click_mission_button(
                                page, m_name, ["Engage", "RE-ENGAGE", "NEXT OP"], all_mission_names
                            )
                            if retry_clicked:
                                engage_count += 1
                                print_flush(
                                    f"[ENGAGE] Error Retry succeeded — Click #{engage_count}"
                                )
                            else:
                                final_pct = get_phase_percentage(page, m_name, all_mission_names)
                                if final_pct >= 100:
                                    mission_complete = True
                                break
                        except Exception:
                            final_pct = get_phase_percentage(page, m_name, all_mission_names)
                            if final_pct >= 100:
                                mission_complete = True
                            break

                    page.wait_for_timeout(300)
                    dismiss_popups(page)

                    # ── Post-engage snapshot & verify (EVERY single click) ──
                    if pre_engage and should_verify:
                        post_engage = verifier.snapshot()
                        if post_engage:
                            log_resources("POST-ENGAGE", post_engage)
                            log_resource_delta(pre_engage, post_engage, mission)
                            # Pass current phase percentage into the record
                            verifier.verify_engage(
                                mission, pre_engage, post_engage, engage_count, pct
                            )

                # ── Post-mission reward verification ────────────────────────
                if mission_complete and capture.is_auth_ready():
                    post_mission = verifier.snapshot()
                    if pre_mission and post_mission:
                        log_resources("POST-MISSION", post_mission)
                        cash_before = pre_mission.get("cash", 0)
                        cash_after = post_mission.get("cash", 0)
                        print_flush(
                            f"  [MISSION-CASH] Before: {cash_before:,}  "
                            f"After: {cash_after:,}  "
                            f"Earned: {cash_after - cash_before:,}"
                        )
                        verifier.verify_mission_rewards(mission, cash_before, cash_after)
                        results[m_name] = (
                            "PASS"
                            if all(
                                c["pass"]
                                for r in verifier.results
                                if r["mission"] == m_name
                                for c in r["checks"]
                            )
                            else "FAIL"
                        )
                    else:
                        results[m_name] = "PASS" if mission_complete else "FAIL"
                else:
                    results[m_name] = "PASS" if mission_complete else "FAIL"

                if not go_back_to_mission_list(page):
                    print_flush("[NAV-WARN] Could not return to mission list \u2014 trying full re-nav")
                    _full_navigate_to_volcanic(page)
                page.wait_for_timeout(500)
                dismiss_all_popups(page)

            # ─── Mission Results ────────────────────────────────────────────
            print_flush(f"\n{'=' * 70}")
            print_flush("MISSION RESULTS")
            print_flush(f"{'=' * 70}")
            for name, status in results.items():
                marker = "\u2713" if status == "PASS" else "\u2717"
                print_flush(f"  [{marker}] {name}: {status}")

            # ─── Ops Verification Summary ───────────────────────────────────
            verifier.print_summary()

            # ─── STEP 8: Navigate back to HQ ───────────────────────────────
            print_flush("\n[STEP 8] Navigate back to HQ\u2026")
            try:
                hq_btn = page.get_by_text("HQ", exact=True)
                hq_btn.first.click(timeout=1000)
                print_flush("[OK] HQ clicked")
            except Exception:
                print_flush("[WARN] Could not navigate to HQ")
            page.wait_for_timeout(1000)
            dismiss_all_popups(page)

            # ─── STEP 9: Settings ──────────────────────────────────────────
            print_flush("\n[STEP 9] Navigate to Settings\u2026")
            try:
                settings_btn = page.get_by_text("Settings", exact=True)
                settings_btn.first.click(timeout=1000)
                print_flush("[OK] Settings clicked")
            except Exception:
                print_flush("[WARN] Settings not found")
            page.wait_for_timeout(1000)
            dismiss_all_popups(page)

            # ─── STEP 10: Logout ───────────────────────────────────────────
            print_flush("\n[STEP 10] Logout\u2026")
            try:
                logout_btn = page.get_by_text("Logout", exact=True)
                logout_btn.first.click(timeout=1000)
                print_flush("[OK] Logout clicked")
            except Exception:
                print_flush("[WARN] Logout not found")
            page.wait_for_timeout(1000)

            # ─── Final Report ──────────────────────────────────────────────
            print_flush(f"\n{'=' * 70}")
            print_flush("FINAL REPORT")
            print_flush(f"{'=' * 70}")
            print_flush("Auth Params:")
            for key, val in capture.auth_params.items():
                display = f"{val[:20]}\u2026" if len(val) > 20 else val
                print_flush(f"  {key}: {display}")

            print_flush("\n[DONE] Test complete")

        except TargetClosedError:
            print_flush("\n[WARN] Browser closed unexpectedly (TargetClosedError).")
            print_flush("[INFO] Saving all collected data before exit\u2026")
            verifier._dump_json()
        finally:
            try:
                browser.close()
            except Exception:
                pass
            api.close()


if __name__ == "__main__":
    run()
