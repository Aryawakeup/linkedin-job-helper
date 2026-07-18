# LinkedIn Job Helper — Dutch Requirement, Resume Match & Seniority Annotations

**English** | [中文](README.zh-CN.md)

A fully local Chrome extension that annotates LinkedIn job postings while you browse:

1. **Dutch language requirement** — green (no Dutch needed / English working environment), yellow (Dutch is a plus / unclear), red (Dutch required, or the posting itself is written in Dutch).
2. **Resume skill match** — scans both your resume and the job description against a curated dictionary of ~120 skill groups (multi-word phrases and aliases included, e.g. `Power BI` = `powerbi`, `NLP` = `natural language processing`) and shows a match percentage, the skills you have, and the skills the job asks for that your resume doesn't mention.
3. **Seniority detection** — 🎓 Intern / 🌱 Junior / 🌿 Mid / 🌳 Senior, inferred from the job title first (a "Senior Data Scientist" posting is senior regardless of wording) and otherwise from experience requirements in the description (`5+ years of experience`, `2-4 years`, Dutch `minimaal 3 jaar ervaring`, …).

**Batch annotation:** every card in the job list gets annotated automatically — no need to click into each posting. Descriptions are fetched through LinkedIn's own job-posting endpoint using your current session, throttled to ~1 request/second and cached for 7 days. Clicking into a posting shows a detail panel with the full skill breakdown.

Your resume is stored only in your browser's local extension storage (`chrome.storage.local`). Nothing is ever uploaded anywhere.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. Open the extension's options page, paste your resume as plain text, optionally add weighted keywords, and save.
5. Browse `linkedin.com/jobs` — list cards get badges automatically; open any posting for the detail panel.

## Usage notes

- **Weighted keywords**: skills you list in the options page count double when they appear in a job description. Swap in a different keyword set (e.g. data engineering vs. data science) and all cached jobs re-score instantly.
- Updating your resume or keywords invalidates the job cache automatically.
- Match score thresholds: ≥55% green, 35–55% yellow, <35% red. It's a keyword-level heuristic, not semantic understanding — treat it as a triage signal, not a verdict.

## Known limitations

- LinkedIn changes its DOM frequently. If the panel stops appearing, the selectors in `content.js` (`DESC_SELECTORS`) likely need updating.
- Some non-public postings can't be fetched from the list view ("no description available" badge); open the posting to see the detail panel instead.
- The extension only analyzes jobs you actually browse — it performs no bulk scraping. Keep it that way: it fetches at most the postings visible in your list, politely throttled.

## Disclaimer

Personal-use tool. Not affiliated with or endorsed by LinkedIn. Use at your own discretion and in accordance with LinkedIn's terms of service.
