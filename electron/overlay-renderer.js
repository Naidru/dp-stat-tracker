// Overlay window renderer. Plain script (no ES module, no Node access) —
// receives already-computed scoreboard data over IPC via preload.js's
// window.overlayAPI; never touches fs or parses anything itself. Team
// rendering itself lives in scoreboard-view.js, shared with the Hub's
// match-detail view.

const teamsEl = document.getElementById('teams');
const emptyEl = document.getElementById('empty');
const mapLabelEl = document.getElementById('mapLabel');
const roundLabelEl = document.getElementById('roundLabel');
const hotkeyHintEl = document.getElementById('hotkeyHint');
const predictionStripEl = document.getElementById('predictionStrip');
const predictionBadgeEl = document.getElementById('predictionBadge');
const predictionBadgeTextEl = document.getElementById('predictionBadgeText');
const predRating0El = document.getElementById('predRating0');
const predRating1El = document.getElementById('predRating1');
const predPct0El = document.getElementById('predPct0');
const predPct1El = document.getElementById('predPct1');
const predictionBarFillEl = document.getElementById('predictionBarFill');

function formatHotkeyDisplay(hk) {
  if (!hk) return 'Ctrl+Shift+Y';
  return hk
    .replace(/CommandOrControl/i, 'Ctrl')
    .replace(/Control/i, 'Ctrl');
}

function render(data) {
  if (data && data.overlayHotkey && hotkeyHintEl) {
    hotkeyHintEl.textContent = `${formatHotkeyDisplay(data.overlayHotkey)} to hide`;
  }

  if (!data || !data.teams || (data.teams[0].length === 0 && data.teams[1].length === 0)) {
    teamsEl.hidden = true;
    emptyEl.hidden = false;
    mapLabelEl.textContent = '';
    roundLabelEl.textContent = '';
    if (predictionStripEl) predictionStripEl.hidden = true;
    return;
  }

  teamsEl.hidden = false;
  emptyEl.hidden = true;
  renderScoreboardTeams(teamsEl, data);

  mapLabelEl.textContent = data.currentMap ?? '';
  const roundText = `Round ${data.roundCount}${data.status === 'in-progress' ? ' · Live' : ' · Final'}`;
  roundLabelEl.textContent = roundText;

  // Render prediction if available
  const pred = data.prediction;
  if (pred && (pred.team0WinChance !== undefined || pred.predictedWinner !== undefined)) {
    if (predictionStripEl) predictionStripEl.hidden = false;
    if (predictionBadgeEl) {
      predictionBadgeEl.className = 'prediction-badge';
      if (pred.isConcluded) {
        if (pred.isTie) {
          predictionBadgeEl.classList.add('winner-even');
          if (predictionBadgeTextEl) predictionBadgeTextEl.textContent = `MATCH TIED · ${pred.roundsWon0} - ${pred.roundsWon1}`;
        } else {
          const wonTeam0 = pred.roundsWon0 > pred.roundsWon1;
          predictionBadgeEl.classList.add(wonTeam0 ? 'winner-team0' : 'winner-team1');
          if (predictionBadgeTextEl) {
            predictionBadgeTextEl.textContent = `MATCH DECIDED · ${wonTeam0 ? 'BLUE' : 'ORANGE'} WON (${pred.roundsWon0} - ${pred.roundsWon1})`;
          }
        }
      } else if (pred.team0WinChance === 50) {
        predictionBadgeEl.classList.add('winner-even');
        const scoreSuffix = (pred.roundsWon0 > 0 || pred.roundsWon1 > 0) ? ` (${pred.roundsWon0}-${pred.roundsWon1})` : '';
        if (predictionBadgeTextEl) predictionBadgeTextEl.textContent = `EVEN MATCHUP · 50% / 50%${scoreSuffix}`;
      } else if (pred.predictedWinner === 0) {
        predictionBadgeEl.classList.add('winner-team0');
        const scoreSuffix = (pred.roundsWon0 > 0 || pred.roundsWon1 > 0) ? ` (${pred.roundsWon0}-${pred.roundsWon1})` : '';
        if (predictionBadgeTextEl) predictionBadgeTextEl.textContent = `BLUE WIN PREDICTION · ${pred.team0WinChance}% CHANCE${scoreSuffix}`;
      } else {
        predictionBadgeEl.classList.add('winner-team1');
        const scoreSuffix = (pred.roundsWon0 > 0 || pred.roundsWon1 > 0) ? ` (${pred.roundsWon0}-${pred.roundsWon1})` : '';
        if (predictionBadgeTextEl) predictionBadgeTextEl.textContent = `ORANGE WIN PREDICTION · ${pred.team1WinChance}% CHANCE${scoreSuffix}`;
      }
    }

    if (predRating0El) predRating0El.textContent = (pred.avgRating0 ?? 1.0).toFixed(2);
    if (predRating1El) predRating1El.textContent = (pred.avgRating1 ?? 1.0).toFixed(2);
    if (predPct0El) predPct0El.textContent = `(${pred.team0WinChance}%)`;
    if (predPct1El) predPct1El.textContent = `(${pred.team1WinChance}%)`;
    if (predictionBarFillEl) predictionBarFillEl.style.width = `${pred.team0WinChance}%`;
  } else if (predictionStripEl) {
    predictionStripEl.hidden = true;
  }
}

window.overlayAPI.onUpdate(render);

// The Hub owns the only toggle UI; this window just stays in sync with
// whatever it last set (see main.js's 'theme:set' broadcast). Initial value
// is already applied by the inline <script> in <head>, before this file
// even loads — this only handles a LATER change while the overlay is open.
window.themeAPI.onChange((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
});

if (window.overlayAPI?.onHotkeyUpdated) {
  window.overlayAPI.onHotkeyUpdated((newHotkey) => {
    if (hotkeyHintEl) {
      hotkeyHintEl.textContent = `${formatHotkeyDisplay(newHotkey)} to hide`;
    }
  });
}

// Player click-through to the Hub's Player Quick Reference modal. Delegated
// on the container (attached once) rather than per-row like hub-renderer.js's
// attachPlayerClickHandlers, since render() above rebuilds `.player-row`
// elements on every parser update (sub-second cadence during a live match) —
// delegation means new rows are covered automatically without re-attaching
// listeners on every render. Each row already carries data-account-id from
// scoreboard-view.js.
teamsEl.addEventListener('click', (e) => {
  const row = e.target.closest('.player-row');
  if (!row || !row.dataset.accountId) return;
  window.overlayAPI.openPlayerDetail(row.dataset.accountId);
});
