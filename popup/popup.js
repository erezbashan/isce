// popup/popup.js
// GUI layer for extension popup: renders state and delegates search/sync/mutations to background service worker.

let popupState = {
  activeTabId: null,
  activeTabUrl: '',
  version: '1.0.3',
  siteCheck: null,
  searchResult: { totalMatches: 0, items: [] },
  whitelist: [],
  customEntries: [],
  heuristicMatches: {},
  lastUpdated: 0,
  syncStats: {}
};

function formatDateTimeHe(timestamp) {
  if (!timestamp || timestamp <= 0) return 'טרם סונכרן מהרשת (משתמש במאגר מובנה)';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString('he-IL');
  }
}

async function notifyActiveTabToRecheck() {
  if (!popupState.activeTabId) return;
  try {
    await chrome.tabs.sendMessage(popupState.activeTabId, { type: 'RECHECK_CURRENT_PAGE' });
  } catch {
    // Content script might not be injected on chrome:// or restricted pages
  }
}

function renderCurrentSiteTab() {
  const container = document.getElementById('current-site-container');
  container.innerHTML = '';

  const check = popupState.siteCheck;
  if (!check || !check.hostname) {
    const empty = document.createElement('div');
    empty.className = 'detail-row';
    empty.textContent = 'עמוד זה אינו אתר אינטרנט רגיל (למשל עמוד פנימי של הדפדפן).';
    container.appendChild(empty);
    return;
  }

  const domainHeader = document.createElement('div');
  domainHeader.className = 'domain-header';
  const domainLabel = document.createElement('span');
  domainLabel.textContent = 'דומיין נוכחי:';
  const domainCode = document.createElement('span');
  domainCode.className = 'domain-code';
  domainCode.textContent = check.hostname;
  domainHeader.append(domainLabel, domainCode);
  container.appendChild(domainHeader);

  if (check.whitelisted) {
    const banner = document.createElement('div');
    banner.className = 'status-banner whitelisted';
    banner.textContent = '✓ האתר מוחרג (ברשימת ההתעלמות שלך)';
    container.appendChild(banner);

    const btnUnwhitelist = document.createElement('button');
    btnUnwhitelist.type = 'button';
    btnUnwhitelist.className = 'btn full-width';
    btnUnwhitelist.textContent = 'בטל החרגה והחזר התראות לאתר זה';
    btnUnwhitelist.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'REMOVE_FROM_WHITELIST',
        domain: check.matchedDomain || check.hostname
      });
      await loadPopupData();
      await notifyActiveTabToRecheck();
    });
    container.appendChild(btnUnwhitelist);
    return;
  }

  if (check.matched && check.match) {
    const m = check.match;
    const isHeuristic = m.matchType === 'heuristic';

    const banner = document.createElement('div');
    banner.className = `status-banner ${isHeuristic ? 'heuristic' : 'matched'}`;
    banner.textContent = isHeuristic
      ? '⚠️ זוהתה כתובת / סניף ביהודה ושומרון באתר זה'
      : '⚠️ עסק זה מתועד כפועל ביהודה ושומרון';
    container.appendChild(banner);

    const nameRow = document.createElement('div');
    nameRow.className = 'detail-row';
    const displayName = m.nameEn && m.nameEn !== m.nameHe ? `${m.nameHe} (${m.nameEn})` : m.nameHe;
    nameRow.innerHTML = `<span class="detail-label">שם העסק: </span><strong></strong>`;
    nameRow.querySelector('strong').textContent = displayName;
    container.appendChild(nameRow);

    const catRow = document.createElement('div');
    catRow.className = 'detail-row';
    catRow.innerHTML = `<span class="detail-label">קטגוריה: </span><span></span>`;
    catRow.querySelectorAll('span')[1].textContent = m.category || 'עסק מסחרי';
    container.appendChild(catRow);

    const locRow = document.createElement('div');
    locRow.className = 'detail-row';
    locRow.innerHTML = `<span class="detail-label">מיקומים מתועדים: </span><span class="locations-highlight"></span>`;
    locRow.querySelector('.locations-highlight').textContent = m.locations || 'יהודה ושומרון';
    container.appendChild(locRow);

    const descRow = document.createElement('div');
    descRow.className = 'detail-row';
    descRow.textContent = m.detailsHe || '';
    container.appendChild(descRow);

    const srcRow = document.createElement('div');
    srcRow.className = 'detail-row';
    srcRow.innerHTML = `<span class="detail-label">מקור: </span><span></span>`;
    srcRow.querySelectorAll('span')[1].textContent = (m.sources || []).join(', ');
    container.appendChild(srcRow);

    const btnWhitelist = document.createElement('button');
    btnWhitelist.type = 'button';
    btnWhitelist.className = 'btn full-width';
    btnWhitelist.textContent = 'אל תתריע שוב באתר זה (הוסף להחרגות)';
    btnWhitelist.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'ADD_TO_WHITELIST',
        domain: m.matchedDomain || check.hostname
      });
      await loadPopupData();
      await notifyActiveTabToRecheck();
    });
    container.appendChild(btnWhitelist);
    return;
  }

  const safeBanner = document.createElement('div');
  safeBanner.className = 'status-banner safe';
  safeBanner.textContent = '✓ לא נמצאה פעילות מתועדת ביהודה ושומרון';
  container.appendChild(safeBanner);

  const info = document.createElement('div');
  info.className = 'detail-row';
  info.textContent =
    'האתר אינו מופיע במאגר הפומבי ולא זוהו סניפים ביהודה ושומרון בסריקת האתר.';
  container.appendChild(info);

  const btnQuickFlag = document.createElement('button');
  btnQuickFlag.type = 'button';
  btnQuickFlag.className = 'btn btn-danger full-width';
  btnQuickFlag.textContent = `➕ הוסף את ${check.hostname} לרשימת ההתראות`;
  btnQuickFlag.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      type: 'ADD_CUSTOM_DOMAIN',
      domain: check.hostname,
      nameHe: check.hostname,
      locations: 'יהודה ושומרון',
      detailsHe: 'נוסף ידנית דרך חלונית התוסף.'
    });
    await loadPopupData();
    await notifyActiveTabToRecheck();
  });
  container.appendChild(btnQuickFlag);
}

function renderSearchResultsFromState() {
  const listEl = document.getElementById('search-results-list');
  const countLabel = document.getElementById('search-count-label');
  listEl.innerHTML = '';

  const items = popupState.searchResult?.items || [];
  const totalMatches = popupState.searchResult?.totalMatches ?? items.length;

  countLabel.textContent = `מציג ${items.length} מתוך ${totalMatches} תוצאות`;

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'company-item';

    const top = document.createElement('div');
    top.className = 'company-item-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'company-item-name';
    nameSpan.textContent =
      item.nameEn && item.nameEn !== item.nameHe
        ? `${item.nameHe} (${item.nameEn})`
        : item.nameHe;

    const catSpan = document.createElement('span');
    catSpan.className = 'company-item-cat';
    catSpan.textContent = item.category || 'עסק';

    top.append(nameSpan, catSpan);

    const domainsDiv = document.createElement('div');
    domainsDiv.className = 'company-item-domains';
    domainsDiv.textContent = (item.domains || []).join(', ');

    const locDiv = document.createElement('div');
    locDiv.className = 'company-item-loc';
    locDiv.textContent = `מיקומים: ${item.locations || 'יהודה ושומרון'}`;

    card.append(top, domainsDiv, locDiv);
    listEl.appendChild(card);
  }
}

function renderManageTab() {
  document.getElementById('stat-companies').textContent = String(
    popupState.syncStats?.totalCompanies || 0
  );
  document.getElementById('stat-domains').textContent = String(
    popupState.syncStats?.totalDomains || 0
  );
  document.getElementById('last-updated-text').textContent = `עודכן לאחרונה: ${formatDateTimeHe(
    popupState.lastUpdated
  )}`;

  const wlContainer = document.getElementById('whitelist-container');
  wlContainer.innerHTML = '';
  const wl = popupState.whitelist || [];
  if (wl.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'אין דומיינים מוחרגים כרגע.';
    wlContainer.appendChild(empty);
  } else {
    for (const domain of wl) {
      const row = document.createElement('div');
      row.className = 'tag-row';
      const span = document.createElement('span');
      span.className = 'domain-code';
      span.textContent = domain;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-remove-btn';
      btn.textContent = 'הסר החרגה ✕';
      btn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'REMOVE_FROM_WHITELIST', domain });
        await loadPopupData();
        await notifyActiveTabToRecheck();
      });
      row.append(span, btn);
      wlContainer.appendChild(row);
    }
  }

  const customContainer = document.getElementById('custom-list-container');
  customContainer.innerHTML = '';
  const customItems = [
    ...(popupState.customEntries || []).map((e) => ({
      domain: e.domain,
      label: `${e.nameHe || e.domain} (ידני)`
    })),
    ...Object.values(popupState.heuristicMatches || {}).map((h) => ({
      domain: h.domain,
      label: `${h.domain} (זיהוי כתובת באתר)`
    }))
  ];

  if (customItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'טרם נוספו אתרים ידנית או מזיהוי אוטומטי.';
    customContainer.appendChild(empty);
  } else {
    for (const item of customItems) {
      const row = document.createElement('div');
      row.className = 'tag-row';
      const span = document.createElement('span');
      span.textContent = item.label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-remove-btn';
      btn.textContent = 'מחק ✕';
      btn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'REMOVE_CUSTOM_DOMAIN',
          domain: item.domain
        });
        await loadPopupData();
        await notifyActiveTabToRecheck();
      });
      row.append(span, btn);
      customContainer.appendChild(row);
    }
  }
}

async function loadPopupData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  popupState.activeTabId = tab?.id || null;
  popupState.activeTabUrl = tab?.url || '';

  const searchInput = document.getElementById('db-search-input');
  const res = await chrome.runtime.sendMessage({
    type: 'GET_POPUP_DATA',
    tabUrl: popupState.activeTabUrl,
    searchQuery: searchInput ? searchInput.value : ''
  });

  if (res?.ok) {
    popupState.version = res.version || '1.0.3';
    popupState.siteCheck = res.siteCheck;
    popupState.searchResult = res.searchResult || { totalMatches: 0, items: [] };
    popupState.whitelist = res.whitelist || [];
    popupState.customEntries = res.customEntries || [];
    popupState.heuristicMatches = res.heuristicMatches || {};
    popupState.lastUpdated = res.lastUpdated || 0;
    popupState.syncStats = res.syncStats || {};
  }

  document.getElementById('ext-version').textContent = `v${popupState.version}`;
  renderCurrentSiteTab();
  renderSearchResultsFromState();
  renderManageTab();
}

document.addEventListener('DOMContentLoaded', async () => {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      tabButtons.forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      tabPanels.forEach((panel) => {
        panel.classList.toggle('active', panel.id === targetId);
      });
    });
  });

  document.getElementById('db-search-input').addEventListener('input', async (e) => {
    const res = await chrome.runtime.sendMessage({
      type: 'SEARCH_DATABASE',
      query: e.target.value
    });
    if (res?.ok) {
      popupState.searchResult = {
        totalMatches: res.totalMatches,
        items: res.items || []
      };
      renderSearchResultsFromState();
    }
  });

  const btnSync = document.getElementById('btn-force-sync');
  const feedbackEl = document.getElementById('sync-feedback');
  btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    btnSync.textContent = '⏳ מסנכרן מול המקורות הפומביים...';
    feedbackEl.textContent = '';

    try {
      const res = await chrome.runtime.sendMessage({ type: 'FORCE_SYNC_DB' });
      await loadPopupData();
      feedbackEl.textContent =
        res?.syncStats?.lastStatus || 'הסנכרון הושלם בהצלחה.';
    } catch {
      feedbackEl.textContent = 'אירעה שגיאה בעת הסנכרון.';
    } finally {
      btnSync.disabled = false;
      btnSync.textContent = '🔄 עדכן מאגר עכשיו מהמקורות הפומביים';
    }
  });

  document.getElementById('form-add-custom').addEventListener('submit', async (e) => {
    e.preventDefault();
    const domainInput = document.getElementById('input-custom-domain');
    const nameInput = document.getElementById('input-custom-name');
    const locInput = document.getElementById('input-custom-locations');

    const domain = domainInput.value.trim();
    if (!domain) return;

    await chrome.runtime.sendMessage({
      type: 'ADD_CUSTOM_DOMAIN',
      domain,
      nameHe: nameInput.value.trim() || domain,
      locations: locInput.value.trim() || 'יהודה ושומרון'
    });

    domainInput.value = '';
    nameInput.value = '';
    locInput.value = '';

    await loadPopupData();
    await notifyActiveTabToRecheck();
  });

  await loadPopupData();
});
