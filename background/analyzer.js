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

const ADDRESS_CONTEXT_REGEX = /(?:סניף|סניפים|הסניפים|כתובת|כתובתנו|אזור תעשייה|א\.ת\.?|מפעל|משרדים|חנות|נקודת מכירה|נקודות מכירה|אולם תצוגה|מרכז לוגיסטי|מרלו"ג|ת\.ד\.?|מיקוד|שעות פתיחה|טלפון|פקס|רחוב|שדרות|קניון|מרכז מסחרי|ניווט|waze|ווייז)/i;

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
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scans plain text for settlement locations in an address/branch context.
 */
export function scanTextForSettlementBranches(text, settlementLocations = [], isDedicatedBranchPage = false) {
  if (!text || text.length < 15) return null;
  const normalizedText = text.replace(/\s+/g, ' ');

  // 1. Check unambiguous industrial zones first
  for (const zone of INDUSTRIAL_ZONES) {
    const idx = normalizedText.indexOf(zone);
    if (idx !== -1) {
      const start = Math.max(0, idx - 55);
      const end = Math.min(normalizedText.length, idx + zone.length + 65);
      return {
        detectedSettlements: [zone],
        snippet: normalizedText.slice(start, end).trim()
      };
    }
  }

  // 2. Check settlement names with word boundaries and address/branch context
  const matchedSettlements = new Set();
  let firstSnippet = '';

  for (const settlement of settlementLocations) {
    if (!settlement || settlement.length < 3) continue;
    let searchPos = 0;
    while (searchPos < normalizedText.length) {
      const idx = normalizedText.indexOf(settlement, searchPos);
      if (idx === -1) break;
      searchPos = idx + settlement.length;

      const charBefore = idx > 0 ? normalizedText[idx - 1] : ' ';
      const charBefore2 = idx > 1 ? normalizedText[idx - 2] : ' ';
      const charAfter = idx + settlement.length < normalizedText.length
        ? normalizedText[idx + settlement.length]
        : ' ';

      const isWordAfter = /[\s,.;:()\-/"'?!]|$/.test(charAfter);
      const isWordBefore =
        /[\s,.;:()\-/"']|^/.test(charBefore) ||
        (/[בלמהוכ]/.test(charBefore) && (/[\s,.;:()\-/"']|^/.test(charBefore2)));

      if (!isWordBefore || !isWordAfter) continue;

      const winStart = Math.max(0, idx - 110);
      const winEnd = Math.min(normalizedText.length, idx + settlement.length + 110);
      const contextWindow = normalizedText.slice(winStart, winEnd);

      const hasAddressKeyword = ADDRESS_CONTEXT_REGEX.test(contextWindow);
      const hasPhoneOrNumberOnBranchPage =
        isDedicatedBranchPage && /(?:\d{2,3}-\d{6,7}|\d{4}|\bרח['׳]|\bסניף)/.test(contextWindow);

      if (hasAddressKeyword || hasPhoneOrNumberOnBranchPage) {
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
