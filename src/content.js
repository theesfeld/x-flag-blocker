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
      subtree: true,
      characterData: true
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
    if (mutation.type === 'characterData') {
      processClosestArticle(mutation.target);
      continue;
    }

    if (!mutation.addedNodes || mutation.addedNodes.length === 0) {
      continue;
    }

    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement && node.matches(ARTICLE_SELECTOR)) {
        node.removeAttribute(PROCESSED_ATTR);
        processArticle(node);
      } else if (node instanceof HTMLElement) {
        const articles = node.querySelectorAll(ARTICLE_SELECTOR);
        for (const article of articles) {
          article.removeAttribute(PROCESSED_ATTR);
          processArticle(article);
        }
        processClosestArticle(node);
      } else {
        processClosestArticle(node);
      }
    }
  }
}

function processClosestArticle(node) {
  let element = null;
  if (node instanceof HTMLElement) {
    element = node;
  } else if (node && node.parentElement) {
    element = node.parentElement;
  }

  if (!element || !element.closest) {
    return;
  }

  const article = element.closest(ARTICLE_SELECTOR);
  if (!article) {
    return;
  }

  const status = article.getAttribute(PROCESSED_ATTR);
  if (status === 'blocked' || status === 'processing') {
    return;
  }

  if (status) {
    article.removeAttribute(PROCESSED_ATTR);
  }

  processArticle(article);
}

function processArticle(article) {
  if (!article) {
    return;
  }

  const processedState = article.getAttribute(PROCESSED_ATTR);
  if (processedState === 'blocked' || processedState === 'processing') {
    return;
  }

  if (state.selectedFlags.size === 0) {
    return;
  }

  article.setAttribute(PROCESSED_ATTR, 'processing');

  const displayNames = extractDisplayNames(article);
  if (displayNames.length === 0) {
    article.removeAttribute(PROCESSED_ATTR);
    return;
  }

  const matchedFlags = collectBlockedFlags(displayNames);
  if (matchedFlags.size > 0) {
    handleMatch(article, matchedFlags);
    article.setAttribute(PROCESSED_ATTR, 'blocked');
    return;
  }

  article.setAttribute(PROCESSED_ATTR, 'checked');
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
  let applied = false;

  switch (state.handlingMode) {
    case HANDLING_MODE.HIDE:
    default:
      applied = maskArticle(article, matchedFlags);
      break;
    case HANDLING_MODE.BLOCK:
      applied = attemptBlock(article, matchedFlags);
      break;
  }

  if (applied) {
    incrementBlockCounts(matchedFlags);
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

function attemptBlock(article, matchedFlags) {
  // Placeholder for a future implementation that would automate the block workflow.
  return maskArticle(article, matchedFlags);
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

function maskArticle(article, matchedFlags) {
  const tweetCell =
    article.closest('div[data-testid="cellInnerDiv"]') ||
    article.closest('div[data-testid="tweetDetail"]') ||
    article.closest('div[role="presentation"]') ||
    article;

  if (!tweetCell) {
    return false;
  }

  if (tweetCell.getAttribute('data-flag-filter-blocked') === 'true') {
    return false;
  }

  tweetCell.setAttribute('data-flag-filter-blocked', 'true');
  tweetCell.style.opacity = '0.45';

  const flagsList = Array.from(matchedFlags.values());
  const primaryFlag = flagsList[0] || '🏳️';

  replaceAvatarWithBlockedFlag(tweetCell, primaryFlag);
  updateBlockedUserName(article);
  blankTweetBody(article);

  return true;
}

function replaceAvatarWithBlockedFlag(tweetCell, flagEmoji) {
  const avatarWrapper = tweetCell.querySelector('div[data-testid="Tweet-User-Avatar"]');
  if (!avatarWrapper) {
    return;
  }

  avatarWrapper.style.position = 'relative';

  avatarWrapper.querySelectorAll('img').forEach((img) => {
    img.style.visibility = 'hidden';
    img.style.opacity = '0';
  });

  let badge = avatarWrapper.querySelector('.flag-filter-avatar-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'flag-filter-avatar-badge';
    badge.style.position = 'absolute';
    badge.style.top = '0';
    badge.style.left = '0';
    badge.style.width = '100%';
    badge.style.height = '100%';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.fontSize = '22px';
    badge.style.pointerEvents = 'none';
    badge.style.textShadow = '0 0 2px rgba(0,0,0,0.45)';
    avatarWrapper.appendChild(badge);
  }

  badge.innerHTML = '';

  const flagSpan = document.createElement('span');
  flagSpan.style.position = 'relative';
  flagSpan.style.display = 'inline-flex';
  flagSpan.style.alignItems = 'center';
  flagSpan.style.justifyContent = 'center';
  flagSpan.textContent = flagEmoji;

  const crossSpan = document.createElement('span');
  crossSpan.textContent = '🚫';
  crossSpan.style.position = 'absolute';
  crossSpan.style.top = '50%';
  crossSpan.style.left = '50%';
  crossSpan.style.transform = 'translate(-50%, -50%)';
  crossSpan.style.fontSize = '18px';
  crossSpan.style.pointerEvents = 'none';
  flagSpan.appendChild(crossSpan);

  badge.appendChild(flagSpan);
}

function updateBlockedUserName(article) {
  const userNameContainer = article.querySelector('div[data-testid="User-Name"]');
  if (!userNameContainer) {
    return;
  }
  userNameContainer.innerHTML = '';
  const span = document.createElement('span');
  span.setAttribute('dir', 'auto');
  span.textContent = 'Blocked By Flag Blocker';
  userNameContainer.appendChild(span);
}

function blankTweetBody(article) {
  const tweetTexts = article.querySelectorAll('div[data-testid="tweetText"], div[data-testid="tweetTextInline"]');
  tweetTexts.forEach((node) => {
    node.innerHTML = '';
    const placeholder = document.createElement('span');
    placeholder.textContent = ' ';
    placeholder.style.whiteSpace = 'pre';
    placeholder.className = 'flag-filter-blank';
    node.appendChild(placeholder);
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
  if (ariaLabel && !isFlagFilterPlaceholder(ariaLabel)) {
    names.add(ariaLabel);
  }

  container.querySelectorAll('[aria-label]').forEach((labelled) => {
    const value = labelled.getAttribute('aria-label');
    if (value && !isFlagFilterPlaceholder(value)) {
      names.add(value);
    }
  });

  container.querySelectorAll('span[dir="auto"], div[dir="auto"]').forEach((node) => {
    const text = getTextContent(node);
    if (text && !isFlagFilterPlaceholder(text)) {
      names.add(text);
    }
  });

  container.querySelectorAll('img[alt]').forEach((img) => {
    const alt = img.getAttribute('alt');
    if (alt && !isFlagFilterPlaceholder(alt)) {
      names.add(alt);
    }
  });

  const combined = getTextContent(container);
  if (combined && !isFlagFilterPlaceholder(combined)) {
    names.add(combined);
  }
}

function isFlagFilterPlaceholder(text) {
  if (!text) {
    return false;
  }
  return text.includes('Blocked By Flag Blocker') || text.includes('Blocked by Flag Blocker');
}
