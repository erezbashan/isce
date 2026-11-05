// background/db-sync.js
// Client-side database storage, O(1) domain lookup, and 7-day background sync from public databases.
// Scope: Only businesses headquartered, based, or primarily manufacturing in Yehuda & Shomron.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CURRENT_DB_SCHEMA_VERSION = 3;

/**
 * Extracts normalized hostname from a URL or domain string.
 */
export function normalizeHostname(input) {
  if (!input || typeof input !== 'string') return '';
  let host = input.trim().toLowerCase();
  try {
    if (host.includes('://')) {
      const url = new URL(host);
      host = url.hostname.toLowerCase();
    } else {
      host = host.split('/')[0].split('?')[0].split(':')[0];
    }
  } catch {
    host = host.split('/')[0].split('?')[0].split(':')[0];
  }
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }
  return host.replace(/\.$/, '');
}

/**
 * Returns candidate domains from most-specific to registrable root domain.
 */
export function getCandidateDomains(hostname) {
  const clean = normalizeHostname(hostname);
  if (!clean) return [];
  const parts = clean.split('.');
  if (parts.length <= 2) return [clean];

  const multiPartTlds = new Set([
    'co.il', 'org.il', 'ac.il', 'net.il', 'muni.il', 'gov.il', 'k12.il',
    'co.uk', 'org.uk', 'com.au', 'co.za'
  ]);
  const lastTwo = parts.slice(-2).join('.');
  const minParts = multiPartTlds.has(lastTwo) ? 3 : 2;

  const candidates = [];
  for (let i = 0; i <= parts.length - minParts; i++) {
    candidates.push(parts.slice(i).join('.'));
  }
  return candidates;
}

/**
 * Loads the bundled seed database packaged with the extension.
 */
export async function loadSeedDatabase() {
  const url = chrome.runtime.getURL('data/seed-database.json');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load seed database: ${response.status}`);
  }
  return await response.json();
}

/**
 * Builds an O(1) domain lookup map from companies, custom entries, and Tier 2 heuristic hits.
 */
export function buildDomainIndex(companies = [], customEntries = [], heuristicMatches = {}) {
  const index = {};

  for (const company of companies) {
    if (!company || !Array.isArray(company.domains)) continue;
    for (const rawDomain of company.domains) {
      const domain = normalizeHostname(rawDomain);
      if (domain) {
        index[domain] = {
          matchType: 'database',
          companyId: company.id,
          nameHe: company.nameHe,
          nameEn: company.nameEn || '',
          category: company.category || 'עסק המופעל מיהודה ושומרון',
          locations: company.locations || 'יהודה ושומרון',
          detailsHe: company.detailsHe || 'עסק שהנהלתו או מפעלו המרכזי פועלים ביהודה ושומרון.',
          sources: company.sources || ['מאגר פומבי'],
          matchedDomain: domain
        };
      }
    }
  }

  for (const [rawDomain, matchInfo] of Object.entries(heuristicMatches || {})) {
    const domain = normalizeHostname(rawDomain);
    if (domain && !index[domain]) {
      index[domain] = {
        matchType: 'heuristic',
        companyId: `heuristic-${domain}`,
        nameHe: matchInfo.siteTitle || domain,
        nameEn: domain,
        category: 'זיהוי כתובת הנהלה / מפעל באתר',
        locations: (matchInfo.detectedSettlements || []).join(', ') || 'יהודה ושומרון',
        detailsHe: matchInfo.snippet
          ? `זוהתה כתובת הנהלה או מפעל ביהודה ושומרון בעמוד האתר: "${matchInfo.snippet}"`
          : 'זוהתה כתובת הנהלה או מפעל ביהודה ושומרון בסריקת האתר.',
        sources: ['זיהוי כתובת באתר (Tier 2)'],
        matchedDomain: domain,
        detectedAt: matchInfo.detectedAt
      };
    }
  }

  for (const entry of customEntries || []) {
    const domain = normalizeHostname(entry.domain);
    if (domain) {
      index[domain] = {
        matchType: 'custom',
        companyId: `custom-${domain}`,
        nameHe: entry.nameHe || domain,
        nameEn: entry.nameEn || '',
        category: entry.category || 'הגדרה ידנית',
        locations: entry.locations || 'יהודה ושומרון',
        detailsHe: entry.detailsHe || 'אתר זה נוסף ידנית על ידך לרשימת ההתראות.',
        sources: ['הוספה ידנית'],
        matchedDomain: domain
      };
    }
  }

  return index;
}

/**
 * Ensures storage is initialized with the current schema version (v3: only businesses operated from Yehuda & Shomron).
 */
export async function ensureDatabaseReady() {
  const stored = await chrome.storage.local.get([
    'companies',
    'domainIndex',
    'settlementLocations',
    'excludedDomains',
    'whitelist',
    'customEntries',
    'heuristicMatches',
    'dbSchemaVersion',
    'lastUpdated',
    'syncStats'
  ]);

  if (
    stored.domainIndex &&
    Array.isArray(stored.companies) &&
    stored.companies.length > 0 &&
    stored.dbSchemaVersion === CURRENT_DB_SCHEMA_VERSION
  ) {
    const now = Date.now();
    const lastUpdated = stored.lastUpdated || 0;
    if (now - lastUpdated > SEVEN_DAYS_MS) {
      triggerBackgroundSyncIfNeeded(false);
    }
    return stored;
  }

  // Load clean v3 seed database (replaces old v1/v2 nationwide branch chains like Shufersal)
  const seed = await loadSeedDatabase();
  const companies = seed.companies || [];
  const settlementLocations = seed.settlementLocations || [];
  const excludedDomains = seed.excludedMediaAndReferenceDomains || [];
  const whitelist = stored.whitelist || [];
  const customEntries = stored.customEntries || [];
  const heuristicMatches =
    stored.dbSchemaVersion === CURRENT_DB_SCHEMA_VERSION
      ? (stored.heuristicMatches || {})
      : {};
  const domainIndex = buildDomainIndex(companies, customEntries, heuristicMatches);

  const initialState = {
    companies,
    domainIndex,
    settlementLocations,
    excludedDomains,
    whitelist,
    customEntries,
    heuristicMatches,
    dbSchemaVersion: CURRENT_DB_SCHEMA_VERSION,
    lastUpdated: 0,
    syncStats: {
      totalCompanies: companies.length,
      totalDomains: Object.keys(domainIndex).length,
      lastAttempt: null,
      lastStatus: 'מאגר ממוקד נטען (עסקים הפועלים מיהודה ושומרון בלבד)'
    }
  };

  await chrome.storage.local.set(initialState);
  triggerBackgroundSyncIfNeeded(false);
  return initialState;
}

/**
 * Queries Wikidata's public SPARQL endpoint strictly for businesses whose HEADQUARTERS (wdt:P159)
 * is located in an Israeli settlement in Judea and Samaria (wd:Q513200).
 */
async function fetchWikidataSettlementBusinesses() {
  const sparql = `
    SELECT DISTINCT ?item ?itemLabelHe ?itemLabelEn ?website ?locLabelHe WHERE {
      ?item wdt:P31/wdt:P279* wd:Q4830453 .
      ?item wdt:P856 ?website .
      ?item wdt:P159 ?loc .
      ?loc wdt:P31/wdt:P279* wd:Q513200 .
      OPTIONAL { ?item rdfs:label ?itemLabelHe FILTER(LANG(?itemLabelHe) = "he") }
      OPTIONAL { ?item rdfs:label ?itemLabelEn FILTER(LANG(?itemLabelEn) = "en") }
      OPTIONAL { ?loc rdfs:label ?locLabelHe FILTER(LANG(?locLabelHe) = "he") }
    }
    LIMIT 150
  `;

  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json'
      },
      signal: controller.signal
    });
    if (!res.ok) return [];
    const data = await res.json();
    const bindings = data?.results?.bindings || [];
    const discovered = [];

    for (const row of bindings) {
      const websiteUrl = row.website?.value;
      const domain = normalizeHostname(websiteUrl);
      if (!domain || domain.length < 4) continue;

      const qid = (row.item?.value || '').split('/').pop() || domain;
      const nameHe = row.itemLabelHe?.value || row.itemLabelEn?.value || domain;
      const nameEn = row.itemLabelEn?.value || '';
      const locHe = row.locLabelHe?.value || 'יהודה ושומרון';

      discovered.push({
        id: `wikidata-${qid.toLowerCase()}`,
        nameHe,
        nameEn,
        domains: [domain],
        category: 'מטה חברה ביהודה ושומרון (Wikidata)',
        locations: locHe,
        detailsHe: `חברה שמטה ההנהלה שלה (P159) רשום ב${locHe} לפי מאגר הנתונים הפתוח Wikidata.`,
        sources: ['Wikidata SPARQL']
      });
    }
    return discovered;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Triggers a background sync if one is not already running.
 */
export async function triggerBackgroundSyncIfNeeded(force = false) {
  const { isSyncing = false } = await chrome.storage.session.get('isSyncing');
  if (isSyncing) {
    return { status: 'already_syncing' };
  }

  const { lastUpdated = 0 } = await chrome.storage.local.get('lastUpdated');
  if (!force && lastUpdated > 0 && Date.now() - lastUpdated < SEVEN_DAYS_MS) {
    return { status: 'up_to_date', lastUpdated };
  }

  await chrome.storage.session.set({ isSyncing: true });
  try {
    const seed = await loadSeedDatabase();
    const stored = await chrome.storage.local.get([
      'whitelist',
      'customEntries',
      'heuristicMatches'
    ]);

    const companyMap = new Map();
    for (const c of seed.companies || []) {
      companyMap.set(c.id, {
        ...c,
        domains: Array.from(new Set((c.domains || []).map(normalizeHostname).filter(Boolean)))
      });
    }

    const wikidataItems = await fetchWikidataSettlementBusinesses();

    const existingDomains = new Set();
    for (const c of companyMap.values()) {
      for (const d of c.domains || []) existingDomains.add(d);
    }

    const excludedSet = new Set(
      (seed.excludedMediaAndReferenceDomains || []).map(normalizeHostname)
    );

    let newlyAddedCount = 0;
    for (const item of wikidataItems) {
      const domain = item.domains[0];
      if (!domain || excludedSet.has(domain) || existingDomains.has(domain)) continue;
      existingDomains.add(domain);
      companyMap.set(item.id, item);
      newlyAddedCount++;
    }

    const mergedCompanies = Array.from(companyMap.values());
    const whitelist = stored.whitelist || [];
    const customEntries = stored.customEntries || [];
    const heuristicMatches = stored.heuristicMatches || {};
    const domainIndex = buildDomainIndex(mergedCompanies, customEntries, heuristicMatches);
    const now = Date.now();

    const sourcesSummary = ['מאגר עסקים המופעלים מיו"ש'];
    if (wikidataItems.length > 0) sourcesSummary.push(`Wikidata HQ (${wikidataItems.length})`);

    const syncStats = {
      totalCompanies: mergedCompanies.length,
      totalDomains: Object.keys(domainIndex).length,
      newlyAddedCount,
      lastAttempt: now,
      lastStatus: `עודכן בהצלחה (${sourcesSummary.join(' + ')})`
    };

    await chrome.storage.local.set({
      companies: mergedCompanies,
      domainIndex,
      settlementLocations: seed.settlementLocations || [],
      excludedDomains: seed.excludedMediaAndReferenceDomains || [],
      dbSchemaVersion: CURRENT_DB_SCHEMA_VERSION,
      lastUpdated: now,
      syncStats
    });

    return {
      status: 'synced',
      lastUpdated: now,
      syncStats
    };
  } catch (err) {
    const now = Date.now();
    const { syncStats = {} } = await chrome.storage.local.get('syncStats');
    await chrome.storage.local.set({
      syncStats: {
        ...syncStats,
        lastAttempt: now,
        lastStatus: `שגיאה בסנכרון מרחוק - משתמש במאגר המקומי (${err?.message || 'שגיאת רשת'})`
      }
    });
    return { status: 'error', error: err?.message };
  } finally {
    await chrome.storage.session.set({ isSyncing: false });
  }
}

/**
 * Instant Tier 1 Lookup (< 1ms once storage is warm).
 */
export async function checkDomainTier1(urlOrHost) {
  const hostname = normalizeHostname(urlOrHost);
  if (!hostname) {
    return { matched: false, reason: 'invalid_host' };
  }

  const state = await ensureDatabaseReady();
  const candidates = getCandidateDomains(hostname);
  const whitelistSet = new Set((state.whitelist || []).map(normalizeHostname));
  const excludedSet = new Set((state.excludedDomains || []).map(normalizeHostname));

  for (const candidate of candidates) {
    if (whitelistSet.has(candidate)) {
      return {
        matched: false,
        whitelisted: true,
        hostname,
        matchedDomain: candidate
      };
    }
  }

  const domainIndex = state.domainIndex || {};
  for (const candidate of candidates) {
    if (domainIndex[candidate]) {
      return {
        matched: true,
        whitelisted: false,
        hostname,
        match: domainIndex[candidate]
      };
    }
  }

  const isExcludedMediaOrRef = candidates.some((c) => excludedSet.has(c));

  return {
    matched: false,
    whitelisted: false,
    hostname,
    shouldRunTier2: !isExcludedMediaOrRef,
    settlementLocations: !isExcludedMediaOrRef ? (state.settlementLocations || []) : []
  };
}
