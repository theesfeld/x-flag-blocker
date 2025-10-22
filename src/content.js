const SETTINGS_KEY = {
  FLAGS: 'selectedFlags',
  MODE: 'handlingMode'
};

const HANDLING_MODE = {
  HIDE: 'hide',
  BLOCK: 'block' // Reserved for future enhancement.
};

const state = {
  selectedFlags: new Set(),
  handlingMode: HANDLING_MODE.HIDE,
  blockCounts: new Map(),
  observer: null
};

const ARTICLE_SELECTORS = [
  'article[data-testid="tweet"]',
  'div[data-testid="tweet"]',
  'article[role="article"]'
];
const ARTICLE_SELECTOR = ARTICLE_SELECTORS.join(', ');
const PROCESSED_ATTR = 'data-flag-filter-processed';

chrome.storage.sync.get(
  {
    [SETTINGS_KEY.FLAGS]: [],
    [SETTINGS_KEY.MODE]: HANDLING_MODE.HIDE,
    flagBlockCounts: {}
  },
  (stored) => {
    state.selectedFlags = new Set(stored[SETTINGS_KEY.FLAGS] || []);
    state.handlingMode = stored[SETTINGS_KEY.MODE] || HANDLING_MODE.HIDE;
    state.blockCounts = new Map(Object.entries(stored.flagBlockCounts || {}).map(([flag, count]) => [flag, Number(count) || 0]));
    startFiltering();
  }
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }

  if (changes[SETTINGS_KEY.FLAGS]) {
    const newFlags = changes[SETTINGS_KEY.FLAGS].newValue || [];
    state.selectedFlags = new Set(newFlags);
    rerunFiltering();
  }

  if (changes[SETTINGS_KEY.MODE]) {
    state.handlingMode = changes[SETTINGS_KEY.MODE].newValue || HANDLING_MODE.HIDE;
    rerunFiltering();
  }

  if (changes.flagBlockCounts) {
    const updated = changes.flagBlockCounts.newValue || {};
    state.blockCounts = new Map(Object.entries(updated).map(([flag, count]) => [flag, Number(count) || 0]));
  }
});

function startFiltering() {
  if (!document.body) {
    window.addEventListener('DOMContentLoaded', startFiltering, { once: true });
    return;
  }

  if (!state.observer) {
    state.observer = new MutationObserver(handleMutations);
    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  filterExistingArticles();
}

function rerunFiltering() {
  // Remove processed mark to allow re-processing with new settings.
  for (const article of document.querySelectorAll(`${ARTICLE_SELECTOR}[${PROCESSED_ATTR}]`)) {
    article.removeAttribute(PROCESSED_ATTR);
  }
  filterExistingArticles();
}

function filterExistingArticles() {
  const articles = document.querySelectorAll(ARTICLE_SELECTOR);
  for (const article of articles) {
    processArticle(article);
  }
}

function handleMutations(mutations) {
  for (const mutation of mutations) {
    if (!mutation.addedNodes || mutation.addedNodes.length === 0) {
      continue;
    }

    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (node.matches && node.matches(ARTICLE_SELECTOR)) {
        processArticle(node);
        continue;
      }

      const articles = node.querySelectorAll ? node.querySelectorAll(ARTICLE_SELECTOR) : [];
      for (const article of articles) {
        processArticle(article);
      }
    }
  }
}

function processArticle(article) {
  if (!article || article.hasAttribute(PROCESSED_ATTR)) {
    return;
  }

  if (state.selectedFlags.size === 0) {
    return;
  }

  article.setAttribute(PROCESSED_ATTR, 'checking');

  const displayNames = extractDisplayNames(article);
  const matchedFlags = collectBlockedFlags(displayNames);
  if (matchedFlags.size > 0) {
    handleMatch(article, matchedFlags);
    return;
  }

  article.setAttribute(PROCESSED_ATTR, 'true');
}

function extractDisplayNames(article) {
  const names = new Set();
  const nameContainers = article.querySelectorAll('div[data-testid="User-Name"]');

  nameContainers.forEach((container) => {
    gatherNameStrings(container, names);
  });

  if (names.size === 0) {
    const fallbackName = article.querySelector('a[role="link"][dir="auto"], div[dir="auto"]');
    const fallbackText = getTextContent(fallbackName);
    if (fallbackText) {
      names.add(fallbackText);
    }
  }

  return Array.from(names.values());
}

function collectBlockedFlags(displayNames) {
  const matched = new Set();
  for (const name of displayNames) {
    if (typeof name !== 'string') {
      continue;
    }
    for (const flag of state.selectedFlags) {
      if (flag && name.includes(flag)) {
        matched.add(flag);
      }
    }
  }
  return matched;
}

function handleMatch(article, matchedFlags) {
  incrementBlockCounts(matchedFlags);

  switch (state.handlingMode) {
    case HANDLING_MODE.HIDE:
    default:
      hideArticle(article);
      break;
    case HANDLING_MODE.BLOCK:
      attemptBlock(article);
      break;
  }
}

function hideArticle(article) {
  const tweetCell =
    article.closest('div[data-testid="cellInnerDiv"]') ||
    article.closest('div[data-testid="tweetDetail"]') ||
    article.closest('div[role="presentation"]') ||
    article;

  tweetCell.remove();
}

function attemptBlock(article) {
  // Placeholder for a future implementation that would automate the block workflow.
  hideArticle(article);
}

function incrementBlockCounts(flags) {
  if (!flags || flags.size === 0) {
    return;
  }

  let updated = false;
  const nextCounts = new Map(state.blockCounts);

  for (const flag of flags) {
    const current = nextCounts.get(flag) || 0;
    nextCounts.set(flag, current + 1);
    updated = true;
  }

  if (!updated) {
    return;
  }

  state.blockCounts = nextCounts;
  chrome.storage.sync.set({
    flagBlockCounts: Object.fromEntries(nextCounts)
  });
}

function getTextContent(element) {
  if (!element) {
    return '';
  }
  const text = flattenNodeText(element).replace(/\s+/g, ' ').trim();
  return text;
}

function flattenNodeText(node) {
  if (!node) {
    return '';
  }

  let output = '';

  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      output += child.textContent || '';
      return;
    }

    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = /** @type {Element} */ (child);
      if (element.tagName === 'IMG' && element.getAttribute('alt')) {
        output += element.getAttribute('alt');
        return;
      }
      output += flattenNodeText(element);
    }
  });

  return output;
}

function gatherNameStrings(container, names) {
  const ariaLabel = container.getAttribute('aria-label');
  if (ariaLabel) {
    names.add(ariaLabel);
  }

  container.querySelectorAll('[aria-label]').forEach((labelled) => {
    const value = labelled.getAttribute('aria-label');
    if (value) {
      names.add(value);
    }
  });

  container.querySelectorAll('span[dir="auto"], div[dir="auto"]').forEach((node) => {
    const text = getTextContent(node);
    if (text) {
      names.add(text);
    }
  });

  container.querySelectorAll('img[alt]').forEach((img) => {
    const alt = img.getAttribute('alt');
    if (alt) {
      names.add(alt);
    }
  });

  const combined = getTextContent(container);
  if (combined) {
    names.add(combined);
  }
}
