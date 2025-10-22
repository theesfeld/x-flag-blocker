const SETTINGS_KEY = {
  FLAGS: 'selectedFlags',
  MODE: 'handlingMode',
  BLOCKED_USERS: 'blockedUsers',
  USER_STATS: 'userStats'
};

const HANDLING_MODE = {
  HIDE: 'hide',
  BLOCK: 'block' // Reserved for future enhancement.
};

const FLAG_FILTER_UI_ATTR = 'data-flag-filter-ui';

const state = {
  selectedFlags: new Set(),
  handlingMode: HANDLING_MODE.HIDE,
  blockCounts: new Map(),
  blockedUsers: new Set(),
  userStats: new Map(),
  observer: null
};

let menuDismissListenerAttached = false;

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
    flagBlockCounts: {},
    [SETTINGS_KEY.BLOCKED_USERS]: [],
    [SETTINGS_KEY.USER_STATS]: {}
  },
  (stored) => {
    state.selectedFlags = new Set(stored[SETTINGS_KEY.FLAGS] || []);
    state.handlingMode = stored[SETTINGS_KEY.MODE] || HANDLING_MODE.HIDE;
    state.blockCounts = new Map(Object.entries(stored.flagBlockCounts || {}).map(([flag, count]) => [flag, Number(count) || 0]));
    state.blockedUsers = new Set(stored[SETTINGS_KEY.BLOCKED_USERS] || []);
    state.userStats = toUserStatsMap(stored[SETTINGS_KEY.USER_STATS] || {});
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

  if (changes[SETTINGS_KEY.BLOCKED_USERS]) {
    const updated = changes[SETTINGS_KEY.BLOCKED_USERS].newValue || [];
    state.blockedUsers = new Set(updated);
    filterExistingArticles();
  }

  if (changes[SETTINGS_KEY.USER_STATS]) {
    state.userStats = toUserStatsMap(changes[SETTINGS_KEY.USER_STATS].newValue || {});
    refreshAllUserMenus();
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
    if (mutation.type === 'characterData' && isFlagFilterUiNode(mutation.target)) {
      continue;
    }

    if (mutation.type === 'characterData') {
      processClosestArticle(mutation.target);
      continue;
    }

    if (!mutation.addedNodes || mutation.addedNodes.length === 0) {
      continue;
    }

    for (const node of mutation.addedNodes) {
      if (isFlagFilterUiNode(node)) {
        continue;
      }

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

  if (isFlagFilterUiNode(element)) {
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

  article.setAttribute(PROCESSED_ATTR, 'processing');

  const tweetCell = getTweetCell(article);
  const handle = sanitizeHandle(extractUserHandle(article));

  if (handle) {
    article.dataset.flagFilterHandle = handle;
    if (tweetCell) {
      tweetCell.dataset.flagFilterHandle = handle;
    }
  } else {
    delete article.dataset.flagFilterHandle;
    if (tweetCell) {
      delete tweetCell.dataset.flagFilterHandle;
    }
  }

  ensureUserMenu(tweetCell, handle);
  applyNickname(article, handle);

  if (handle && state.blockedUsers.has(handle)) {
    maskArticle(article, new Set());
    article.setAttribute(PROCESSED_ATTR, 'blocked');
    updateUserMenuForHandle(tweetCell, handle);
    return;
  }

  if (state.selectedFlags.size === 0) {
    article.setAttribute(PROCESSED_ATTR, 'checked');
    updateUserMenuForHandle(tweetCell, handle);
    return;
  }

  const displayNames = extractDisplayNames(article);
  if (displayNames.length === 0) {
    article.removeAttribute(PROCESSED_ATTR);
    updateUserMenuForHandle(tweetCell, handle);
    return;
  }

  const matchedFlags = collectBlockedFlags(displayNames);
  if (matchedFlags.size > 0) {
    handleMatch(article, matchedFlags, handle);
    article.setAttribute(PROCESSED_ATTR, 'blocked');
    updateUserMenuForHandle(tweetCell, handle);
    applyNickname(article, handle);
    return;
  }

  article.setAttribute(PROCESSED_ATTR, 'checked');
  updateUserMenuForHandle(tweetCell, handle);
  applyNickname(article, handle);
}

function extractUserHandle(article) {
  if (!article) {
    return '';
  }

  const cached = article.dataset.flagFilterHandle;
  if (cached) {
    return cached;
  }

  const handleLink = article.querySelector('div[data-testid="User-Name"] a[href]');
  const hrefCandidate = handleLink ? handleLink.getAttribute('href') : '';
  let handle = parseHandleFromHref(hrefCandidate);

  if (!handle) {
    const mentionSpan = article.querySelector('div[data-testid="User-Name"] span');
    if (mentionSpan && mentionSpan.textContent) {
      handle = sanitizeHandle(mentionSpan.textContent);
    }
  }

  if (!handle) {
    const statusLink = article.querySelector('a[href*="/status/"]');
    if (statusLink) {
      handle = parseHandleFromHref(statusLink.getAttribute('href'));
    }
  }

  return handle;
}

function parseHandleFromHref(href) {
  if (!href) {
    return '';
  }

  let candidatePath = href;
  try {
    const url = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin);
    candidatePath = url.pathname;
  } catch (error) {
    // Fallback to raw href when URL construction fails.
  }

  if (!candidatePath) {
    return '';
  }

  const segments = candidatePath.split('/').filter(Boolean);
  if (!segments.length) {
    return '';
  }

  return sanitizeHandle(segments[0]);
}

function sanitizeHandle(raw) {
  if (!raw) {
    return '';
  }

  const cleaned = raw.replace(/^@/, '').replace(/[^0-9a-zA-Z_]/g, '');
  return cleaned.toLowerCase();
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

function handleMatch(article, matchedFlags, handle) {
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
    if (handle) {
      recordFlagMatch(handle, matchedFlags);
      updateUserMenuForHandle(getTweetCell(article), handle);
    }
  }
}

function hideArticle(article) {
  const tweetCell = getTweetCell(article);

  if (!tweetCell) {
    return;
  }

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

function getTweetCell(article) {
  if (!article) {
    return null;
  }
  return (
    article.closest('div[data-testid="cellInnerDiv"]') ||
    article.closest('div[data-testid="tweetDetail"]') ||
    article.closest('div[role="presentation"]') ||
    article
  );
}

function maskArticle(article, matchedFlags) {
  const tweetCell = getTweetCell(article);

  if (!tweetCell) {
    return false;
  }

  if (tweetCell.getAttribute('data-flag-filter-blocked') === 'true') {
    return false;
  }

  tweetCell.setAttribute('data-flag-filter-blocked', 'true');

  const flagsList = Array.from(matchedFlags.values());
  const primaryFlag = flagsList[0] || '🚫';

  tweetCell.dataset.flagFilterFlags = flagsList.join(' ');
  tweetCell.dataset.flagFilterPrimaryFlag = primaryFlag;
  tweetCell.dataset.flagFilterRevealed = 'false';
  tweetCell.style.opacity = '0.45';

  replaceAvatarWithBlockedFlag(tweetCell, primaryFlag);
  updateBlockedUserName(article);
  blankTweetBody(article);
  hideTweetMedia(article);
  ensureRevealControls(tweetCell, article);
  applyNickname(article, article?.dataset?.flagFilterHandle || tweetCell?.dataset?.flagFilterHandle || '');

  return true;
}

function replaceAvatarWithBlockedFlag(tweetCell, flagEmoji) {
  const avatarWrapper = tweetCell.querySelector('div[data-testid="Tweet-User-Avatar"]');
  if (!avatarWrapper) {
    return;
  }

  avatarWrapper.style.position = 'relative';

  avatarWrapper.querySelectorAll('img').forEach((img) => {
    if (!img.dataset.flagFilterPrevVisibility) {
      img.dataset.flagFilterPrevVisibility = img.style.visibility || '';
    }
    if (!img.dataset.flagFilterPrevOpacity) {
      img.dataset.flagFilterPrevOpacity = img.style.opacity || '';
    }
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

  badge.style.display = 'flex';
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
  if (!userNameContainer.dataset.flagFilterOriginalName) {
    const clone = userNameContainer.cloneNode(true);
    clone.querySelectorAll(`[${FLAG_FILTER_UI_ATTR}="true"]`).forEach((node) => node.remove());
    userNameContainer.dataset.flagFilterOriginalName = clone.innerHTML;
  }

  Array.from(userNameContainer.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && isFlagFilterUiElement(node)) {
      return;
    }
    node.remove();
  });

  let label = userNameContainer.querySelector('.flag-filter-block-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'flag-filter-block-label';
    label.setAttribute('dir', 'auto');
    label.style.marginLeft = '4px';
    markFlagFilterUi(label);
    userNameContainer.appendChild(label);
  }
  label.textContent = 'Blocked By Flag Blocker';
}

function applyNickname(article, handle) {
  handle = sanitizeHandle(handle);
  if (!article || !handle) {
    return;
  }

  const nickname = getNickname(handle);
  const nameContainer = article.querySelector('div[data-testid="User-Name"]');
  if (!nameContainer) {
    return;
  }

  let badge = nameContainer.querySelector('.flag-filter-nickname');
  if (!nickname) {
    if (badge) {
      badge.remove();
    }
    return;
  }

  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'flag-filter-nickname';
    badge.style.marginLeft = '6px';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(29, 155, 240, 0.12)';
    badge.style.color = '#1d9bf0';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '600';
    markFlagFilterUi(badge);
    nameContainer.appendChild(badge);
  }

  badge.textContent = nickname;
}

function blankTweetBody(article) {
  const tweetTexts = article.querySelectorAll('div[data-testid="tweetText"], div[data-testid="tweetTextInline"]');
  tweetTexts.forEach((node) => {
    if (!node.dataset.flagFilterOriginalContent) {
      node.dataset.flagFilterOriginalContent = node.innerHTML;
    }
    node.innerHTML = '';
    const placeholder = document.createElement('span');
    placeholder.textContent = ' ';
    placeholder.style.whiteSpace = 'pre';
    placeholder.className = 'flag-filter-blank';
    node.appendChild(placeholder);
  });
}

function hideTweetMedia(article) {
  const mediaNodes = article.querySelectorAll(
    'img, video, div[data-testid="tweetPhoto"], div[data-testid="videoPlayer"], div[data-testid="card.wrapper"]'
  );

  mediaNodes.forEach((node) => {
    if (node.closest('div[data-testid="Tweet-User-Avatar"]')) {
      return;
    }
    if (!node.dataset.flagFilterMediaHidden) {
      node.dataset.flagFilterMediaHidden = 'true';
      node.dataset.flagFilterMediaDisplay = node.style.display || '';
    }
    node.style.display = 'none';
  });
}

function restoreTweetMedia(article) {
  const nodes = article.querySelectorAll('[data-flag-filter-media-hidden="true"]');
  nodes.forEach((node) => {
    const original = node.dataset.flagFilterMediaDisplay || '';
    node.style.display = original;
    delete node.dataset.flagFilterMediaHidden;
    delete node.dataset.flagFilterMediaDisplay;
  });
}

function restoreAvatar(tweetCell) {
  const avatarWrapper = tweetCell.querySelector('div[data-testid="Tweet-User-Avatar"]');
  if (!avatarWrapper) {
    return;
  }

  avatarWrapper.querySelectorAll('img').forEach((img) => {
    if (img.dataset.flagFilterPrevVisibility !== undefined) {
      img.style.visibility = img.dataset.flagFilterPrevVisibility;
    } else {
      img.style.visibility = '';
    }
    if (img.dataset.flagFilterPrevOpacity !== undefined) {
      img.style.opacity = img.dataset.flagFilterPrevOpacity;
    } else {
      img.style.opacity = '';
    }
  });

  const badge = avatarWrapper.querySelector('.flag-filter-avatar-badge');
  if (badge) {
    badge.style.display = 'none';
  }
}

function restoreUserName(article) {
  const userNameContainer = article.querySelector('div[data-testid="User-Name"]');
  if (!userNameContainer) {
    return;
  }

  if (userNameContainer.dataset.flagFilterOriginalName !== undefined) {
    const uiNodes = Array.from(userNameContainer.querySelectorAll(`[${FLAG_FILTER_UI_ATTR}="true"]`));
    const uiParents = uiNodes.map((node) => ({ node, nextSibling: node.nextSibling }));
    userNameContainer.innerHTML = userNameContainer.dataset.flagFilterOriginalName;
    uiParents.forEach(({ node, nextSibling }) => {
      if (node.classList && node.classList.contains('flag-filter-block-label')) {
        node.remove();
        return;
      }
      if (!nextSibling || nextSibling.parentNode !== userNameContainer) {
        userNameContainer.insertBefore(node, userNameContainer.firstChild);
      } else {
        userNameContainer.insertBefore(node, nextSibling);
      }
    });
  }
}

function restoreTweetBody(article) {
  const tweetTexts = article.querySelectorAll('div[data-testid="tweetText"], div[data-testid="tweetTextInline"]');
  tweetTexts.forEach((node) => {
    if (node.dataset.flagFilterOriginalContent !== undefined) {
      node.innerHTML = node.dataset.flagFilterOriginalContent;
    }
  });
}

function ensureRevealControls(tweetCell, article) {
  if (!tweetCell) {
    return;
  }

  let controls = tweetCell.querySelector('.flag-filter-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'flag-filter-controls';
    controls.style.marginTop = '8px';
    controls.style.padding = '6px 8px';
    controls.style.borderRadius = '8px';
    controls.style.background = 'rgba(15, 20, 25, 0.08)';
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.justifyContent = 'space-between';
    controls.style.gap = '8px';
    markFlagFilterUi(controls);

    const info = document.createElement('span');
    info.className = 'flag-filter-controls-info';
    info.style.fontSize = '12px';
    info.style.color = '#536471';
    markFlagFilterUi(info);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flag-filter-controls-button';
    button.style.padding = '4px 10px';
    button.style.borderRadius = '999px';
    button.style.border = 'none';
    button.style.fontSize = '12px';
    button.style.fontWeight = '600';
    button.style.cursor = 'pointer';
    button.style.background = '#1d9bf0';
    button.style.color = '#ffffff';
    markFlagFilterUi(button);

    controls.appendChild(info);
    controls.appendChild(button);
    tweetCell.appendChild(controls);
  }

  const info = controls.querySelector('.flag-filter-controls-info');
  const button = controls.querySelector('.flag-filter-controls-button');

  const flagsLabel = tweetCell.dataset.flagFilterFlags || '';
  info.textContent = flagsLabel ? `Blocked flags: ${flagsLabel}` : 'Blocked manually';

  const revealed = tweetCell.dataset.flagFilterRevealed === 'true';
  button.textContent = revealed ? 'Hide post' : 'Show post';
  button.style.background = revealed ? '#536471' : '#1d9bf0';

  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleReveal(tweetCell, article, !revealed);
  };
}

function toggleReveal(tweetCell, article, shouldReveal) {
  if (!tweetCell || !article) {
    return;
  }

  if (shouldReveal) {
    tweetCell.dataset.flagFilterRevealed = 'true';
    tweetCell.style.opacity = '1';
    restoreAvatar(tweetCell);
    restoreUserName(article);
    restoreTweetBody(article);
    restoreTweetMedia(article);
    applyNickname(article, article?.dataset?.flagFilterHandle || tweetCell?.dataset?.flagFilterHandle || '');
  } else {
    tweetCell.dataset.flagFilterRevealed = 'false';
    tweetCell.style.opacity = '0.45';
    const primaryFlag = tweetCell.dataset.flagFilterPrimaryFlag || '🚫';
    replaceAvatarWithBlockedFlag(tweetCell, primaryFlag);
    updateBlockedUserName(article);
    blankTweetBody(article);
    hideTweetMedia(article);
    applyNickname(article, article?.dataset?.flagFilterHandle || tweetCell?.dataset?.flagFilterHandle || '');
  }

  ensureRevealControls(tweetCell, article);
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
      if (isFlagFilterUiElement(element)) {
        return;
      }
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
  if (isFlagFilterUiElement(container)) {
    return;
  }

  const ariaLabel = container.getAttribute('aria-label');
  if (ariaLabel && !isFlagFilterPlaceholder(ariaLabel)) {
    names.add(ariaLabel);
  }

  container.querySelectorAll('[aria-label]').forEach((labelled) => {
    const value = labelled.getAttribute('aria-label');
    if (value && !isFlagFilterPlaceholder(value) && !isFlagFilterUiElement(labelled)) {
      names.add(value);
    }
  });

  container.querySelectorAll('span[dir="auto"], div[dir="auto"]').forEach((node) => {
    if (isFlagFilterUiElement(node)) {
      return;
    }
    const text = getTextContent(node);
    if (text && !isFlagFilterPlaceholder(text)) {
      names.add(text);
    }
  });

  container.querySelectorAll('img[alt]').forEach((img) => {
    if (isFlagFilterUiElement(img)) {
      return;
    }
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

function getMutableUserStats(handle) {
  if (!handle) {
    return null;
  }

  let stats = state.userStats.get(handle);
  if (!stats) {
    stats = {
      flagMatches: 0,
      manualBlocks: 0,
      flags: new Set(),
      note: '',
      nickname: ''
    };
    state.userStats.set(handle, stats);
  }

  if (!(stats.flags instanceof Set)) {
    stats.flags = new Set(stats.flags || []);
  }

  if (typeof stats.note !== 'string') {
    stats.note = stats.note ? String(stats.note) : '';
  }

  if (typeof stats.nickname !== 'string') {
    stats.nickname = stats.nickname ? String(stats.nickname) : '';
  }

  return stats;
}

function recordFlagMatch(handle, matchedFlags) {
  handle = sanitizeHandle(handle);
  if (!handle || !matchedFlags || matchedFlags.size === 0) {
    return;
  }

  const stats = getMutableUserStats(handle);
  if (!stats) {
    return;
  }

  stats.flagMatches += 1;
  matchedFlags.forEach((flag) => stats.flags.add(flag));
  persistUserStats();
}

function recordManualBlock(handle) {
  handle = sanitizeHandle(handle);
  if (!handle) {
    return;
  }

  const stats = getMutableUserStats(handle);
  if (!stats) {
    return;
  }

  stats.manualBlocks += 1;
  persistUserStats();
}

function updateUserAnnotations(handle, nickname, note) {
  handle = sanitizeHandle(handle);
  const stats = getMutableUserStats(handle);
  if (!stats) {
    return;
  }

  const nextNickname = nickname ? nickname.slice(0, 40) : '';
  const nextNote = note ? note.slice(0, 500) : '';

  const changed = stats.nickname !== nextNickname || stats.note !== nextNote;
  if (!changed) {
    return;
  }

  stats.nickname = nextNickname;
  stats.note = nextNote;
  persistUserStats();
  refreshNicknameForHandle(handle);
}

function getNickname(handle) {
  handle = sanitizeHandle(handle);
  const stats = getUserStats(handle);
  return stats.nickname || '';
}

function refreshNicknameForHandle(handle) {
  handle = sanitizeHandle(handle);
  if (!handle) {
    return;
  }

  const articles = document.querySelectorAll(`${ARTICLE_SELECTOR}[data-flag-filter-handle="${handle}"]`);
  articles.forEach((article) => {
    applyNickname(article, handle);
  });
}

function ensureUserMenu(tweetCell, handle) {
  handle = sanitizeHandle(handle);
  if (!tweetCell || !handle) {
    return;
  }

  let wrapper = tweetCell.querySelector('.flag-filter-menu');
  if (wrapper && wrapper.tagName !== 'SPAN') {
    wrapper.remove();
    wrapper = null;
  }
  if (!wrapper) {
    wrapper = createUserMenuWrapper(tweetCell, handle);
    if (!wrapper) {
      return;
    }
  }

  wrapper.dataset.handle = handle;
  renderUserMenuPanel(wrapper, handle);
}

function createUserMenuWrapper(tweetCell, handle) {
  const nameContainer = tweetCell.querySelector('div[data-testid="User-Name"]');
  if (!nameContainer) {
    return null;
  }

  const wrapper = document.createElement('span');
  wrapper.className = 'flag-filter-menu';
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.position = 'relative';
  wrapper.style.marginRight = '6px';
  wrapper.dataset.handle = handle;
  markFlagFilterUi(wrapper);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'flag-filter-menu-trigger';
  trigger.textContent = '>';
  trigger.style.border = '1px solid rgba(83, 100, 113, 0.35)';
  trigger.style.background = 'rgba(255, 255, 255, 0.12)';
  trigger.style.color = '#536471';
  trigger.style.width = '20px';
  trigger.style.height = '20px';
  trigger.style.borderRadius = '999px';
  trigger.style.cursor = 'pointer';
  trigger.style.fontSize = '12px';
  trigger.style.lineHeight = '1';
  trigger.style.display = 'inline-flex';
  trigger.style.alignItems = 'center';
  trigger.style.justifyContent = 'center';
  trigger.style.marginRight = '4px';
  trigger.style.transition = 'background 0.2s ease, color 0.2s ease';
  trigger.setAttribute('aria-label', 'Open Flag Filter menu');
  markFlagFilterUi(trigger);

  trigger.addEventListener('mouseenter', () => {
    trigger.style.background = 'rgba(29, 155, 240, 0.15)';
    trigger.style.color = '#1d9bf0';
  });
  trigger.addEventListener('mouseleave', () => {
    if (wrapper.querySelector('.flag-filter-menu-panel')?.dataset.open === 'true') {
      return;
    }
    trigger.style.background = 'rgba(255, 255, 255, 0.12)';
    trigger.style.color = '#536471';
  });

  const panel = document.createElement('div');
  panel.className = 'flag-filter-menu-panel';
  panel.style.display = 'none';
  panel.style.position = 'absolute';
  panel.style.top = 'calc(100% + 6px)';
  panel.style.right = '0';
  panel.style.zIndex = '1000';
  panel.style.minWidth = '220px';
  panel.style.maxWidth = '260px';
  panel.style.background = '#0f1419';
  panel.style.color = '#f7f9f9';
  panel.style.borderRadius = '12px';
  panel.style.padding = '12px';
  panel.style.boxShadow = '0 12px 24px rgba(15, 20, 25, 0.35)';
  panel.style.maxHeight = '320px';
  panel.style.overflowY = 'auto';
  panel.dataset.open = 'false';
  markFlagFilterUi(panel);

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenuPanel(wrapper);
  });

  wrapper.appendChild(trigger);
  wrapper.appendChild(panel);
  nameContainer.insertBefore(wrapper, nameContainer.firstChild);

  attachMenuDismissListener();

  return wrapper;
}

function renderUserMenuPanel(wrapper, handle) {
  handle = sanitizeHandle(handle);
  if (!wrapper || !handle) {
    return;
  }

  const panel = wrapper.querySelector('.flag-filter-menu-panel');
  if (!panel) {
    return;
  }

  const stats = getUserStats(handle);
  const isBlocked = state.blockedUsers.has(handle);
  const score = computeUserScore(stats, isBlocked);

  panel.innerHTML = '';

  const title = document.createElement('div');
  title.textContent = `@${handle}`;
  title.style.fontWeight = '600';
  title.style.fontSize = '13px';
  markFlagFilterUi(title);
  panel.appendChild(title);

  const scoreRow = document.createElement('div');
  scoreRow.textContent = `Score: ${score}`;
  scoreRow.style.marginTop = '6px';
  scoreRow.style.fontSize = '12px';
  markFlagFilterUi(scoreRow);
  panel.appendChild(scoreRow);

  if (stats.flagMatches > 0) {
    const flagRow = document.createElement('div');
    flagRow.style.fontSize = '12px';
    flagRow.style.marginTop = '6px';
    const flagsSummary = stats.flags.size ? ` (${formatFlagsList(stats.flags)})` : '';
    flagRow.textContent = `Flag matches: ${stats.flagMatches}${flagsSummary}`;
    markFlagFilterUi(flagRow);
    panel.appendChild(flagRow);
  }

  if (stats.manualBlocks > 0) {
    const manualRow = document.createElement('div');
    manualRow.style.fontSize = '12px';
    manualRow.style.marginTop = '4px';
    manualRow.textContent = `Manual blocks: ${stats.manualBlocks}`;
    markFlagFilterUi(manualRow);
    panel.appendChild(manualRow);
  }

  const statusRow = document.createElement('div');
  statusRow.style.marginTop = '8px';
  statusRow.style.fontSize = '12px';
  statusRow.style.color = isBlocked ? '#f91880' : '#36c5f0';
  statusRow.textContent = isBlocked ? 'Status: blocked' : 'Status: allowed';
  markFlagFilterUi(statusRow);
  panel.appendChild(statusRow);

  const actionButton = document.createElement('button');
  actionButton.type = 'button';
  actionButton.textContent = isBlocked ? 'Unblock user' : 'Block user';
  actionButton.style.marginTop = '10px';
  actionButton.style.width = '100%';
  actionButton.style.padding = '6px 0';
  actionButton.style.border = 'none';
  actionButton.style.borderRadius = '999px';
  actionButton.style.fontSize = '12px';
  actionButton.style.fontWeight = '600';
  actionButton.style.cursor = 'pointer';
  actionButton.style.background = isBlocked ? '#536471' : '#f4212e';
  actionButton.style.color = '#ffffff';
  markFlagFilterUi(actionButton);
  actionButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setUserBlocked(handle, !isBlocked);
    closeAllMenus();
  });
  panel.appendChild(actionButton);

  const divider = document.createElement('div');
  divider.style.margin = '12px 0 8px';
  divider.style.height = '1px';
  divider.style.background = 'rgba(255, 255, 255, 0.15)';
  markFlagFilterUi(divider);
  panel.appendChild(divider);

  const nicknameLabel = document.createElement('label');
  nicknameLabel.textContent = 'Nickname';
  nicknameLabel.style.display = 'block';
  nicknameLabel.style.fontSize = '12px';
  nicknameLabel.style.marginBottom = '4px';
  markFlagFilterUi(nicknameLabel);
  panel.appendChild(nicknameLabel);

  const nicknameInput = document.createElement('input');
  nicknameInput.type = 'text';
  nicknameInput.value = stats.nickname || '';
  nicknameInput.placeholder = 'Add nickname';
  nicknameInput.maxLength = 40;
  nicknameInput.style.width = '100%';
  nicknameInput.style.padding = '6px 8px';
  nicknameInput.style.borderRadius = '6px';
  nicknameInput.style.border = '1px solid rgba(255,255,255,0.2)';
  nicknameInput.style.background = 'rgba(255,255,255,0.1)';
  nicknameInput.style.color = '#f7f9f9';
  nicknameInput.style.fontSize = '12px';
  markFlagFilterUi(nicknameInput);
  panel.appendChild(nicknameInput);

  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'Notes';
  noteLabel.style.display = 'block';
  noteLabel.style.fontSize = '12px';
  noteLabel.style.margin = '10px 0 4px';
  markFlagFilterUi(noteLabel);
  panel.appendChild(noteLabel);

  const noteArea = document.createElement('textarea');
  noteArea.value = stats.note || '';
  noteArea.placeholder = 'Add context or reminders…';
  noteArea.rows = 3;
  noteArea.maxLength = 500;
  noteArea.style.width = '100%';
  noteArea.style.padding = '6px 8px';
  noteArea.style.borderRadius = '6px';
  noteArea.style.border = '1px solid rgba(255,255,255,0.2)';
  noteArea.style.background = 'rgba(255,255,255,0.1)';
  noteArea.style.color = '#f7f9f9';
  noteArea.style.fontSize = '12px';
  markFlagFilterUi(noteArea);
  panel.appendChild(noteArea);

  const saveNoteButton = document.createElement('button');
  saveNoteButton.type = 'button';
  saveNoteButton.textContent = 'Save note & nickname';
  saveNoteButton.style.marginTop = '10px';
  saveNoteButton.style.width = '100%';
  saveNoteButton.style.padding = '6px 0';
  saveNoteButton.style.border = 'none';
  saveNoteButton.style.borderRadius = '999px';
  saveNoteButton.style.fontSize = '12px';
  saveNoteButton.style.fontWeight = '600';
  saveNoteButton.style.cursor = 'pointer';
  saveNoteButton.style.background = '#1d9bf0';
  saveNoteButton.style.color = '#ffffff';
  markFlagFilterUi(saveNoteButton);
  panel.appendChild(saveNoteButton);

  saveNoteButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    updateUserAnnotations(handle, nicknameInput.value.trim(), noteArea.value.trim());
    renderUserMenuPanel(wrapper, handle);
  });
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

function updateUserMenuForHandle(tweetCell, handle) {
  if (!tweetCell || !handle) {
    return;
  }

  const wrapper = tweetCell.querySelector('.flag-filter-menu');
  if (wrapper) {
    wrapper.dataset.handle = handle;
    renderUserMenuPanel(wrapper, handle);
  }
}

function refreshAllUserMenus() {
  document.querySelectorAll('.flag-filter-menu').forEach((wrapper) => {
    const handle = wrapper.dataset.handle;
    if (handle) {
      renderUserMenuPanel(wrapper, handle);
    }
  });
}

function toggleMenuPanel(wrapper) {
  if (!wrapper) {
    return;
  }

  const panel = wrapper.querySelector('.flag-filter-menu-panel');
  const trigger = wrapper.querySelector('.flag-filter-menu-trigger');
  if (!panel) {
    return;
  }

  const isOpen = panel.dataset.open === 'true';
  closeAllMenus();

  if (isOpen) {
    panel.dataset.open = 'false';
    panel.style.display = 'none';
    if (trigger) {
      trigger.style.background = 'rgba(255, 255, 255, 0.12)';
      trigger.style.color = '#536471';
    }
  } else {
    panel.dataset.open = 'true';
    panel.style.display = 'block';
    if (trigger) {
      trigger.style.background = 'rgba(29, 155, 240, 0.15)';
      trigger.style.color = '#1d9bf0';
    }
    positionMenuPanel(wrapper, panel);
  }
}

function closeAllMenus() {
  document.querySelectorAll('.flag-filter-menu-panel').forEach((panel) => {
    panel.dataset.open = 'false';
    panel.style.display = 'none';
    panel.style.left = 'auto';
    panel.style.right = '0';
    const wrapper = panel.parentElement;
    if (wrapper && wrapper.classList.contains('flag-filter-menu')) {
      const trigger = wrapper.querySelector('.flag-filter-menu-trigger');
      if (trigger) {
        trigger.style.background = 'rgba(255, 255, 255, 0.12)';
        trigger.style.color = '#536471';
      }
    }
  });
}

function positionMenuPanel(wrapper, panel) {
  if (!wrapper || !panel) {
    return;
  }

  panel.style.right = '0';
  panel.style.left = 'auto';

  const rect = panel.getBoundingClientRect();
  const viewportWidth = window.innerWidth;

  if (rect.right > viewportWidth - 8) {
    const overflow = rect.right - (viewportWidth - 8);
    panel.style.right = `${overflow}px`;
  }

  const rectAfterRight = panel.getBoundingClientRect();
  if (rectAfterRight.left < 8) {
    panel.style.right = 'auto';
    panel.style.left = `${Math.max(0, 8 - rectAfterRight.left)}px`;
  }
}

function markFlagFilterUi(element) {
  if (!element || typeof element.setAttribute !== 'function') {
    return;
  }
  element.setAttribute(FLAG_FILTER_UI_ATTR, 'true');
}

function isFlagFilterUiElement(element) {
  return !!element && element.getAttribute && element.getAttribute(FLAG_FILTER_UI_ATTR) === 'true';
}

function isFlagFilterUiNode(node) {
  if (!node) {
    return false;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = /** @type {HTMLElement} */ (node);
    if (isFlagFilterUiElement(element)) {
      return true;
    }
    if (element.closest && element.closest(`[${FLAG_FILTER_UI_ATTR}="true"]`)) {
      return true;
    }
  }

  if (node.parentElement && node.parentElement.closest(`[${FLAG_FILTER_UI_ATTR}="true"]`)) {
    return true;
  }

  return false;
}

function attachMenuDismissListener() {
  if (menuDismissListenerAttached) {
    return;
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.flag-filter-menu')) {
      return;
    }
    closeAllMenus();
  });

  menuDismissListenerAttached = true;
}

function setUserBlocked(handle, shouldBlock) {
  handle = sanitizeHandle(handle);
  if (!handle) {
    return;
  }

  const nextBlocked = new Set(state.blockedUsers);
  let changed = false;

  if (shouldBlock) {
    if (!nextBlocked.has(handle)) {
      nextBlocked.add(handle);
      changed = true;
      recordManualBlock(handle);
    }
  } else if (nextBlocked.has(handle)) {
    nextBlocked.delete(handle);
    changed = true;
  }

  if (!changed) {
    return;
  }

  state.blockedUsers = nextBlocked;

  chrome.storage.sync.set({
    [SETTINGS_KEY.BLOCKED_USERS]: Array.from(nextBlocked)
  });

  refreshAllUserMenus();

  if (shouldBlock) {
    filterExistingArticles();
  }
}

function persistUserStats() {
  chrome.storage.sync.set({
    [SETTINGS_KEY.USER_STATS]: serializeUserStatsMap(state.userStats)
  });
}

function serializeUserStatsMap(map) {
  const output = {};
  for (const [handle, stats] of map.entries()) {
    output[handle] = {
      flagMatches: stats.flagMatches || 0,
      manualBlocks: stats.manualBlocks || 0,
      flags: Array.from(stats.flags instanceof Set ? stats.flags : stats.flags || []),
      note: stats.note || '',
      nickname: stats.nickname || ''
    };
  }
  return output;
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
