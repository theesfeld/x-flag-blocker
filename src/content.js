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
    updated.forEach((handle) => refreshBlockedPanels(handle));
  }

  if (changes[SETTINGS_KEY.USER_STATS]) {
    const updatedStats = changes[SETTINGS_KEY.USER_STATS].newValue || {};
    state.userStats = toUserStatsMap(updatedStats);
    Object.keys(updatedStats || {}).forEach((handle) => {
      refreshNicknameForHandle(handle);
      refreshBlockedPanels(handle);
    });
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
    article.removeAttribute(PROCESSED_ATTR);
  }
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

  if (handle && state.blockedUsers.has(handle)) {
    maskArticle(article, new Set(), handle);
    article.setAttribute(PROCESSED_ATTR, 'blocked');
    return;
  }

  if (state.selectedFlags.size === 0) {
    clearBlockedAppearance(tweetCell, article);
    article.setAttribute(PROCESSED_ATTR, 'checked');
    ensureControlButton(article, tweetCell, handle);
    applyNickname(article, handle);
    syncPanelIfNeeded(article, tweetCell, handle);
    return;
  }

  const displayNames = extractDisplayNames(article);
  if (displayNames.length === 0) {
    article.removeAttribute(PROCESSED_ATTR);
    clearBlockedAppearance(tweetCell, article);
    ensureControlButton(article, tweetCell, handle);
    applyNickname(article, handle);
    syncPanelIfNeeded(article, tweetCell, handle);
    return;
  }

  const matchedFlags = collectBlockedFlags(displayNames);
  if (matchedFlags.size > 0) {
    handleMatch(article, matchedFlags, handle);
    article.setAttribute(PROCESSED_ATTR, 'blocked');
    ensureControlButton(article, tweetCell, handle);
    syncPanelIfNeeded(article, tweetCell, handle);
    return;
  }

  article.setAttribute(PROCESSED_ATTR, 'checked');
  clearBlockedAppearance(tweetCell, article);
  ensureControlButton(article, tweetCell, handle);
  applyNickname(article, handle);
  syncPanelIfNeeded(article, tweetCell, handle);
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
      applied = maskArticle(article, matchedFlags, handle);
      break;
    case HANDLING_MODE.BLOCK:
      applied = attemptBlock(article, matchedFlags, handle);
      break;
  }

  if (applied) {
    incrementBlockCounts(matchedFlags);
    if (handle) {
      recordFlagMatch(handle, matchedFlags);
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

function attemptBlock(article, matchedFlags, handle = '') {
  // Placeholder for a future implementation that would automate the block workflow.
  return maskArticle(article, matchedFlags, handle);
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

function maskArticle(article, matchedFlags, handle = '') {
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
  if (!tweetCell.dataset.flagFilterExposed) {
    tweetCell.dataset.flagFilterExposed = 'false';
  }
  tweetCell.style.opacity = '0.45';
  tweetCell.style.border = '2px solid #003153';
  tweetCell.style.borderRadius = '12px';
  tweetCell.style.background = '#003153';

  replaceAvatarWithBlockedFlag(tweetCell, primaryFlag);
  updateBlockedUserName(article);
  blankTweetBody(article);
  hideTweetMedia(article);

  const effectiveHandle = sanitizeHandle(handle || article?.dataset?.flagFilterHandle || tweetCell?.dataset?.flagFilterHandle || '');
  applyNickname(article, effectiveHandle);
  ensureControlButton(article, tweetCell, effectiveHandle);
  setPanelExposure(article, tweetCell, effectiveHandle, tweetCell.dataset.flagFilterExposed === 'true');

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
    if (!node.dataset.flagFilterOriginalDisplay) {
      node.dataset.flagFilterOriginalDisplay = node.style.display || '';
    }
    node.innerHTML = '';
    node.style.display = 'none';
  });
}

function hideTweetMedia(article) {
  const mediaNodes = article.querySelectorAll(
    'img, video, div[data-testid="tweetPhoto"], div[data-testid="videoPlayer"], div[data-testid="card.wrapper"], div[data-testid="tweet"]'
  );

  mediaNodes.forEach((node) => {
    if (node.closest('div[data-testid="Tweet-User-Avatar"]')) {
      return;
    }
    if (isFlagFilterUiElement(node) || (node.closest && node.closest(`[${FLAG_FILTER_UI_ATTR}="true"]`))) {
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

function clearBlockedAppearance(tweetCell, article) {
  if (!tweetCell || tweetCell.getAttribute('data-flag-filter-blocked') !== 'true') {
    return;
  }

  restoreAvatar(tweetCell);
  restoreUserName(article);
  restoreTweetBody(article);
  restoreTweetMedia(article);
  showOriginalBody(article);

  tweetCell.style.opacity = '';
  tweetCell.style.border = '';
  tweetCell.style.borderRadius = '';
  tweetCell.style.background = '';
  tweetCell.removeAttribute('data-flag-filter-blocked');
  delete tweetCell.dataset.flagFilterExposed;

  const panel = tweetCell.querySelector('.flag-filter-panel');
  if (panel) {
    panel.remove();
  }
}

function ensureControlButton(article, tweetCell, handle) {
  if (!tweetCell || !article) {
    return;
  }

  const sanitizedHandle = sanitizeHandle(handle || article.dataset.flagFilterHandle || tweetCell.dataset.flagFilterHandle || '');
  let toggleButton = article.querySelector('.flag-filter-toggle');
  if (!toggleButton) {
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'flag-filter-toggle';
    toggleButton.style.border = '1px solid transparent';
    toggleButton.style.background = 'transparent';
    toggleButton.style.color = '#536471';
    toggleButton.style.fontSize = '11px';
    toggleButton.style.fontWeight = '600';
    toggleButton.style.padding = '0 4px';
    toggleButton.style.cursor = 'pointer';
    toggleButton.style.display = 'inline-flex';
    toggleButton.style.alignItems = 'center';
    toggleButton.style.justifyContent = 'center';
    toggleButton.style.gap = '2px';
    toggleButton.style.position = 'absolute';
    toggleButton.style.top = '4px';
    toggleButton.style.right = '8px';
    toggleButton.style.zIndex = '3';
    toggleButton.style.backgroundClip = 'padding-box';
    toggleButton.style.borderRadius = '999px';
    markFlagFilterUi(toggleButton);
    article.appendChild(toggleButton);
  }

  const exposed = tweetCell.dataset.flagFilterExposed === 'true';
  toggleButton.textContent = exposed ? '×' : '⚑';
  toggleButton.title = exposed ? 'Close Flag Panel' : 'Open Flag Panel';
  toggleButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextState = !(tweetCell.dataset.flagFilterExposed === 'true');
    setPanelExposure(article, tweetCell, sanitizedHandle, nextState);
    toggleButton.textContent = nextState ? '×' : '⚑';
    toggleButton.title = nextState ? 'Close Flag Panel' : 'Open Flag Panel';
  };
}

function getBodyNodes(article) {
  return article.querySelectorAll(
    'div[data-testid="tweetText"], div[data-testid="tweetTextInline"], div[data-testid="tweetPhoto"], div[data-testid="card.wrapper"], div[data-testid="videoPlayer"], div[data-testid="tweet"], img:not([data-flag-filter-ui="true"]), video:not([data-flag-filter-ui="true"])'
  );
}

function hideOriginalBodyForPanel(article) {
  const bodyNodes = getBodyNodes(article);
  bodyNodes.forEach((node) => {
    if (isFlagFilterUiElement(node) || node.closest(`[${FLAG_FILTER_UI_ATTR}="true"]`)) {
      return;
    }
    if (node.closest && node.closest('div[data-testid="Tweet-User-Avatar"]')) {
      return;
    }
    if (!node.dataset.flagFilterPanelHidden) {
      node.dataset.flagFilterPanelHidden = 'true';
      node.dataset.flagFilterPanelDisplay = node.style.display || '';
    }
    node.style.display = 'none';
  });
}

function showOriginalBody(article) {
  article.querySelectorAll('[data-flag-filter-panel-hidden="true"]').forEach((node) => {
    const original = node.dataset.flagFilterPanelDisplay || '';
    node.style.display = original;
    delete node.dataset.flagFilterPanelHidden;
    delete node.dataset.flagFilterPanelDisplay;
  });
}

function syncPanelIfNeeded(article, tweetCell, handle) {
  if (!tweetCell || tweetCell.dataset.flagFilterExposed !== 'true') {
    return;
  }

  const sanitizedHandle = sanitizeHandle(handle || article.dataset.flagFilterHandle || tweetCell.dataset.flagFilterHandle || '');

  if (tweetCell.getAttribute('data-flag-filter-blocked') === 'true') {
    renderInlinePanel(article, tweetCell, sanitizedHandle);
  } else {
    hideOriginalBodyForPanel(article);
    renderInlinePanel(article, tweetCell, sanitizedHandle);
  }
}

function setPanelExposure(article, tweetCell, handle, exposed) {
  if (!tweetCell || !article) {
    return;
  }

  const sanitizedHandle = sanitizeHandle(handle || article.dataset.flagFilterHandle || tweetCell.dataset.flagFilterHandle || '');
  tweetCell.dataset.flagFilterExposed = exposed ? 'true' : 'false';

  if (exposed) {
    if (tweetCell.getAttribute('data-flag-filter-blocked') === 'true') {
      // Blocked tweets already have blank content; leave as-is.
    } else {
      hideOriginalBodyForPanel(article);
    }
    renderInlinePanel(article, tweetCell, sanitizedHandle);
  } else {
    const panel = article.querySelector('.flag-filter-panel');
    if (panel) {
      panel.remove();
    }

    showOriginalBody(article);

    if (tweetCell.getAttribute('data-flag-filter-blocked') === 'true') {
      blankTweetBody(article);
      hideTweetMedia(article);
      tweetCell.style.opacity = '0.45';
      tweetCell.style.border = '2px solid #003153';
      tweetCell.style.borderRadius = '12px';
      tweetCell.style.background = '#003153';
    }
  }

  ensureControlButton(article, tweetCell, sanitizedHandle);
}

function renderInlinePanel(article, tweetCell, handle) {
  const sanitizedHandle = sanitizeHandle(handle);
  const isBlocked = tweetCell.getAttribute('data-flag-filter-blocked') === 'true';
  const flagsLabel = tweetCell.dataset.flagFilterFlags || '';
  const stats = getUserStats(sanitizedHandle);

  let panel = article.querySelector('.flag-filter-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'flag-filter-panel';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '8px';
    panel.style.padding = '12px';
    panel.style.margin = '6px 0';
    panel.style.background = 'rgba(15, 20, 25, 0.9)';
    panel.style.color = '#f7f9f9';
    panel.style.borderRadius = '12px';
    panel.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    panel.style.backdropFilter = 'blur(6px)';
    panel.style.position = 'relative';
    panel.style.zIndex = '2';
    markFlagFilterUi(panel);
    const controlBar = article.querySelector('.flag-filter-control-bar');
    if (controlBar && controlBar.nextSibling) {
      article.insertBefore(panel, controlBar.nextSibling);
    } else if (controlBar) {
      article.appendChild(panel);
    } else if (article.firstChild) {
      article.insertBefore(panel, article.firstChild);
    } else {
      article.appendChild(panel);
    }
  }

  panel.innerHTML = '';

  const title = document.createElement('div');
  title.textContent = sanitizedHandle ? `@${sanitizedHandle}` : 'Flag Blocker';
  title.style.fontWeight = '600';
  title.style.fontSize = '14px';
  markFlagFilterUi(title);
  panel.appendChild(title);

  if (stats.nickname) {
    const nicknameLine = document.createElement('div');
    nicknameLine.textContent = `Nickname: ${stats.nickname}`;
    nicknameLine.style.fontSize = '12px';
    nicknameLine.style.color = '#1d9bf0';
    markFlagFilterUi(nicknameLine);
    panel.appendChild(nicknameLine);
  }

  const scoreLine = document.createElement('div');
  scoreLine.textContent = `Score: ${computeUserScore(stats, isBlocked)}`;
  scoreLine.style.fontSize = '12px';
  markFlagFilterUi(scoreLine);
  panel.appendChild(scoreLine);

  const statusLine = document.createElement('div');
  statusLine.textContent = isBlocked ? 'Status: blocked' : 'Status: allowed';
  statusLine.style.fontSize = '12px';
  statusLine.style.color = isBlocked ? '#f91880' : '#36c5f0';
  markFlagFilterUi(statusLine);
  panel.appendChild(statusLine);

  if (flagsLabel) {
    const flagsLine = document.createElement('div');
    flagsLine.textContent = `Blocked flags: ${flagsLabel}`;
    flagsLine.style.fontSize = '12px';
    markFlagFilterUi(flagsLine);
    panel.appendChild(flagsLine);
  } else if (isBlocked) {
    const manualLine = document.createElement('div');
    manualLine.textContent = 'Blocked manually';
    manualLine.style.fontSize = '12px';
    markFlagFilterUi(manualLine);
    panel.appendChild(manualLine);
  }

  if (stats.flagMatches > 0) {
    const historyLine = document.createElement('div');
    historyLine.textContent = `Flag matches recorded: ${stats.flagMatches}${stats.flags.size ? ` (${formatFlagsList(stats.flags)})` : ''}`;
    historyLine.style.fontSize = '12px';
    markFlagFilterUi(historyLine);
    panel.appendChild(historyLine);
  }

  const actionsRow = document.createElement('div');
  actionsRow.style.display = 'flex';
  actionsRow.style.flexWrap = 'wrap';
  actionsRow.style.gap = '8px';
  markFlagFilterUi(actionsRow);
  panel.appendChild(actionsRow);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close Panel';
  closeButton.style.padding = '6px 12px';
  closeButton.style.border = 'none';
  closeButton.style.borderRadius = '999px';
  closeButton.style.fontSize = '12px';
  closeButton.style.fontWeight = '600';
  closeButton.style.cursor = 'pointer';
  closeButton.style.background = '#536471';
  closeButton.style.color = '#ffffff';
  markFlagFilterUi(closeButton);
  closeButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPanelExposure(article, tweetCell, sanitizedHandle, false);
  });
  actionsRow.appendChild(closeButton);

  if (sanitizedHandle) {
    const blockButton = document.createElement('button');
    blockButton.type = 'button';
    blockButton.textContent = isBlocked ? 'Unblock user' : 'Block user';
    blockButton.style.padding = '6px 12px';
    blockButton.style.border = 'none';
    blockButton.style.borderRadius = '999px';
    blockButton.style.fontSize = '12px';
    blockButton.style.fontWeight = '600';
    blockButton.style.cursor = 'pointer';
    blockButton.style.background = isBlocked ? '#536471' : '#f4212e';
    blockButton.style.color = '#ffffff';
    markFlagFilterUi(blockButton);
    blockButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setUserBlocked(sanitizedHandle, !isBlocked);
    });
    actionsRow.appendChild(blockButton);
  }

  if (sanitizedHandle) {
    const annotationForm = document.createElement('div');
    annotationForm.style.display = 'flex';
    annotationForm.style.flexDirection = 'column';
    annotationForm.style.gap = '6px';
    markFlagFilterUi(annotationForm);
    panel.appendChild(annotationForm);

    const nicknameLabel = document.createElement('label');
    nicknameLabel.textContent = 'Nickname';
    nicknameLabel.style.fontSize = '12px';
    markFlagFilterUi(nicknameLabel);
    annotationForm.appendChild(nicknameLabel);

    const nicknameInput = document.createElement('input');
    nicknameInput.type = 'text';
    nicknameInput.value = stats.nickname || '';
    nicknameInput.placeholder = 'Add nickname';
    nicknameInput.maxLength = 40;
    nicknameInput.style.width = '100%';
    nicknameInput.style.padding = '6px 8px';
    nicknameInput.style.borderRadius = '6px';
    nicknameInput.style.border = '1px solid rgba(255,255,255,0.2)';
    nicknameInput.style.background = 'rgba(255,255,255,0.12)';
    nicknameInput.style.color = '#f7f9f9';
    nicknameInput.style.fontSize = '12px';
    markFlagFilterUi(nicknameInput);
    annotationForm.appendChild(nicknameInput);

    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Notes';
    noteLabel.style.fontSize = '12px';
    markFlagFilterUi(noteLabel);
    annotationForm.appendChild(noteLabel);

    const noteArea = document.createElement('textarea');
    noteArea.value = stats.note || '';
    noteArea.placeholder = 'Add context or reminders…';
    noteArea.rows = 3;
    noteArea.maxLength = 500;
    noteArea.style.width = '100%';
    noteArea.style.padding = '6px 8px';
    noteArea.style.borderRadius = '6px';
    noteArea.style.border = '1px solid rgba(255,255,255,0.2)';
    noteArea.style.background = 'rgba(255,255,255,0.12)';
    noteArea.style.color = '#f7f9f9';
    noteArea.style.fontSize = '12px';
    markFlagFilterUi(noteArea);
    annotationForm.appendChild(noteArea);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'Save note & nickname';
    saveButton.style.alignSelf = 'flex-start';
    saveButton.style.padding = '6px 12px';
    saveButton.style.border = 'none';
    saveButton.style.borderRadius = '999px';
    saveButton.style.fontSize = '12px';
    saveButton.style.fontWeight = '600';
    saveButton.style.cursor = 'pointer';
    saveButton.style.background = '#1d9bf0';
    saveButton.style.color = '#ffffff';
    markFlagFilterUi(saveButton);
    saveButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      updateUserAnnotations(sanitizedHandle, nicknameInput.value.trim(), noteArea.value.trim());
      renderInlinePanel(article, tweetCell, sanitizedHandle);
    });
    annotationForm.appendChild(saveButton);
  }
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
      node.style.display = node.dataset.flagFilterOriginalDisplay || '';
    }
    delete node.dataset.flagFilterOriginalDisplay;
    const placeholder = node.querySelector('.flag-filter-blank');
    if (placeholder) {
      placeholder.remove();
    }
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
  refreshBlockedPanels(handle);
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

function refreshBlockedPanels(handle) {
  const sanitizedHandle = sanitizeHandle(handle);
  if (!sanitizedHandle) {
    return;
  }

  document.querySelectorAll(`${ARTICLE_SELECTOR}[data-flag-filter-handle="${sanitizedHandle}"]`).forEach((article) => {
    const tweetCell = getTweetCell(article);
    if (!tweetCell) {
      return;
    }
    const exposed = tweetCell.dataset.flagFilterExposed === 'true';
    if (exposed) {
      if (tweetCell.getAttribute('data-flag-filter-blocked') === 'true') {
        renderInlinePanel(article, tweetCell, sanitizedHandle);
      } else {
        hideOriginalBodyForPanel(article);
        renderInlinePanel(article, tweetCell, sanitizedHandle);
      }
    } else if (tweetCell.getAttribute('data-flag-filter-blocked') === 'true') {
      blankTweetBody(article);
      hideTweetMedia(article);
      tweetCell.style.opacity = '0.45';
      tweetCell.style.border = '2px solid #003153';
      tweetCell.style.borderRadius = '12px';
      tweetCell.style.background = '#003153';
    }
    ensureControlButton(article, tweetCell, sanitizedHandle);
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

  filterExistingArticles();

  refreshBlockedPanels(handle);
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
