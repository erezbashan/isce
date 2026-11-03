// content/content.js
// GUI layer: renders the Shadow DOM Top Layer warning banner (popover="manual")
// and extracts DOM text/candidate links for backend Tier 2 evaluation.

(() => {
  if (window.__isceContentScriptInitialized) return;
  window.__isceContentScriptInitialized = true;

  const HOST_ID = 'isce-warning-root-host';
  const BRANCH_LINK_TEXT_REGEX = /(?:סניפים|הסניפים שלנו|רשימת סניפים|איתור סניף|צור קשר|יצירת קשר|כתובתנו|נקודות מכירה|חנויות הרשת|איפה אנחנו|branches|stores|store-locator|contact)/i;
  const BRANCH_URL_PATH_REGEX = /\/(?:branches|snifim|stores|store-locator|locations|contact|contact-us)(?:\/|$|\?)/i;

  /**
   * Renders the prominent top warning banner inside an isolated Shadow DOM using Top Layer popover="manual".
   */
  function showWarningBanner(matchData, version = '1.0.2') {
    if (!document.body) return;

    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const isHeuristic = matchData.matchType === 'heuristic';
    const sourcesText = Array.isArray(matchData.sources) && matchData.sources.length > 0
      ? matchData.sources.join(' • ')
      : 'מאגר פומבי';

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        direction: rtl;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }

      .isce-banner {
        position: fixed;
        inset: 0 0 auto 0;
        width: 100%;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        border: none;
        border-bottom: 3px solid ${isHeuristic ? '#F97316' : '#EF4444'};
        background: linear-gradient(135deg, #1E1B2E 0%, #2D1622 50%, #3B1219 100%);
        color: #F8FAFC;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.55);
        z-index: 2147483647;
        direction: rtl;
        text-align: right;
        opacity: 0;
        transform: translateY(-100%);
        transition: opacity 0.25s ease, transform 0.25s ease, display 0.25s ease allow-discrete, overlay 0.25s ease allow-discrete;
      }

      .isce-banner[popover]:is(:popover-open, .\\:popover-open),
      .isce-banner.isce-visible {
        display: block;
        opacity: 1;
        transform: translateY(0);
      }

      @starting-style {
        .isce-banner[popover]:is(:popover-open, .\\:popover-open),
        .isce-banner.isce-visible {
          opacity: 0;
          transform: translateY(-100%);
        }
      }

      .isce-inner {
        max-width: 1280px;
        margin: 0 auto;
        padding: 10px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }

      .isce-main {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1 1 520px;
        min-width: 280px;
      }

      .isce-alert-icon {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: ${isHeuristic ? 'rgba(249, 115, 22, 0.22)' : 'rgba(239, 68, 68, 0.24)'};
        border: 1px solid ${isHeuristic ? 'rgba(251, 146, 60, 0.5)' : 'rgba(248, 113, 113, 0.5)'};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
      }

      .isce-text-wrap {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .isce-headline {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 14.5px;
        font-weight: 700;
        color: #FFFFFF;
      }

      .isce-company-name {
        color: #FCA5A5;
        font-weight: 800;
      }

      .isce-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        color: #E2E8F0;
        border: 1px solid rgba(255, 255, 255, 0.18);
      }

      .isce-badge-source {
        background: ${isHeuristic ? 'rgba(249, 115, 22, 0.25)' : 'rgba(220, 38, 38, 0.28)'};
        color: ${isHeuristic ? '#FDBA74' : '#FECACA'};
        border-color: ${isHeuristic ? 'rgba(251, 146, 60, 0.4)' : 'rgba(248, 113, 113, 0.4)'};
      }

      .isce-subline {
        font-size: 12.5px;
        color: #CBD5E1;
        line-height: 1.4;
      }

      .isce-locations {
        color: #FDE68A;
        font-weight: 600;
      }

      .isce-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .isce-btn {
        appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.09);
        color: #F8FAFC;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 11px;
        border-radius: 7px;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
        font-family: inherit;
      }

      .isce-btn:hover {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(255, 255, 255, 0.35);
      }

      .isce-btn-dismiss {
        background: #DC2626;
        border-color: #EF4444;
        color: #FFFFFF;
      }

      .isce-btn-dismiss:hover {
        background: #B91C1C;
      }

      .isce-version {
        font-size: 10.5px;
        color: #94A3B8;
        padding: 0 4px;
        user-select: none;
      }

      .isce-details-drawer {
        display: none;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(15, 23, 42, 0.65);
        padding: 10px 18px;
        font-size: 12.5px;
        color: #E2E8F0;
      }

      .isce-details-drawer.open {
        display: block;
      }

      .isce-details-inner {
        max-width: 1280px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    `;

    const banner = document.createElement('div');
    banner.className = 'isce-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'התראת עסק הפועל ביהודה ושומרון');

    const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
    if (supportsPopover) {
      banner.setAttribute('popover', 'manual');
    }

    const companyDisplay = matchData.nameEn && matchData.nameEn !== matchData.nameHe
      ? `${matchData.nameHe} (${matchData.nameEn})`
      : matchData.nameHe;

    banner.innerHTML = `
      <div class="isce-inner">
        <div class="isce-main">
          <div class="isce-alert-icon" aria-hidden="true">⚠️</div>
          <div class="isce-text-wrap">
            <div class="isce-headline">
              <span>התראה: עסק הפועל ביהודה ושומרון —</span>
              <span class="isce-company-name" id="isce-comp-name"></span>
              <span class="isce-badge" id="isce-cat-badge"></span>
              <span class="isce-badge isce-badge-source" id="isce-src-badge"></span>
            </div>
            <div class="isce-subline">
              <span>מיקומים מתועדים: </span>
              <span class="isce-locations" id="isce-loc-text"></span>
            </div>
          </div>
        </div>
        <div class="isce-actions">
          <button type="button" class="isce-btn" id="isce-btn-details">פרטים נוספים ▾</button>
          <button type="button" class="isce-btn" id="isce-btn-whitelist" title="הוסף דומיין זה לרשימת ההחרגות שלך">אל תתריע באתר זה</button>
          <button type="button" class="isce-btn isce-btn-dismiss" id="isce-btn-close" popovertargetaction="hide">הסתר לביקור זה ✕</button>
          <span class="isce-version" id="isce-ver-tag"></span>
        </div>
      </div>
      <div class="isce-details-drawer" id="isce-drawer">
        <div class="isce-details-inner">
          <div id="isce-details-desc"></div>
          <div id="isce-details-meta" style="color: #94A3B8; font-size: 11.5px;"></div>
        </div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(banner);
    document.body.appendChild(host);

    shadow.getElementById('isce-comp-name').textContent = companyDisplay;
    shadow.getElementById('isce-cat-badge').textContent = matchData.category || 'עסק מסחרי';
    shadow.getElementById('isce-src-badge').textContent = sourcesText;
    shadow.getElementById('isce-loc-text').textContent = matchData.locations || 'יהודה ושומרון';
    shadow.getElementById('isce-ver-tag').textContent = `v${version}`;
    shadow.getElementById('isce-details-desc').textContent =
      matchData.detailsHe || 'עסק זה מופיע במאגרים פומביים כבעל פעילות ביהודה ושומרון.';
    shadow.getElementById('isce-details-meta').textContent =
      `דומיין מזוהה: ${matchData.matchedDomain || window.location.hostname} | מקור המידע: ${sourcesText}`;

    requestAnimationFrame(() => {
      try {
        if (supportsPopover && typeof banner.showPopover === 'function') {
          banner.showPopover();
        }
      } catch {
        // Fallback if showPopover fails
      }
      banner.classList.add('isce-visible');
    });

    const detailsBtn = shadow.getElementById('isce-btn-details');
    const drawer = shadow.getElementById('isce-drawer');
    detailsBtn.addEventListener('click', () => {
      const isOpen = drawer.classList.toggle('open');
      detailsBtn.textContent = isOpen ? 'הסתר פרטים ▴' : 'פרטים נוספים ▾';
    });

    const closeBanner = () => {
      banner.classList.remove('isce-visible');
      try {
        if (supportsPopover && typeof banner.hidePopover === 'function') {
          banner.hidePopover();
        }
      } catch {
        // Ignore
      }
      setTimeout(() => host.remove(), 220);
    };

    shadow.getElementById('isce-btn-close').addEventListener('click', async () => {
      closeBanner();
      try {
        await chrome.runtime.sendMessage({
          type: 'DISMISS_FOR_SESSION',
          domain: window.location.hostname
        });
      } catch {
        // Ignore
      }
    });

    shadow.getElementById('isce-btn-whitelist').addEventListener('click', async () => {
      closeBanner();
      try {
        await chrome.runtime.sendMessage({
          type: 'ADD_TO_WHITELIST',
          domain: matchData.matchedDomain || window.location.hostname
        });
      } catch {
        // Ignore
      }
    });
  }

  /**
   * Collects candidate text and internal branch/contact links from the DOM and sends them
   * to the backend service worker for Tier 2 evaluation.
   */
  async function requestTier2Evaluation() {
    if (!document.body) return;

    const hostname = window.location.hostname.toLowerCase();
    const bodySample = (document.body.innerText || '').slice(0, 4000);
    const hasHebrew = /[\u0590-\u05FF]/.test(bodySample);
    if (!hostname.endsWith('.il') && !hasHebrew) return;

    const currentPath = window.location.pathname;
    const pageTitle = document.title || '';
    const isDedicatedBranchPage =
      BRANCH_URL_PATH_REGEX.test(currentPath) || BRANCH_LINK_TEXT_REGEX.test(pageTitle);

    let pageText = '';
    if (isDedicatedBranchPage) {
      pageText = (document.body.innerText || '').slice(0, 120000);
    } else {
      const addressContainers = document.querySelectorAll(
        'footer, address, [class*="footer" i], [id*="footer" i], [class*="contact" i], [class*="branch" i], [class*="address" i]'
      );
      const chunks = [];
      addressContainers.forEach((el) => {
        if (el.innerText) chunks.push(el.innerText);
      });
      pageText = chunks.join(' \n ').slice(0, 80000);
    }

    const candidateUrls = [];
    if (!isDedicatedBranchPage) {
      const seenUrls = new Set([window.location.href]);
      const links = Array.from(document.querySelectorAll('a[href]'));

      for (const a of links) {
        if (candidateUrls.length >= 2) break;
        const text = (a.textContent || '').trim();
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
          continue;
        }
        let resolvedUrl;
        try {
          resolvedUrl = new URL(href, window.location.origin);
        } catch {
          continue;
        }
        if (resolvedUrl.origin !== window.location.origin) continue;
        if (seenUrls.has(resolvedUrl.href)) continue;

        if (
          (text.length > 1 && text.length < 40 && BRANCH_LINK_TEXT_REGEX.test(text)) ||
          BRANCH_URL_PATH_REGEX.test(resolvedUrl.pathname)
        ) {
          seenUrls.add(resolvedUrl.href);
          candidateUrls.push(resolvedUrl.href);
        }
      }
    }

    if (!pageText && candidateUrls.length === 0) return;

    const cleanSiteTitle = (document.title || window.location.hostname)
      .split(/[-|–—]/)[0]
      .trim()
      .slice(0, 60);

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'EVALUATE_TIER2_PAGE',
        domain: window.location.hostname,
        siteTitle: cleanSiteTitle || window.location.hostname,
        pageText,
        isDedicatedBranchPage,
        candidateUrls,
        sourceUrl: window.location.href
      });

      if (res?.ok && res.matched && res.match && !res.dismissedForSession) {
        showWarningBanner(res.match, res.version);
      }
    } catch {
      // Ignore
    }
  }

  async function evaluateCurrentPage() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_SITE_TIER1',
        url: window.location.href
      });

      if (!response?.ok) return;

      if (response.whitelisted) {
        const existing = document.getElementById(HOST_ID);
        if (existing) existing.remove();
        return;
      }

      if (response.matched && response.match) {
        if (!response.dismissedForSession) {
          showWarningBanner(response.match, response.version);
        }
        return;
      }

      if (response.shouldRunTier2) {
        const scheduleIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 900));
        scheduleIdle(() => {
          requestTier2Evaluation();
        }, { timeout: 3000 });
      }
    } catch {
      // Ignore
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'RECHECK_CURRENT_PAGE') {
      evaluateCurrentPage();
      sendResponse({ ok: true });
    }
    return false;
  });

  evaluateCurrentPage();
})();
