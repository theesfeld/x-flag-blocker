import { FLAG_EMOJI_OPTIONS } from './flags.js';

const SORTED_FLAGS = [...FLAG_EMOJI_OPTIONS].sort((a, b) => {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
});

const state = {
  selectedFlags: new Set(),
  mode: 'hide',
  filteredFlags: SORTED_FLAGS,
  blockCounts: new Map(),
  blockedUsers: new Set(),
  userStats: new Map(),
  activeTab: 'overview'
};

const elements = {};

document.addEventListener('DOMContentLoaded', initializePopup);

function initializePopup() {
  cacheElements();
  attachEventListeners();
  chrome.storage.sync.get(
    {
      selectedFlags: [],
      handlingMode: 'hide',
      flagBlockCounts: {},
      blockedUsers: [],
      userStats: {}
    },
    (stored) => {
      state.selectedFlags = new Set(stored.selectedFlags || []);
      state.mode = stored.handlingMode || 'hide';
      state.blockCounts = toFlagCountMap(stored.flagBlockCounts || {});
      state.blockedUsers = new Set(stored.blockedUsers || []);
      state.userStats = toUserStatsMap(stored.userStats || {});
      syncModeRadios();
      renderFlagList();
      renderSelectedFlags();
      renderBlockCounts();
      renderBlockedUsersList();
      switchTab(state.activeTab);
    }
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') {
      return;
    }

    if (changes.flagBlockCounts) {
      state.blockCounts = toFlagCountMap(changes.flagBlockCounts.newValue || {});
      renderBlockCounts();
      renderSelectedFlags();
    }

    if (changes.blockedUsers) {
      state.blockedUsers = new Set(changes.blockedUsers.newValue || []);
      renderBlockedUsersList();
    }

    if (changes.userStats) {
      state.userStats = toUserStatsMap(changes.userStats.newValue || {});
      renderBlockedUsersList();
    }

    if (changes.selectedFlags) {
      state.selectedFlags = new Set(changes.selectedFlags.newValue || []);
      renderFlagList();
      renderSelectedFlags();
    }

    if (changes.handlingMode) {
      state.mode = changes.handlingMode.newValue || state.mode;
      syncModeRadios();
    }
  });
}

function cacheElements() {
  elements.flagList = document.getElementById('flag-list');
  elements.selectedFlags = document.getElementById('selected-flags');
  elements.searchInput = document.getElementById('search');
  elements.modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
  elements.blockCounts = document.getElementById('block-counts');
  elements.statsEmpty = document.getElementById('stats-empty');
  elements.resetCounts = document.getElementById('reset-counts');
  elements.tabs = Array.from(document.querySelectorAll('.tab'));
  elements.tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
  elements.blockedUserList = document.getElementById('blocked-user-list');
  elements.blockedUsersEmpty = document.getElementById('blocked-users-empty');
}

function attachEventListeners() {
  elements.searchInput.addEventListener('input', (event) => {
    const term = event.target.value.trim().toLowerCase();
    if (!term) {
      state.filteredFlags = SORTED_FLAGS;
    } else {
      state.filteredFlags = SORTED_FLAGS.filter((flag) => {
        return (
          flag.name.toLowerCase().includes(term) ||
          flag.code.toLowerCase().includes(term) ||
          flag.emoji === term
        );
      });
    }
    renderFlagList();
  });

  elements.modeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) {
        return;
      }
      state.mode = radio.value;
      chrome.storage.sync.set({ handlingMode: state.mode });
    });
  });

  elements.resetCounts.addEventListener('click', () => {
    if (elements.resetCounts.disabled) {
      return;
    }
    elements.resetCounts.disabled = true;
    chrome.storage.sync.set({ flagBlockCounts: {} }, () => {
      state.blockCounts = new Map();
      renderBlockCounts();
      renderSelectedFlags();
    });
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      if (!targetTab) {
        return;
      }
      switchTab(targetTab);
    });
  });
}

function syncModeRadios() {
  const activeRadio = elements.modeRadios.find((radio) => radio.value === state.mode);
  if (activeRadio) {
    activeRadio.checked = true;
  }
}

function renderFlagList() {
  elements.flagList.innerHTML = '';

  for (const flag of state.filteredFlags) {
    const listItem = document.createElement('li');
    listItem.className = 'flag-item';

    const label = document.createElement('label');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = flag.emoji;
    checkbox.checked = state.selectedFlags.has(flag.emoji);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.selectedFlags.add(flag.emoji);
      } else {
        state.selectedFlags.delete(flag.emoji);
      }
      persistSelection();
      renderSelectedFlags();
    });

    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'flag-emoji';
    emojiSpan.textContent = flag.emoji;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${flag.name} (${flag.code})`;

    label.appendChild(checkbox);
    label.appendChild(emojiSpan);
    label.appendChild(nameSpan);

    listItem.appendChild(label);
    elements.flagList.appendChild(listItem);
  }
}

function renderSelectedFlags() {
  elements.selectedFlags.innerHTML = '';

  if (state.selectedFlags.size === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No flags selected.';
    emptyMessage.style.color = '#536471';
    emptyMessage.style.fontSize = '12px';
    elements.selectedFlags.appendChild(emptyMessage);
    return;
  }

  for (const flagEmoji of state.selectedFlags) {
    const option = SORTED_FLAGS.find((item) => item.emoji === flagEmoji);
    const blockedTotal = state.blockCounts.get(flagEmoji) || 0;
    const pill = document.createElement('span');
    pill.className = 'flag-pill';

    const label = document.createElement('span');
    label.textContent = option
      ? `${option.emoji} ${option.code}${blockedTotal ? ` — ${blockedTotal} blocked` : ''}`
      : `${flagEmoji}${blockedTotal ? ` — ${blockedTotal} blocked` : ''}`;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      state.selectedFlags.delete(flagEmoji);
      persistSelection();
      renderFlagList();
      renderSelectedFlags();
    });

    pill.appendChild(label);
    pill.appendChild(removeButton);
    elements.selectedFlags.appendChild(pill);
  }
}

function persistSelection() {
  chrome.storage.sync.set({
    selectedFlags: Array.from(state.selectedFlags.values())
  });
}

function renderBlockCounts() {
  elements.blockCounts.innerHTML = '';

  if (!state.blockCounts || state.blockCounts.size === 0) {
    elements.statsEmpty.hidden = false;
    updateResetButtonState();
    return;
  }

  elements.statsEmpty.hidden = true;

  const sorted = Array.from(state.blockCounts.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    elements.statsEmpty.hidden = false;
    updateResetButtonState();
    return;
  }

  for (const [flagEmoji, count] of sorted) {
    const match = SORTED_FLAGS.find((item) => item.emoji === flagEmoji);
    const listItem = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = match ? `${match.emoji} ${match.name}` : flagEmoji;

    const countSpan = document.createElement('span');
    countSpan.textContent = `${count}`;

    listItem.appendChild(nameSpan);
    listItem.appendChild(countSpan);
    elements.blockCounts.appendChild(listItem);
  }

  updateResetButtonState();
}

function renderBlockedUsersList() {
  if (!elements.blockedUserList || !elements.blockedUsersEmpty) {
    return;
  }

  elements.blockedUserList.innerHTML = '';

  if (!state.blockedUsers || state.blockedUsers.size === 0) {
    elements.blockedUsersEmpty.hidden = false;
    return;
  }

  elements.blockedUsersEmpty.hidden = true;

  const handles = Array.from(state.blockedUsers).sort((a, b) => a.localeCompare(b));

  for (const handle of handles) {
    const stats = getUserStats(handle);
    const score = computeUserScore(stats, true);

    const item = document.createElement('li');
    item.className = 'blocked-user-item';

    const header = document.createElement('header');
    const title = document.createElement('h3');
    title.textContent = `@${handle}`;
    const scoreLabel = document.createElement('span');
    scoreLabel.textContent = `Score: ${score}`;

    header.appendChild(title);
    header.appendChild(scoreLabel);
    item.appendChild(header);

    if (stats.flagMatches > 0) {
      const flagsLine = document.createElement('div');
      flagsLine.className = 'metrics';
      const flagsSummary = stats.flags.size ? ` (${formatFlagsList(stats.flags)})` : '';
      flagsLine.textContent = `Flag matches: ${stats.flagMatches}${flagsSummary}`;
      item.appendChild(flagsLine);
    }

    if (stats.manualBlocks > 0) {
      const manualLine = document.createElement('div');
      manualLine.className = 'metrics';
      manualLine.textContent = `Manual blocks: ${stats.manualBlocks}`;
      item.appendChild(manualLine);
    }

    if (stats.nickname) {
      const nicknameLine = document.createElement('div');
      nicknameLine.className = 'metrics';
      nicknameLine.textContent = `Nickname: ${stats.nickname}`;
      item.appendChild(nicknameLine);
    }

    if (stats.note) {
      const noteLine = document.createElement('div');
      noteLine.className = 'metrics';
      noteLine.textContent = `Note: ${stats.note}`;
      item.appendChild(noteLine);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Unblock';
    button.addEventListener('click', () => {
      unblockUser(handle);
    });

    item.appendChild(button);
    elements.blockedUserList.appendChild(item);
  }
}

function toFlagCountMap(raw) {
  const map = new Map();
  for (const [flag, count] of Object.entries(raw || {})) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    map.set(flag, numeric);
  }
  return map;
}

function toUserStatsMap(raw) {
  const map = new Map();
  if (!raw || typeof raw !== 'object') {
    return map;
  }
  for (const [handle, stats] of Object.entries(raw)) {
    if (!handle) {
      continue;
    }
    map.set(handle, {
      flagMatches: Number(stats?.flagMatches) || 0,
      manualBlocks: Number(stats?.manualBlocks) || 0,
      flags: new Set(Array.isArray(stats?.flags) ? stats.flags : []),
      note: typeof stats?.note === 'string' ? stats.note : '',
      nickname: typeof stats?.nickname === 'string' ? stats.nickname : ''
    });
  }
  return map;
}

function getUserStats(handle) {
  if (!handle) {
    return {
      flagMatches: 0,
      manualBlocks: 0,
      flags: new Set(),
      note: '',
      nickname: ''
    };
  }

  const stats = state.userStats.get(handle);
  if (!stats) {
    return {
      flagMatches: 0,
      manualBlocks: 0,
      flags: new Set(),
      note: '',
      nickname: ''
    };
  }

  return {
    flagMatches: stats.flagMatches || 0,
    manualBlocks: stats.manualBlocks || 0,
    flags: new Set(stats.flags instanceof Set ? Array.from(stats.flags) : stats.flags || []),
    note: stats.note || '',
    nickname: stats.nickname || ''
  };
}

function computeUserScore(stats, isBlocked) {
  if (!stats) {
    return isBlocked ? 10 : 0;
  }
  let score = 0;
  score += (stats.flagMatches || 0) * 5;
  score += (stats.flags ? stats.flags.size : 0) * 2;
  score += (stats.manualBlocks || 0) * 5;
  if (isBlocked) {
    score += 10;
  }
  return score;
}

function formatFlagsList(flags) {
  if (!flags || !flags.size) {
    return '';
  }
  return Array.from(flags.values()).join(' ');
}

function switchTab(tabName) {
  state.activeTab = tabName;

  elements.tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  elements.tabPanels.forEach((panel) => {
    const isActive = panel.id === `tab-${tabName}`;
    panel.hidden = !isActive;
    panel.classList.toggle('active', isActive);
  });
}

function updateResetButtonState() {
  if (!elements.resetCounts) {
    return;
  }
  const disabled = !state.blockCounts || state.blockCounts.size === 0;
  elements.resetCounts.disabled = disabled;
}

function unblockUser(handle) {
  if (!handle || !state.blockedUsers.has(handle)) {
    return;
  }

  const next = new Set(state.blockedUsers);
  next.delete(handle);
  state.blockedUsers = next;

  renderBlockedUsersList();

  chrome.storage.sync.set({ blockedUsers: Array.from(next) });
}
