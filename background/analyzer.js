// background/analyzer.js
// Backend analysis logic for Tier 2 headquarters/factory location detection and database search.
// Strictly targets businesses operated from / headquartered / manufacturing in Yehuda & Shomron
// and ignores nationwide chains that merely have retail branches there.

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

const SINGLE_CHAR_DELIM_REGEX = /^[\s,.;:()\-/"'?!\[\]|•–—]$/;

// Only match HQ / main company address / factory context — NOT retail branches ("סניף" / "סניפים")
const HQ_OR_FACTORY_CONTEXT_REGEX = /(?:^|[\s,.;:()\-/"'])(?:כתובתנו|כתובת החברה|משרדי החברה|מטה החברה|הנהלת החברה|כתובת המפעל|מפעל הייצור|אזור תעשייה|א\.ת\.?|ת\.ד\.?|מיקוד)(?:$|[\s,.;:()\-/"'])/i;

// Indicators that a text block is a multi-branch retail list rather than a single HQ/factory address
const MULTI_BRANCH_EXCLUSION_REGEX = /(?:רשימת סניפים|הסניפים שלנו|איתור סניף|סניפי הרשת|סניף\s)/i;
const GREEN_LINE_CITIES = [
  'תל אביב',
  'חיפה',
  'ראשון לציון',
  'פתח תקווה',
  'באר שבע',
  'נתניה',
  'הרצליה',
  'אשדוד',
  'רמת גן',
  'חולון',
  'כפר סבא',
  'רעננה',
  'רחובות',
  'מודיעין'
];

const FALSE_POSITIVE_PHRASES = [
  'אריאל שרון',
  'דרך אריאל שרון',
  'רחוב אריאל שרון',
  'פארק אריאל שרון',
  'מחלף אריאל שרון'
];

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
 * Scans plain text for headquarters or factory locations in Yehuda & Shomron,
 * ignoring businesses that list multiple branches across Israel.
 */
export function scanTextForSettlementBranches(text, settlementLocations = []) {
  if (!text || text.length < 15) return null;

  let normalizedText = text.replace(/\s+/g, ' ');
  for (const fp of FALSE_POSITIVE_PHRASES) {
    normalizedText = normalizedText.replaceAll(fp, ' ');
  }

  // If the text block lists multiple Green Line cities or branch-locator headers,
  // it is a nationwide chain with branches rather than a company operated from Yehuda & Shomron.
  if (MULTI_BRANCH_EXCLUSION_REGEX.test(normalizedText)) {
    return null;
  }
  let greenLineCityCount = 0;
  for (const city of GREEN_LINE_CITIES) {
    if (normalizedText.includes(city)) {
      greenLineCityCount++;
      if (greenLineCityCount >= 2) return null;
    }
  }

  // 1. Check unambiguous industrial zones (with HQ/factory address context nearby)
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

  // 2. Check settlement names only when accompanied by explicit HQ / main company address context
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

      const isWordAfter = isDelimiterChar(charAfter);
      const isWordBefore =
        isDelimiterChar(charBefore) ||
        (/^[בלמ]$/.test(charBefore) && isDelimiterChar(charBefore2));

      if (!isWordBefore || !isWordAfter) continue;

      const winStart = Math.max(0, idx - 85);
      const winEnd = Math.min(normalizedText.length, idx + settlement.length + 85);
      const contextWindow = normalizedText.slice(winStart, winEnd);

      // Exclude if window mentions a branch ("סניף")
      if (MULTI_BRANCH_EXCLUSION_REGEX.test(contextWindow)) continue;

      if (HQ_OR_FACTORY_CONTEXT_REGEX.test(contextWindow)) {
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
 * Evaluates Tier 2 page text and optional Contact page URLs in the backend.
 */
export async function evaluateTier2InBackend({
  pageText = '',
  candidateUrls = [],
  settlementLocations = []
}) {
  let matchResult = scanTextForSettlementBranches(pageText, settlementLocations);
  if (matchResult) {
    return { matched: true, ...matchResult };
  }

  for (const contactUrl of (candidateUrls || []).slice(0, 1)) {
    if (!contactUrl || (!contactUrl.startsWith('http://') && !contactUrl.startsWith('https://'))) {
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(contactUrl, {
        signal: controller.signal,
        credentials: 'omit'
      });
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, 200000);
      const contactText = stripHtmlToText(html);
      const subMatch = scanTextForSettlementBranches(contactText, settlementLocations);
      if (subMatch) {
        return { matched: true, sourceUrl: contactUrl, ...subMatch };
      }
    } catch {
      // Ignore network timeouts
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
