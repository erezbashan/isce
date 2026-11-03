# Chrome Web Store Listing — התראת עסקים ביהודה ושומרון (ISCE)

> Last Updated: 2026-11-02

## Store Listing

**Extension Name** [REQUIRED]
התראת עסקים ביהודה ושומרון (ISCE)

**Short Description** [REQUIRED]
מתריע בעת גלישה לאתרים של עסקים וחברות הפועלים ביהודה ושומרון על בסיס מאגרים פומביים וזיהוי כתובות/סניפים.

**Detailed Description** [REQUIRED]
התוסף מציג התראה ברורה בראש הדף ובסרגל הכלים כאשר אתם מבקרים באתר אינטרנט של חברה או עסק הפועלים ביהודה ושומרון.

תכונות עיקריות:
• זיהוי מיידי של אתרים השייכים לעסקים המתועדים במאגרים פומביים (כגון UN OHCHR, Who Profits ו-Wikidata).
• זיהוי חכם של עסקים המציינים כתובות או סניפים ביישובים ובאזורי תעשייה ביהודה ושומרון (תוך החרגת אתרי חדשות ומידע למניעת התראות שווא).
• הצגת פרטי העסק, הקטגוריה, המיקומים המתועדים ומקור המידע ישירות בבאנר ההתראה ובחלונית התוסף.
• חיפוש מהיר במאגר החברות לפי שם חברה, דומיין או יישוב.
• אפשרות להחריג אתרים ספציפיים או להוסיף דומיינים חדשים לרשימת ההתראות האישית.
• פרטיות מלאה: כל הבדיקות מתבצעות מקומית בדפדפן שלכם, ללא שליחת היסטוריית הגלישה לשרת חיצוני. המאגר המקומי מתעדכן אוטומטית אחת לשבעה ימים.

**Category** [REQUIRED]
Shopping

**Single Purpose** [REQUIRED]
Displays an informational warning banner when visiting websites of businesses that operate in Judea and Samaria (West Bank).

**Primary Language** [REQUIRED]
Hebrew (עברית)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Stores the business domain database, last sync timestamp, and the user's personal whitelist and custom domains locally on the device so site checks happen locally without external tracking. |
| `alarms` | permissions | Schedules a weekly background check (every 7 days) to refresh the local business database from public sources. |
| `tabs` | permissions | Reads the active tab's URL to display the current website's status in the extension popup and update the toolbar icon badge. |
| `<all_urls>` | host_permissions | Needed to display the top warning banner on matched commercial websites across any domain, scan Contact/Branches pages locally for settlement addresses, and fetch periodic database updates from public sources (Wikidata and Who Profits). |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.2 | 2026-11-03 | Fixed Tier 2 Hebrew word-boundary regex and removed ambiguous single-word settlement names to prevent false positives (e.g. matching "עלי" inside "העלים" or "מהמפעלים"). | Draft |
| 1.0.1 | 2026-11-02 | Separated GUI and backend analysis logic into `background/analyzer.js`. | Draft |
| 1.0.0 | 2026-11-02 | Initial release with two-tier detection (local public database + non-blocking branch/address detection), Hebrew RTL top warning banner, and searchable popup UI. | Draft |
