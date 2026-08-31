/**
 * VOLCANIC OPS DASHBOARD — main.js
 * Live-polls verification_results.json every second and renders results.
 *
 * Data is served from:
 *   1. /verification_results.json  (Vite serves from dashboard/public/)
 *   2. Fallback: /@fs/../verification_results.json (parent dir via Vite fs.allow)
 */

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  data: null,
  selectedMission: null,
  prevResultCount: 0,
  lastEtag: '',
  viewMode: 'auto',
  pollTimer: null,
  listenersAttached: false,
};

const POLL_MS = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function fmt(n) {
  if (typeof n !== 'number' || isNaN(n)) return String(n ?? '—');
  return n.toLocaleString();
}

function fmtCash(n) {
  if (typeof n !== 'number' || isNaN(n)) return String(n ?? '—');
  if (n < 0) return '-' + fmtCash(-n);
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  return n.toLocaleString();
}

// ── Execution complete check ──────────────────────────────────────────────────
function isExecutionComplete(data) {
  if (!data?.metadata?.missions?.length) return false;
  const complete = new Set(data.summary?.missions_complete ?? []);
  return data.metadata.missions.every(m => complete.has(m.name));
}

// ── View toggle ───────────────────────────────────────────────────────────────
function setupViewToggle() {
  if (state.listenersAttached) return;
  state.listenersAttached = true;

  const btnSummary = $('btn-view-summary');
  const btnLive = $('btn-view-live');

  if (btnSummary) {
    btnSummary.addEventListener('click', () => {
      state.viewMode = 'summary';
      updateViewToggle();
      if (state.data) render(state.data);
    });
  }

  if (btnLive) {
    btnLive.addEventListener('click', () => {
      state.viewMode = 'live';
      state.prevResultCount = 0;
      updateViewToggle();
      if (state.data) render(state.data);
    });
  }
}

function updateViewToggle() {
  const btnSummary = $('btn-view-summary');
  const btnLive = $('btn-view-live');
  if (btnSummary) btnSummary.classList.toggle('active', state.viewMode === 'summary');
  if (btnLive) btnLive.classList.toggle('active', state.viewMode === 'live');
}

function shouldShowSummary(data) {
  if (state.viewMode === 'summary') return true;
  if (state.viewMode === 'live') return false;
  return isExecutionComplete(data);
}

// ── Entry point ───────────────────────────────────────────────────────────────
function init() {
  setupViewToggle();
  poll();
  state.pollTimer = setInterval(poll, POLL_MS);
}

// ── Fetch & diff ──────────────────────────────────────────────────────────────
async function poll() {
  let data = null;
  try {
    const urls = [
      '/verification_results.json',
      '/@fs/' + window.location.pathname.split('/dashboard/')[0].replace(/^\//, '') + '/../verification_results.json',
    ];
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(url + '?t=' + Date.now(), {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (resp.ok) {
          data = await resp.json();
          break;
        }
      } catch { /* try next */ }
    }
  } catch (err) {
    console.warn('Poll error:', err);
  }

  if (!data) {
    setStatus('error');
    return;
  }

  const fingerprint = JSON.stringify(data.summary) +
    (data.results?.length ?? 0) +
    (data.metadata?.last_updated ?? '');
  if (fingerprint === state.lastEtag) return;
  state.lastEtag = fingerprint;
  state.data = data;

  const execComplete = isExecutionComplete(data);
  setStatus(execComplete ? 'complete' : (data.results?.length > 0 ? 'live' : 'waiting'));

  render(data);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(data) {
  updateTopBar(data);
  renderSidebar(data);

  const showSummary = shouldShowSummary(data);
  const summaryEl = $('exec-summary');
  const tableContainer = $('table-container');
  const missionHeader = $('mission-header');
  const missionBar = $('mission-summary-bar');
  const viewToggle = $('view-toggle');
  const execComplete = isExecutionComplete(data);

  if (viewToggle) viewToggle.classList.toggle('hidden', !execComplete);

  if (showSummary) {
    if (summaryEl) summaryEl.classList.remove('hidden');
    if (tableContainer) tableContainer.classList.add('hidden');
    if (missionHeader) missionHeader.classList.add('hidden');
    if (missionBar) missionBar.classList.add('hidden');
    renderExecSummary(data);
  } else {
    if (summaryEl) summaryEl.classList.add('hidden');
    if (tableContainer) tableContainer.classList.remove('hidden');
    if (missionHeader) missionHeader.classList.remove('hidden');

    if (state.selectedMission !== null) {
      renderMain(state.selectedMission, data);
    } else if (data.metadata?.missions?.length) {
      const firstWithData = data.metadata.missions.find(m =>
        data.results?.some(r => r.mission_id === m.id)
      );
      const first = firstWithData ?? data.metadata.missions[0];
      if (first) selectMission(first.id, data);
    }
  }
}

// ── Execution Summary ─────────────────────────────────────────────────────────
function renderExecSummary(data) {
  const { metadata, results, summary } = data;
  const missions = metadata?.missions ?? [];
  const completeSet = new Set(summary?.missions_complete ?? []);

  const total  = summary?.total ?? 0;
  const passed = summary?.passed ?? 0;
  const failed = total - passed;
  const allPass = failed === 0 && total > 0;

  const banner = $('exec-banner');
  const bannerIcon = $('exec-banner-icon');
  const bannerTitle = $('exec-banner-title');
  const bannerSub = $('exec-banner-sub');
  const bannerStatus = $('exec-banner-status');

  if (banner) banner.className = 'exec-banner ' + (allPass ? 'all-pass' : 'has-fail');
  if (bannerIcon) bannerIcon.textContent = allPass ? '\u2713' : '\u2717';
  if (bannerTitle) bannerTitle.textContent = allPass ? 'ALL MISSIONS PASSED' : 'EXECUTION COMPLETE';
  if (bannerSub) {
    bannerSub.textContent = allPass
      ? `All ${missions.length} missions verified successfully`
      : `${failed} check${failed !== 1 ? 's' : ''} failed across ${missions.length} missions`;
  }
  if (bannerStatus) {
    bannerStatus.className = 'exec-banner-status ' + (allPass ? 'all-pass' : 'has-fail');
    bannerStatus.textContent = allPass ? 'PASS' : `${failed} FAIL`;
  }

  const startTime = metadata?.start_time;
  const endTime   = metadata?.last_updated;

  const fmtTime = ts => {
    if (!ts) return '\u2014';
    const d = new Date(ts);
    return isNaN(d) ? ts : d.toLocaleTimeString();
  };

  const fmtDuration = (start, end) => {
    if (!start || !end) return '\u2014';
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s) || isNaN(e)) return '\u2014';
    const secs = Math.round((e - s) / 1000);
    if (secs < 60) return secs + 's';
    const mins = Math.floor(secs / 60);
    const rem  = secs % 60;
    return `${mins}m ${rem}s`;
  };

  setText('exec-duration', fmtDuration(startTime, endTime));
  setText('exec-start', fmtTime(startTime));
  setText('exec-end', fmtTime(endTime));
  setText('exec-missions-count', `${completeSet.size} / ${missions.length}`);

  setText('exec-total', total);
  setText('exec-passed', passed);
  setText('exec-failed', failed);
  setText('exec-rate', total > 0 ? Math.round(passed / total * 100) + '%' : '\u2014');

  const engages = results.filter(r => r.type === 'engage');
  let totalXP = 0, totalSup = 0, totalCash = 0;
  if (engages.length > 0) {
    const firstSnap = engages.find(r => r.before?.xp != null && r.before.xp > 0);
    const lastSnap  = [...engages].reverse().find(r => r.after?.xp != null && r.after.xp > 0);

    if (firstSnap && lastSnap) {
      totalXP   = (lastSnap.after.xp ?? 0) - (firstSnap.before.xp ?? 0);
      totalSup  = (firstSnap.before.supplies ?? 0) - (lastSnap.after.supplies ?? 0);
      totalCash = (lastSnap.after.cash ?? 0) - (firstSnap.before.cash ?? 0);
    } else {
      engages.forEach(r => {
        if (r.before?.xp != null && r.after?.xp != null) totalXP += r.after.xp - r.before.xp;
        if (r.before?.supplies != null && r.after?.supplies != null) totalSup += r.before.supplies - r.after.supplies;
        if (r.before?.cash != null && r.after?.cash != null) totalCash += r.after.cash - r.before.cash;
      });
    }
  }

  setText('exec-total-xp', totalXP > 0 ? '+' + fmt(totalXP) : '\u2014');
  setText('exec-total-sup', totalSup > 0 ? '-' + fmt(totalSup) : '\u2014');
  setText('exec-total-cash', totalCash > 0 ? fmtCash(totalCash) : '\u2014');

  const grid = $('exec-mission-grid');
  if (grid) {
    grid.innerHTML = missions.map(m => {
      const mResults = results.filter(r => r.mission_id === m.id);
      const mEngages = mResults.filter(r => r.type === 'engage');
      const checks   = mResults.flatMap(r => r.checks ?? []);
      const mPassed  = checks.filter(c => c.pass).length;
      const mFailed  = checks.length - mPassed;
      const isComplete = completeSet.has(m.name);
      const mAllPass = mFailed === 0 && checks.length > 0;
      const statusBadge = isComplete ? (mAllPass ? 'PASS' : 'FAIL') : 'INCOMPLETE';

      const barPct = checks.length > 0 ? Math.round(mPassed / checks.length * 100) : 0;

      const lootHtml = m.loot_unit ? `
        <div class="emc-loot">
          <span class="emc-loot-icon">\u2605</span>
          <span class="emc-loot-name">${escapeHtml(m.loot_unit.name)}</span>
          <span class="emc-loot-class">${escapeHtml(m.loot_unit.class)}</span>
          <span class="emc-loot-stats">ATK ${m.loot_unit.attack} \u00b7 DEF ${m.loot_unit.defence}</span>
        </div>` : '';

      return `
        <div class="exec-mission-card ${mAllPass ? 'pass-card' : 'fail-card'}">
          <div class="emc-top">
            <span class="emc-name">${escapeHtml(m.name)}</span>
            <span class="emc-badge ${mAllPass ? 'pass' : 'fail'}">${escapeHtml(statusBadge)}</span>
          </div>
          <div class="emc-stats">
            <span>CLICKS <span>${mEngages.length}</span></span>
            <span>CHECKS <span>${checks.length}</span></span>
            <span>PASSED <span>${mPassed}</span></span>
            ${mFailed > 0 ? `<span>FAILED <span style="color:var(--fail)">${mFailed}</span></span>` : ''}
          </div>
          <div class="emc-bar">
            <div class="emc-bar-fill ${mAllPass ? 'pass' : 'fail'}" style="width:${barPct}%"></div>
          </div>
          ${lootHtml}
        </div>`;
    }).join('');
  }

  const failSection = $('exec-failures-section');
  const failList    = $('exec-failures-list');

  const allFailures = results.flatMap(r =>
    (r.checks ?? []).filter(c => !c.pass).map(c => ({
      mission: r.mission,
      type: r.type,
      click: r.click_number,
      ...c
    }))
  );

  if (failSection && failList) {
    if (allFailures.length > 0) {
      failSection.classList.remove('hidden');
      failList.innerHTML = allFailures.map(f => {
        const typeLabel = f.type === 'engage' ? `CLICK #${f.click}` : (f.type ?? '').replace(/_/g, ' ').toUpperCase();
        return `
          <div class="exec-fail-item">
            <span class="efi-mission">${escapeHtml(f.mission)}</span>
            <span class="efi-field">${escapeHtml(f.field)}</span>
            <span class="efi-op">${escapeHtml(typeLabel)}</span>
            <span class="efi-detail">
              <span class="efi-exp">exp ${escapeHtml(f.expected)}</span>
              <span class="efi-arrow">\u2192</span>
              <span class="efi-got">got ${escapeHtml(f.actual)}</span>
            </span>
          </div>`;
      }).join('');
    } else {
      failSection.classList.add('hidden');
    }
  }

  setText('exec-footer-id', `STARTED ${fmtTime(startTime)}`);
}

// ── Top Bar ───────────────────────────────────────────────────────────────────
function updateTopBar(data) {
  const { summary, metadata } = data;

  const total  = summary?.total ?? 0;
  const passed = summary?.passed ?? 0;
  const failed = total - passed;
  const rate   = total > 0 ? Math.round(passed / total * 100) : 0;

  setText('val-total', total > 0 ? total : '\u2014');
  setText('val-pass',  passed > 0 ? passed : '\u2014');
  setText('val-fail',  failed > 0 ? failed : '\u2014');
  setText('val-rate',  total > 0 ? rate + '%' : '\u2014');

  if (metadata?.last_updated) {
    const t = new Date(metadata.last_updated);
    setText('last-updated', isNaN(t) ? metadata.last_updated : t.toLocaleTimeString());
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar(data) {
  const nav = $('mission-nav');
  if (!nav) return;

  const missions = data.metadata?.missions ?? [];
  const results  = data.results ?? [];
  const complete = new Set(data.summary?.missions_complete ?? []);

  if (!missions.length) return;

  const engageResults = results.filter(r => r.type === 'engage');
  const lastMissionId = engageResults.at(-1)?.mission_id ?? null;

  nav.innerHTML = missions.map(m => {
    const mResults = results.filter(r => r.mission_id === m.id && r.type === 'engage');
    const checks   = mResults.flatMap(r => r.checks ?? []);
    const hasData  = mResults.length > 0;
    const isDone   = complete.has(m.name);
    const isRunning = !isDone && (m.id === lastMissionId);

    let badge, badgeClass;
    if (!hasData) {
      badge = 'PENDING'; badgeClass = 'pending';
    } else if (isDone) {
      const allPass = checks.every(c => c.pass);
      badge = allPass ? 'PASS' : 'FAIL';
      badgeClass = allPass ? 'pass' : 'fail';
    } else if (isRunning) {
      badge = 'LIVE'; badgeClass = 'active-run';
    } else {
      const allPass = checks.every(c => c.pass);
      badge = allPass ? 'PASS' : 'FAIL';
      badgeClass = allPass ? 'pass' : 'fail';
    }

    const specMatch = m.spec_steps?.match(/(\d+)-(\d+)/);
    const specRange = specMatch ? parseInt(specMatch[2], 10) - parseInt(specMatch[1], 10) + 1 : 10;
    const progressPct = isDone ? 100 : Math.min(100, Math.round(mResults.length / specRange * 100));
    const fillClass = isDone ? 'complete' : (badge === 'FAIL' ? 'fail' : '');

    const isActive = state.selectedMission === m.id && !shouldShowSummary(data);

    return `
      <div class="mission-item${isActive ? ' active' : ''}" data-id="${m.id}" tabindex="0" role="button" aria-label="${escapeHtml(m.name)}">
        <div class="mi-top">
          <span class="mi-id">M${String(m.id).padStart(2,'0')}</span>
          <span class="mi-name">${escapeHtml(m.name)}</span>
          <span class="mi-badge ${badgeClass}">${badge}</span>
        </div>
        <div class="mi-stats">
          <span class="mi-stat">CLICKS <span>${mResults.length}</span></span>
          <span class="mi-stat">XP <span>+${m.xp_gain}</span></span>
          <span class="mi-stat">SUP <span>-${m.supplies_cost}</span></span>
        </div>
        <div class="mi-progress">
          <div class="mi-progress-fill ${fillClass}" style="width:${progressPct}%"></div>
        </div>
      </div>`;
  }).join('');

  nav.querySelectorAll('.mission-item').forEach(el => {
    const handler = () => {
      const id = parseInt(el.dataset.id, 10);
      if (isNaN(id)) return;
      state.viewMode = 'live';
      state.selectedMission = id;
      state.prevResultCount = 0;
      updateViewToggle();
      const summaryEl = $('exec-summary');
      const tableContainer = $('table-container');
      const missionHeader = $('mission-header');
      const missionBar = $('mission-summary-bar');
      if (summaryEl) summaryEl.classList.add('hidden');
      if (tableContainer) tableContainer.classList.remove('hidden');
      if (missionHeader) missionHeader.classList.remove('hidden');
      if (missionBar) missionBar.classList.remove('hidden');
      renderMain(id, data);
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });
}

// ── Mission selection ─────────────────────────────────────────────────────────
function selectMission(id, data) {
  state.selectedMission = id;
  state.prevResultCount = 0;
  renderSidebar(data);
  renderMain(id, data);
}

// ── Main content ──────────────────────────────────────────────────────────────
function renderMain(missionId, data) {
  const missions = data.metadata?.missions ?? [];
  const mission  = missions.find(m => m.id === missionId);
  if (!mission) return;

  const results  = data.results ?? [];
  const complete = new Set(data.summary?.missions_complete ?? []);
  const mResults = results.filter(r => r.mission_id === missionId);
  const engages  = mResults.filter(r => r.type === 'engage');

  const titleEl = $('mission-title');
  const metaEl = $('mission-meta');
  if (titleEl) titleEl.textContent = mission.name;
  if (metaEl) metaEl.textContent =
    `SPEC ${mission.spec_steps}  \u00b7  UNLOCK LVL ${mission.unlock_level}  \u00b7  ID ${mission.id}`;

  const bar = $('mission-summary-bar');
  if (bar) bar.classList.remove('hidden');

  setText('ms-clicks', engages.length);
  setText('ms-xp',     `+${mission.xp_gain} XP`);
  setText('ms-sup',    `-${mission.supplies_cost}`);

  const cashFmt = n => n >= 1_000_000_000
    ? (n / 1_000_000_000).toFixed(2) + 'B'
    : n >= 1_000_000
    ? (n / 1_000_000).toFixed(0) + 'M'
    : n.toLocaleString();
  setText('ms-cash', `${cashFmt(mission.cash_min)} \u2013 ${cashFmt(mission.cash_max)}`);

  const statusEl = $('ms-status');
  if (statusEl) {
    if (complete.has(mission.name)) {
      const allPass = mResults.flatMap(r => r.checks ?? []).every(c => c.pass);
      statusEl.textContent = allPass ? 'COMPLETE \u2713' : 'COMPLETE \u2717';
      statusEl.className = 'msbar-value ' + (allPass ? 'complete' : 'fail');
    } else if (engages.length > 0) {
      statusEl.textContent = 'IN PROGRESS';
      statusEl.className = 'msbar-value';
    } else {
      statusEl.textContent = 'PENDING';
      statusEl.className = 'msbar-value';
    }
  }

  const table = $('results-table');
  const empty = $('empty-state');
  const tbody = $('results-body');

  if (!mResults.length) {
    if (table) table.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (table) table.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');

  if (tbody) {
    tbody.innerHTML = mResults.map((r, i) => buildRow(r, i === 0)).join('');
  }
}

// ── Build a table row ─────────────────────────────────────────────────────────
function buildRow(r, isNewest) {
  const isEngage  = r.type === 'engage';
  const isReward  = r.type === 'mission_reward';
  const isUnlock  = r.type === 'unlock_check';
  const allPass   = (r.checks ?? []).every(c => c.pass);

  const typeLabel = isEngage ? 'ENGAGE'
                  : isReward ? 'CASH REWARD'
                  : isUnlock ? 'UNLOCK CHK'
                  : (r.type ?? '').toUpperCase();
  const typeClass = isEngage ? 'type-engage'
                  : isReward ? 'type-reward'
                  : 'type-unlock';

  const pct = r.phase_pct ?? 0;
  const phaseHtml = isEngage ? `
    <div class="phase-bar">
      <span class="phase-num">${pct}%</span>
      <div class="phase-track">
        <div class="phase-fill${pct >= 100 ? ' full' : ''}" style="width:${pct}%"></div>
      </div>
    </div>` : '\u2014';

  const xpCheck   = (r.checks ?? []).find(c => c.field === 'xp');
  const supCheck  = (r.checks ?? []).find(c => c.field === 'supplies');
  const cashCheck = (r.checks ?? []).find(c => c.field === 'cash');

  const xpBefore = r.before?.xp ?? '\u2014';
  const xpAfter  = r.after?.xp  ?? '\u2014';
  const xpDelta  = (typeof xpBefore === 'number' && typeof xpAfter === 'number')
                   ? xpAfter - xpBefore : null;
  const xpDeltaClass = xpCheck?.pass ? 'pass' : 'fail';

  const supBefore = r.before?.supplies ?? '\u2014';
  const supAfter  = r.after?.supplies  ?? '\u2014';
  const supDelta  = (typeof supBefore === 'number' && typeof supAfter === 'number')
                    ? supBefore - supAfter : null;
  const supDeltaClass = supCheck?.pass ? 'pass' : 'fail';

  const xpCellHtml = isEngage ? `
    <div class="res-cell">
      <span class="res-before">${fmt(xpBefore)}</span>
      <span class="res-arrow">\u203a</span>
      <span class="res-after">${fmt(xpAfter)}</span>
      ${xpDelta !== null ? `<span class="res-delta ${xpDeltaClass}">+${xpDelta}</span>` : ''}
    </div>` : '\u2014';

  const supCellHtml = isEngage ? `
    <div class="res-cell">
      <span class="res-before">${fmt(supBefore)}</span>
      <span class="res-arrow">\u203a</span>
      <span class="res-after">${fmt(supAfter)}</span>
      ${supDelta !== null ? `<span class="res-delta ${supDeltaClass}">-${supDelta}</span>` : ''}
    </div>` : '\u2014';

  const xpVerifyHtml = xpCheck ? `
    <div class="vcheck">
      <div class="vcheck-row">
        <span class="vcheck-icon ${xpCheck.pass ? 'pass' : 'fail'}">${xpCheck.pass ? '\u2713' : '\u2717'}</span>
        <span class="vcheck-exp">exp ${escapeHtml(xpCheck.expected)}</span>
      </div>
      <div class="vcheck-row">
        <span class="vcheck-got">got ${escapeHtml(xpCheck.actual)}</span>
      </div>
    </div>` : '\u2014';

  const supVerifyHtml = supCheck ? `
    <div class="vcheck">
      <div class="vcheck-row">
        <span class="vcheck-icon ${supCheck.pass ? 'pass' : 'fail'}">${supCheck.pass ? '\u2713' : '\u2717'}</span>
        <span class="vcheck-exp">exp ${escapeHtml(supCheck.expected)}</span>
      </div>
      <div class="vcheck-row">
        <span class="vcheck-got">got ${escapeHtml(supCheck.actual)}</span>
      </div>
    </div>` : '\u2014';

  let cashHtml = '<span class="cash-na">\u2014</span>';
  if (cashCheck) {
    const cls = cashCheck.pass ? 'cash-pass' : 'cash-fail';
    cashHtml = `<span class="${cls} cash-cell">${cashCheck.pass ? '\u2713' : '\u2717'} ${escapeHtml(cashCheck.actual)}</span>`;
  } else if (isReward) {
    const earned = (r.after?.cash ?? 0) - (r.before?.cash ?? 0);
    cashHtml = `<span class="cash-cell">${fmtCash(earned)}</span>`;
  }

  const rowClass = isNewest ? 'row-new' : '';

  return `
    <tr class="${rowClass}">
      <td class="td-click col-click">${isEngage ? r.click_number : isReward ? '\u2605' : '\u25c6'}</td>
      <td class="td-time col-time">${escapeHtml(r.timestamp) ?? '\u2014'}</td>
      <td class="td-type ${typeClass} col-type">${escapeHtml(typeLabel)}</td>
      <td class="col-phase">${phaseHtml}</td>
      <td class="col-xp">${xpCellHtml}</td>
      <td class="col-sup">${supCellHtml}</td>
      <td class="col-xpv">${xpVerifyHtml}</td>
      <td class="col-supv">${supVerifyHtml}</td>
      <td class="col-cash">${cashHtml}</td>
      <td class="col-status"><span class="status-badge ${allPass ? 'pass' : 'fail'}">${allPass ? 'PASS' : 'FAIL'}</span></td>
    </tr>`;
}

// ── Status indicator ──────────────────────────────────────────────────────────
function setStatus(mode) {
  const pulse = $('pulse');
  const label = $('status-label');

  if (pulse) {
    pulse.classList.remove('live', 'complete');
    if (['live', 'complete'].includes(mode)) pulse.classList.add(mode);
  }

  if (label) {
    label.textContent =
      mode === 'live'     ? 'LIVE \u2014 RECEIVING DATA'
      : mode === 'complete' ? 'EXECUTION COMPLETE'
      : mode === 'waiting'  ? 'WAITING FOR DATA'
      : 'CONNECTION ERROR';
  }
}

// ── Kick off ──────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
