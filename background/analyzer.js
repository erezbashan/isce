// background/analyzer.js
// Backend analysis logic for Tier 2 settlement/industrial-zone detection and database search.

const INDUSTRIAL_ZONES = [
  'אזור תעשייה ברקן',
  'א.ת. ברקן',
  'א.ת ברקן',
  'אזור תעשייה מישור אדומים',
  'פארק תעשיות מישור אדומים',
  'אזור תעשייה עטרות',
  'א.ת. עטרות',
  'א.ת עטרות',
  'אזור תעשייה אריאל',
  'א.ת. אריאל',
  'אזור תעשייה קרני שומרון',
  'אזור תעשייה שער בנימין',
  'אזור תעשייה אלפי מנשה',
  'אזור תעשייה עמנואל',
  'אזור תעשייה קריית ארבע',
  'אזור תעשייה מעלה אפרים',
  'אזור תעשייה שילה'
];

// Single-character delimiter check (fixed: no ungrouped ^ or $ alternation that matches non-delimiters)
const SINGLE_CHAR_DELIM_REGEX = /^[\s,.;:()\-/"'?!\[\]|•–—]$/;

// Explicit address/branch context tokens required within a tight window around a settlement name
const ADDRESS_CONTEXT_REGEX = /(?:^|[\s,.;:()\-/"'])(?:סניף|סניפים|הסניפים|כתובת|כתובתנו|אזור תעשייה|א\.ת\.?|חנות|נקודת מכירה|נקודות מכירה|אולם תצוגה|מרכז לוגיסטי|מרלו"ג|ת\.ד\.?|מיקוד|שעות פתיחה|טלפון|פקס|רחוב|שדרות|קניון|מרכז מסחרי|ניווט|waze|ווייז)(?:$|[\s,.;:()\-/"'])/i;

// Common false-positive phrases in central Israel (e.g., Ariel Sharon Street in Tel Aviv/Givatayim/Ramat Gan)
const FALSE_POSITIVE_PHRASES = [
  'אריאל שרון',
  'דרך אריאל שרון',
  'רחוב אריאל שרון',
  'פארק אריאל שרון',
  'מחלף אריאל שרון'
];

/**
 * Checks whether asingle character (or empty string at text boundary) is a valid word delimiter.
 */
function isDelimiterChar(ch) {
  if (!ch) return true;
  return SINGLE_CHAR_DELIM_REGEX.test(ch);
}

/**
 * Strips script/style tags and HTML markup to produce plain text for backend analysis.
 */
export function stripHtmlToText(htmlString) {
  if (!htmlString || typeof htmlString !== 'string') return '';
  return htmlString
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#8211;|&ndash;/gi, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scans plain text for settlement locations in an address/branch context.
 */
export function scanTextForSettlementBranches(text, settlementLocations = [], isDedicatedBranchPage = false) {
  if (!text || text.length < 15) return null;

  let normalizedText = text.replace(/\s+/g, ' ');
  for (const fp of FALSE_POSITIVE_PHRASES) {
    normalizedText = normalizedText.replaceAll(fp, ' ');
  }

  // 1. Check unambiguous industrial zones first
  for (const zone of INDUSTRIAL_ZONES) {
    const idx = normalizedText.indexOf(zone);
    if (idx !== -1) {
      const charBefore = idx > 0 ? normalizedText[idx - 1] : '';
      const charAfter = idx + zone.length < normalizedText.length ? normalizedText[idx + zone.length] : '';
      if (isDelimiterChar(charBefore) && isDelimiterChar(charAfter)) {
        const start = Math.max(0, idx - 50);
        const end = Math.min(normalizedText.length, idx + zone.length + 60);
        return {
          detectedSettlements: [zone],
          snippet: normalizedText.slice(start, end).trim()
        };
      }
    }
  }

  // 2. Check settlement names with strict word boundaries and address/branch context
  const matchedSettlements = new Set();
  let firstSnippet = '';

  for (const settlement of settlementLocations) {
    if (!settlement || settlement.length < 4) continue;
    let searchPos = 0;
    while (searchPos < normalizedText.length) {
      const idx = normalizedText.indexOf(settlement, searchPos);
      if (idx === -1) break;
      searchPos = idx + settlement.length;

      const charBefore = idx > 0 ? normalizedText[idx - 1] : '';
      const charBefore2 = idx > 1 ? normalizedText[idx - 2] : '';
      const charAfter = idx + settlement.length < normalizedText.length
        ? normalizedText[idx + settlement.length]
        : '';

      // Must end at a real word delimiter (never in the middle of a word like "העלים" or "מהמפעלים")
      const isWordAfter = isDelimiterChar(charAfter);
      // Must start at a real word delimiter, or after a single Hebrew location preposition (ב, ל, מ) preceded by a delimiter
      const isWordBefore =
        isDelimiterChar(charBefore) ||
        (/^[בלמ]$/.test(charBefore) && isDelimiterChar(charBefore2));

      if (!isWordBefore || !isWordAfter) continue;

      // Tight local context window (85 chars before and after)
      const winStart = Math.max(0, idx - 85);
      const winEnd = Math.min(normalizedText.length, idx + settlement.length + 85);
      const contextWindow = normalizedText.slice(winStart, winEnd);

      const hasAddressKeyword = ADDRESS_CONTEXT_REGEX.test(contextWindow);
      const hasPhoneOrStreetOnBranchPage =
        isDedicatedBranchPage && /(?:\b0[23489]-\d{7}\b|\bרח['׳]|\bרחוב\s|\bסניף\s)/.test(contextWindow);

      if (hasAddressKeyword || hasPhoneOrStreetOnBranchPage) {
        matchedSettlements.add(settlement);
        if (!firstSnippet) {
          const snipStart = Math.max(0, idx - 45);
          const snipEnd = Math.min(normalizedText.length, idx + settlement.length + 55);
          firstSnippet = normalizedText.slice(snipStart, snipEnd).trim();
        }
        break;
      }
    }
  }

  if (matchedSettlements.size > 0) {
    return {
      detectedSettlements: Array.from(matchedSettlements).slice(0, 4),
      snippet: firstSnippet
    };
  }

  return null;
}

/**
 * Evaluates Tier 2 page text and optional internal branch/contact URLs in the backend.
 */
export async function evaluateTier2InBackend({
  pageText = '',
  isDedicatedBranchPage = false,
  candidateUrls = [],
  settlementLocations = []
}) {
  let matchResult = scanTextForSettlementBranches(
    pageText,
    settlementLocations,
    isDedicatedBranchPage
  );
  if (matchResult) {
    return { matched: true, ...matchResult };
  }

  for (const branchUrl of (candidateUrls || []).slice(0, 2)) {
    if (!branchUrl || (!branchUrl.startsWith('http://') && !branchUrl.startsWith('https://'))) {
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(branchUrl, {
        signal: controller.signal,
        credentials: 'omit'
      });
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, 250000);
      const branchText = stripHtmlToText(html);
      const subMatch = scanTextForSettlementBranches(branchText, settlementLocations, true);
      if (subMatch) {
        return { matched: true, sourceUrl: branchUrl, ...subMatch };
      }
    } catch {
      // Ignore network timeouts on sub-pages
    } finally {
      clearTimeout(timeout);
    }
  }

  return { matched: false };
}

/**
 * Backend search filtering across companies and custom entries.
 */
export function searchDatabaseEntries(companies = [], customEntries = [], query = '') {
  const q = (query || '').trim().toLowerCase();
  const allEntries = [
    ...companies,
    ...(customEntries || []).map((c) => ({
      id: `custom-${c.domain}`,
      nameHe: c.nameHe || c.domain,
      nameEn: c.nameEn || '',
      domains: [c.domain],
      category: 'הוספה ידנית',
      locations: c.locations || 'יהודה ושומרון'
    }))
  ];

  const filtered = allEntries.filter((c) => {
    if (!q) return true;
    const nameHe = (c.nameHe || '').toLowerCase();
    const nameEn = (c.nameEn || '').toLowerCase();
    const locs = (c.locations || '').toLowerCase();
    const cat = (c.category || '').toLowerCase();
    const domains = (c.domains || []).join(' ').toLowerCase();
    return (
      nameHe.includes(q) ||
      nameEn.includes(q) ||
      locs.includes(q) ||
      cat.includes(q) ||
      domains.includes(q)
    );
  });

  return {
    totalMatches: filtered.length,
    items: filtered.slice(0, 50)
  };
}
