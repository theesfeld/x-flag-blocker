import { FLAG_EMOJI_OPTIONS } from './flags.js';

const SORTED_FLAGS = [...FLAG_EMOJI_OPTIONS].sort((a, b) => {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
});

const state = {
  selectedFlags: new Set(),
  mode: 'hide',
  filteredFlags: SORTED_FLAGS,
  blockCounts: new Map()
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
      flagBlockCounts: {}
    },
    (stored) => {
      state.selectedFlags = new Set(stored.selectedFlags || []);
      state.mode = stored.handlingMode || 'hide';
      state.blockCounts = toFlagCountMap(stored.flagBlockCounts || {});
      syncModeRadios();
      renderFlagList();
      renderSelectedFlags();
      renderBlockCounts();
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
    return;
  }

  elements.statsEmpty.hidden = true;

  const sorted = Array.from(state.blockCounts.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    elements.statsEmpty.hidden = false;
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
