// background/service-worker.js
import {
  normalizeHostname,
  getCandidateDomains,
  buildDomainIndex,
  ensureDatabaseReady,
  triggerBackgroundSyncIfNeeded,
  checkDomainTier1
} from './db-sync.js';
import {
  evaluateTier2InBackend,
  searchDatabaseEntries
} from './analyzer.js';

const ALARM_NAME = 'isce-weekly-db-sync';

/**
 * Updates the action badge for a specific tab.
 */
async function updateTabBadge(tabId, status) {
  if (!tabId || tabId < 0) return;
  try {
    if (status === 'matched') {
      await chrome.action.setBadgeText({ tabId, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#D92D20' });
    } else if (status === 'heuristic') {
      await chrome.action.setBadgeText({ tabId, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#EA580C' });
    } else if (status === 'whitelisted') {
      await chrome.action.setBadgeText({ tabId, text: '✓' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#64748B' });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch {
    // Tab may have been closed before badge update completed
  }
}

/**
 * Checks if a domain was dismissed for the current browser session.
 */
async function isDismissedForSession(hostname) {
  const { dismissedDomains = [] } = await chrome.storage.session.get('dismissedDomains');
  const candidates = getCandidateDomains(hostname);
  const dismissedSet = new Set(dismissedDomains.map(normalizeHostname));
  return candidates.some((c) => dismissedSet.has(c));
}

// 1. Top-level onInstalled listener
chrome.runtime.onInstalled.addListener(async () => {
  await ensureDatabaseReady();
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 720 });
});

// 2. Top-level onAlarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await triggerBackgroundSyncIfNeeded(false);
  }
});

// 3. Top-level tabs.onUpdated listener for instant badge updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
  const url = tab?.url;
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    await updateTabBadge(tabId, 'clear');
    return;
  }

  const result = await checkDomainTier1(url);
  if (result.whitelisted) {
    await updateTabBadge(tabId, 'whitelisted');
  } else if (result.matched) {
    await updateTabBadge(
      tabId,
      result.match?.matchType === 'heuristic' ? 'heuristic' : 'matched'
    );
  } else {
    await updateTabBadge(tabId, 'clear');
  }
});

// 4. Top-level runtime.onMessage listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const type = message?.type;

      if (type === 'CHECK_SITE_TIER1') {
        const url = message.url || sender?.tab?.url || '';
        const tabId = sender?.tab?.id;
        const result = await checkDomainTier1(url);
        const dismissed = await isDismissedForSession(result.hostname);
        const manifestVersion = chrome.runtime.getManifest().version;

        if (tabId) {
          if (result.whitelisted) {
            await updateTabBadge(tabId, 'whitelisted');
          } else if (result.matched) {
            await updateTabBadge(
              tabId,
              result.match?.matchType === 'heuristic' ? 'heuristic' : 'matched'
            );
          } else {
            await updateTabBadge(tabId, 'clear');
          }
        }

        sendResponse({
          ok: true,
          version: manifestVersion,
          dismissedForSession: dismissed,
          matched: result.matched,
          whitelisted: result.whitelisted,
          hostname: result.hostname,
          match: result.match,
          shouldRunTier2: result.shouldRunTier2
        });
        return;
      }

      if (type === 'EVALUATE_TIER2_PAGE') {
        const domain = normalizeHostname(message.domain || sender?.tab?.url);
        if (!domain) {
          sendResponse({ ok: false });
          return;
        }
        const state = await ensureDatabaseReady();
        const evalResult = await evaluateTier2InBackend({
          pageText: message.pageText || '',
          isDedicatedBranchPage: Boolean(message.isDedicatedBranchPage),
          candidateUrls: message.candidateUrls || [],
          settlementLocations: state.settlementLocations || []
        });

        if (!evalResult.matched) {
          sendResponse({ ok: true, matched: false });
          return;
        }

        const heuristicMatches = { ...(state.heuristicMatches || {}) };
        heuristicMatches[domain] = {
          domain,
          siteTitle: message.siteTitle || domain,
          detectedSettlements: evalResult.detectedSettlements || [],
          snippet: evalResult.snippet || '',
          sourceUrl: evalResult.sourceUrl || message.sourceUrl || '',
          detectedAt: Date.now()
        };

        const domainIndex = buildDomainIndex(
          state.companies || [],
          state.customEntries || [],
          heuristicMatches
        );

        await chrome.storage.local.set({ heuristicMatches, domainIndex });

        const tabId = sender?.tab?.id;
        if (tabId) {
          await updateTabBadge(tabId, 'heuristic');
        }

        const dismissed = await isDismissedForSession(domain);
        sendResponse({
          ok: true,
          matched: true,
          version: chrome.runtime.getManifest().version,
          dismissedForSession: dismissed,
          match: domainIndex[domain]
        });
        return;
      }

      if (type === 'SEARCH_DATABASE') {
        const state = await ensureDatabaseReady();
        const searchRes = searchDatabaseEntries(
          state.companies || [],
          state.customEntries || [],
          message.query || ''
        );
        sendResponse({ ok: true, ...searchRes });
        return;
      }

      if (type === 'DISMISS_FOR_SESSION') {
        const domain = normalizeHostname(message.domain);
        if (domain) {
          const { dismissedDomains = [] } = await chrome.storage.session.get('dismissedDomains');
          if (!dismissedDomains.includes(domain)) {
            dismissedDomains.push(domain);
            await chrome.storage.session.set({ dismissedDomains });
          }
        }
        sendResponse({ ok: true });
        return;
      }

      if (type === 'ADD_TO_WHITELIST') {
        const domain = normalizeHostname(message.domain);
        if (domain) {
          const { whitelist = [] } = await chrome.storage.local.get('whitelist');
          const normList = whitelist.map(normalizeHostname);
          if (!normList.includes(domain)) {
            const updated = [...normList, domain];
            await chrome.storage.local.set({ whitelist: updated });
          }
          if (sender?.tab?.id) {
            await updateTabBadge(sender.tab.id, 'whitelisted');
          }
        }
        sendResponse({ ok: true });
        return;
      }

      if (type === 'REMOVE_FROM_WHITELIST') {
        const domain = normalizeHostname(message.domain);
        const { whitelist = [] } = await chrome.storage.local.get('whitelist');
        const updated = whitelist.map(normalizeHostname).filter((d) => d !== domain);
        await chrome.storage.local.set({ whitelist: updated });
        sendResponse({ ok: true, whitelist: updated });
        return;
      }

      if (type === 'ADD_CUSTOM_DOMAIN') {
        const domain = normalizeHostname(message.domain);
        if (!domain) {
          sendResponse({ ok: false, error: 'כתובת דומיין לא תקינה' });
          return;
        }
        const state = await ensureDatabaseReady();
        const customEntries = [...(state.customEntries || [])].filter(
          (e) => normalizeHostname(e.domain) !== domain
        );
        customEntries.push({
          domain,
          nameHe: message.nameHe || domain,
          nameEn: message.nameEn || '',
          locations: message.locations || 'יהודה ושומרון',
          detailsHe: message.detailsHe || 'אתר זה נוסף ידנית לרשימת ההתראות.',
          addedAt: Date.now()
        });
        const domainIndex = buildDomainIndex(
          state.companies || [],
          customEntries,
          state.heuristicMatches || {}
        );
        await chrome.storage.local.set({ customEntries, domainIndex });
        sendResponse({ ok: true, customEntries, match: domainIndex[domain] });
        return;
      }

      if (type === 'REMOVE_CUSTOM_DOMAIN') {
        const domain = normalizeHostname(message.domain);
        const state = await ensureDatabaseReady();
        const customEntries = (state.customEntries || []).filter(
          (e) => normalizeHostname(e.domain) !== domain
        );
        const heuristicMatches = { ...(state.heuristicMatches || {}) };
        delete heuristicMatches[domain];

        const domainIndex = buildDomainIndex(
          state.companies || [],
          customEntries,
          heuristicMatches
        );
        await chrome.storage.local.set({ customEntries, heuristicMatches, domainIndex });
        sendResponse({ ok: true, customEntries });
        return;
      }

      if (type === 'FORCE_SYNC_DB') {
        const syncRes = await triggerBackgroundSyncIfNeeded(true);
        const state = await ensureDatabaseReady();
        sendResponse({
          ok: true,
          syncResult: syncRes,
          lastUpdated: state.lastUpdated,
          syncStats: state.syncStats
        });
        return;
      }

      if (type === 'GET_POPUP_DATA') {
        const state = await ensureDatabaseReady();
        const tabUrl = message.tabUrl || '';
        const siteCheck = tabUrl ? await checkDomainTier1(tabUrl) : { matched: false };
        const initialSearch = searchDatabaseEntries(
          state.companies || [],
          state.customEntries || [],
          message.searchQuery || ''
        );
        sendResponse({
          ok: true,
          version: chrome.runtime.getManifest().version,
          siteCheck,
          searchResult: initialSearch,
          whitelist: state.whitelist || [],
          customEntries: state.customEntries || [],
          heuristicMatches: state.heuristicMatches || {},
          lastUpdated: state.lastUpdated || 0,
          syncStats: state.syncStats || {
            totalCompanies: (state.companies || []).length,
            totalDomains: Object.keys(state.domainIndex || {}).length
          }
        });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || 'Internal error' });
    }
  })();

  return true;
});
