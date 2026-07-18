// LinkedIn Job Helper — content script
// Injected on all linkedin.com pages (LinkedIn is a SPA, so navigation into
// /jobs/ often happens without a page load). Analyzes the job posting the
// user is currently viewing: Dutch requirement + resume keyword match.

(() => {
  const PANEL_ID = "ljh-panel";
  const DEBUG = true;
  const log = (...a) => DEBUG && console.log("[LinkedIn Job Helper]", ...a);

  let lastAnalyzedKey = "";
  let extraKeywords = [];
  let noDescSince = null;

  log("content script loaded on", location.href);

  // ---------- Dutch requirement detection ----------

  const RE_NOT_REQUIRED = [
    /dutch\s+is\s+not\s+(required|necessary|needed|a\s+must)/i,
    /no\s+dutch\s+(is\s+)?(required|needed|necessary)/i,
    /dutch\s+(language\s+)?(skills?\s+)?(are|is)?\s*not\s+(a\s+)?(requirement|must)/i,
    /don'?t\s+need\s+(to\s+speak\s+)?dutch/i,
    /without\s+(speaking\s+)?dutch/i
  ];

  const RE_PLUS = [
    /dutch\s+(language\s+)?(skills?\s+)?(is|are|would\s+be)\s+(a\s+)?(big\s+|strong\s+|definite\s+)?(plus|bonus|advantage|asset|nice[-\s]to[-\s]have|preferred|desirable|beneficial)/i,
    /(preferably|ideally)[^.]{0,40}\bdutch\b/i,
    /\bdutch\b[^.]{0,30}\bnice[-\s]to[-\s]have/i,
    /(knowledge\s+of|speaking)\s+dutch\s+is\s+(a\s+)?(plus|advantage|bonus|asset)/i
  ];

  const RE_REQUIRED = [
    /(fluent|fluency|proficient|proficiency|native|excellent|good|strong|professional|business)[^.]{0,30}\bdutch\b/i,
    /\bdutch\b[^.]{0,30}\b(?<!not\s)(fluent|fluency|proficiency|native|mandatory|required|must|essential)\b/i,
    /dutch[-\s]speaking/i,
    /must\s+(be\s+able\s+to\s+)?(speak|read|write)\s+.{0,20}\bdutch\b/i,
    /(command|mastery|knowledge)\s+of\s+(the\s+)?dutch(\s+language)?\s+(is\s+)?(required|essential|mandatory|a\s+must)/i,
    /nederlands(talig)?e?\s+(is\s+)?(vereist|verplicht)/i
  ];

  const RE_ENGLISH_HINT = [
    /english[-\s]speaking\s+(environment|team|company|office)/i,
    /(working|office|company|business)\s+language\s+is\s+english/i,
    /english\s+is\s+(our|the)\s+(working|official|company|main)\s+language/i,
    /all\s+communication\s+is\s+in\s+english/i
  ];

  const DUTCH_WORDS = new Set([
    "de", "het", "een", "en", "van", "voor", "met", "aan", "bij", "naar",
    "jij", "wij", "zij", "jouw", "onze", "deze", "dat", "niet", "ook",
    "werkzaamheden", "functie", "vereisten", "ervaring", "kennis",
    "zoeken", "bieden", "binnen", "over", "als", "worden", "hebben",
    "maar", "wat", "zijn", "collega", "salaris", "uur", "week", "sollicitatie"
  ]);

  function detectDutchLanguage(text) {
    const words = text.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
    if (words.length < 40) return false;
    let hits = 0;
    for (const w of words) if (DUTCH_WORDS.has(w)) hits++;
    return hits / words.length > 0.08;
  }

  function analyzeDutch(text) {
    for (const re of RE_NOT_REQUIRED)
      if (re.test(text)) return { level: "no", label: "无需荷兰语", detail: "职位明确说明不需要荷兰语" };
    // "Plus" wording beats "required" wording: phrases like "Dutch is a plus
    // but not essential" contain required-sounding words.
    for (const re of RE_PLUS)
      if (re.test(text)) return { level: "plus", label: "荷兰语加分", detail: "荷兰语是加分项，但不是硬性要求" };
    for (const re of RE_REQUIRED)
      if (re.test(text)) return { level: "required", label: "需要荷兰语", detail: "职位描述中要求荷兰语能力" };
    if (detectDutchLanguage(text))
      return { level: "required", label: "很可能需要荷兰语", detail: "职位描述本身是荷兰语写的" };
    if (/\bdutch\b/i.test(text))
      return { level: "unclear", label: "提到荷兰语，需自行确认", detail: "描述中出现 Dutch，但无法判断是否硬性要求" };
    for (const re of RE_ENGLISH_HINT)
      if (re.test(text)) return { level: "no", label: "英语工作环境", detail: "描述强调英语为工作语言" };
    return { level: "no", label: "未提及荷兰语", detail: "描述中没有荷兰语要求（建议面试时再确认）" };
  }

  // ---------- Seniority / experience detection ----------

  function titleSeniorityLevel(title) {
    if (!title) return null;
    const t = title.toLowerCase();
    if (/\b(intern|internship|trainee|working\s+student|werkstudent|stagiair)\b/.test(t)) return "intern";
    if (/\b(junior|jr\.?|graduate|entry[-\s]?level|starter|early\s+career)\b/.test(t)) return "junior";
    if (/\b(senior|sr\.?|lead|principal|staff|head|director|manager|expert|architect)\b/.test(t)) return "senior";
    if (/\b(medior|mid[-\s]?level|intermediate)\b/.test(t)) return "mid";
    return null;
  }

  function extractYears(text) {
    // Several requirements may be listed ("5+ years Python, 3+ years SQL");
    // the strictest one determines the seniority level.
    let max = null;
    const consider = n => {
      if (n >= 0 && n <= 20) max = max === null ? n : Math.max(max, n);
    };

    // Ranges first ("2-4 years", "3 to 5 years"): take the lower bound, and
    // remove the match so "0-2 years" can't re-match below as "2 years".
    const rest = text.replace(
      /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|—|to|tot)\s*\d{1,2}\s*(?:years?|yrs?|jaar)/gi,
      (m, low) => {
        consider(parseInt(low, 10));
        return " ";
      }
    );

    const patterns = [
      /(\d{1,2})\s*\+?\s*(?:years?|yrs?|jaar)[^.\n]{0,50}?(?:experience|ervaring)/gi,
      /(?:experience|ervaring)[^.\n]{0,40}?(\d{1,2})\s*\+?\s*(?:years?|yrs?|jaar)/gi,
      /(?:minimum|at\s+least|min\.?|minimaal|ten\s+minste)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?|jaar)/gi
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(rest))) consider(parseInt(m[1], 10));
    }
    return max;
  }

  function descSeniority(text) {
    const years = extractYears(text);
    let level = null;
    if (/\b(no\s+(?:prior\s+|previous\s+)?(?:work\s+)?experience\s+(?:is\s+)?(?:required|needed|necessary)|recent\s+graduates?|new\s+grads?|entry[-\s]?level|starters?\s+welcome)\b/i.test(text)) {
      level = "junior";
    } else if (years !== null) {
      level = years <= 2 ? "junior" : years <= 4 ? "mid" : "senior";
    }
    return { level, years };
  }

  // Title wording wins (a "Senior Data Scientist" posting is senior no matter
  // what years it lists); description-based detection fills the gaps.
  function combineSeniority(titleLevel, descSen) {
    const level = titleLevel || (descSen && descSen.level) || null;
    const years = descSen ? descSen.years : null;
    return { level, years };
  }

  const SEN_META = {
    intern: { icon: "🎓", label: "实习", cls: "ljh-cb-wait", pcls: "ljh-warn" },
    junior: { icon: "🌱", label: "Junior", cls: "ljh-cb-good", pcls: "ljh-good" },
    mid:    { icon: "🌿", label: "中级", cls: "ljh-cb-warn", pcls: "ljh-warn" },
    senior: { icon: "🌳", label: "Senior", cls: "ljh-cb-bad", pcls: "ljh-bad" }
  };

  function seniorityText(sen) {
    if (!sen || !sen.level) return null;
    const meta = SEN_META[sen.level];
    const yearsPart = sen.years !== null && sen.years > 0 ? ` (${sen.years}年+)` : "";
    return { ...meta, text: `${meta.icon} ${meta.label}${yearsPart}` };
  }

  // ---------- Resume match scoring (skill-dictionary based) ----------
  // Instead of raw word overlap, both the resume and the job description are
  // scanned against a curated skills dictionary (multi-word phrases included).
  // Only recognized skills count toward the score and appear in the lists.

  // Each entry: display name, then aliases. Matching is case-insensitive with
  // word boundaries; spaces also match hyphens ("machine-learning").
  const SKILL_DEFS = [
    // Programming languages
    ["Python"], ["SQL"], ["C++"], ["Java"], ["JavaScript", "typescript"],
    ["Scala"], ["MATLAB"], ["SAS"], ["Julia"], ["Rust"], ["Golang"],
    // ML / AI
    ["machine learning", "ML models", "ML engineering"],
    ["deep learning", "neural networks", "neural network"],
    ["NLP", "natural language processing", "text mining", "text analytics"],
    ["computer vision", "image recognition"],
    ["LLM", "LLMs", "large language model", "large language models", "generative AI", "GenAI"],
    ["RAG", "retrieval-augmented generation", "retrieval augmented generation"],
    ["embeddings", "word embeddings", "vector search"],
    ["transformers", "transformer models", "BERT", "GPT"],
    ["PyTorch"], ["TensorFlow"], ["Keras"], ["scikit-learn", "sklearn"],
    ["XGBoost", "gradient boosting", "LightGBM"],
    ["Hugging Face", "huggingface"], ["Gensim"], ["NLTK"], ["spaCy"],
    ["MLOps", "model deployment", "model monitoring"],
    ["recommendation systems", "recommender systems", "recommendation engine"],
    ["responsible AI", "AI ethics", "model fairness", "bias testing", "fairness testing"],
    // Statistics & experimentation
    ["statistics", "statistical analysis", "statistical modeling", "statistical methods"],
    ["A/B testing", "AB testing", "experimentation", "experiment design"],
    ["causal inference", "causality"],
    ["regression", "linear regression", "logistic regression"],
    ["econometrics", "econometric"],
    ["Bayesian", "bayesian statistics", "bayesian inference"],
    ["time series", "time-series", "forecasting"],
    ["hypothesis testing", "significance testing"],
    ["clustering", "k-means", "kmeans", "segmentation analysis"],
    ["classification", "text classification"],
    ["predictive modeling", "predictive models", "predictive analytics"],
    ["survey research", "survey data", "questionnaire"],
    // Data engineering
    ["ETL", "ELT", "data ingestion"],
    ["data pipelines", "data pipeline"],
    ["Spark", "PySpark", "Apache Spark"], ["Hadoop"], ["Kafka"],
    ["Airflow", "Apache Airflow"], ["dbt"], ["Databricks"],
    ["data warehouse", "data warehousing", "data lake"],
    ["data modeling", "data modelling"],
    ["data quality", "data validation", "data cleaning", "data wrangling"],
    ["big data"], ["web scraping", "scraping", "crawler"],
    // Databases
    ["PostgreSQL", "postgres"], ["MySQL"], ["MongoDB"], ["Redis"],
    ["DynamoDB"], ["NoSQL"], ["Elasticsearch"],
    // Cloud
    ["AWS", "Amazon Web Services"], ["Azure", "Microsoft Azure"],
    ["GCP", "Google Cloud"], ["S3"], ["EC2"], ["Lambda"],
    ["BigQuery"], ["Snowflake"], ["Redshift"], ["CloudWatch"],
    // Analytics & BI
    ["data analysis", "data analytics"], ["data science"],
    ["business intelligence", "BI tools"],
    ["Tableau"], ["Power BI", "powerbi"], ["Looker", "Looker Studio"],
    ["dashboards", "dashboard", "dashboarding", "reporting"],
    ["data visualization", "data visualisation", "Matplotlib", "seaborn", "ggplot2", "Plotly"],
    ["Excel", "Microsoft Excel", "spreadsheets"],
    ["Google Analytics"], ["KPI", "KPIs", "metrics"],
    // Software engineering
    ["Git", "GitHub", "GitLab", "version control"],
    ["Docker", "containers", "containerization"], ["Kubernetes", "k8s"],
    ["CI/CD", "continuous integration", "continuous deployment"],
    ["API", "APIs", "REST API", "RESTful"], ["microservices"],
    ["Linux", "Unix", "bash", "shell scripting"],
    ["unit testing", "pytest", "unittest", "integration testing", "test automation"],
    ["React"], ["Node.js", "nodejs"], ["Django"], ["Flask"],
    ["pandas"], ["NumPy"],
    // Ways of working & soft skills
    ["Agile", "Scrum", "Kanban", "sprint"],
    ["stakeholder management", "stakeholder communication", "stakeholders"],
    ["cross-functional", "cross functional"],
    ["project management"],
    ["communication skills", "communication", "presentation skills", "presentations"],
    ["problem solving", "problem-solving", "analytical thinking", "analytical skills"],
    ["research", "academic research", "quantitative research"],
    ["consulting", "advisory"],
    ["mentoring", "coaching", "teaching"]
  ];

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function aliasToRegex(alias) {
    const body = escapeRe(alias).replace(/\s+/g, "[\\s\\u00A0-]+");
    return new RegExp("(?<![A-Za-z0-9+#])" + body + "(?![A-Za-z0-9])", "i");
  }

  // "R" needs a case-sensitive rule or it matches everywhere.
  const SKILLS = SKILL_DEFS.map(aliases => ({
    name: aliases[0],
    regexes: aliases.map(aliasToRegex)
  }));
  SKILLS.push({ name: "R", regexes: [/(?<![A-Za-z0-9+#])R(?=[\s,;/)&.]|$)(?![A-Za-z0-9])/] });

  function findSkills(text) {
    const found = new Set();
    for (const s of SKILLS) {
      if (s.regexes.some(re => re.test(text))) found.add(s.name);
    }
    return found;
  }

  let resumeSkills = new Set();

  function analyzeMatch(jobText) {
    if (resumeSkills.size === 0 && extraKeywords.length === 0) return null;

    const jobSkills = findSkills(jobText);

    // User-declared extra keywords: treated as skills the user has (weight 2)
    // whenever they appear in the job description.
    const extraInJob = extraKeywords.filter(kw => {
      try {
        return aliasToRegex(kw).test(jobText);
      } catch {
        return jobText.toLowerCase().includes(kw.toLowerCase());
      }
    });

    // A dictionary skill counts as "you have it" if it's in the resume OR the
    // user declared it as an extra keyword.
    const coveredByExtra = s =>
      extraKeywords.some(kw => {
        if (kw.toLowerCase() === s.toLowerCase()) return true;
        try {
          return aliasToRegex(kw).test(s);
        } catch {
          return false;
        }
      });

    const matched = [];
    const missing = [];
    for (const s of jobSkills) {
      (resumeSkills.has(s) || coveredByExtra(s) ? matched : missing).push(s);
    }
    // Extra-keyword hits not already represented by a dictionary skill
    const lowerMatched = new Set(matched.map(m => m.toLowerCase()));
    const extraMatched = extraInJob.filter(
      kw => !lowerMatched.has(kw.toLowerCase()) && ![...jobSkills].some(s => coveredByExtra(s) && s.toLowerCase() === kw.toLowerCase())
    );

    const totalWeight = jobSkills.size + 2 * extraMatched.length;
    if (totalWeight === 0) return { score: null, matched: [], missing: [] };

    const matchedWeight = matched.length + 2 * extraMatched.length;
    const score = Math.min(100, Math.round((100 * matchedWeight) / totalWeight));

    return {
      score,
      matched: [...extraMatched, ...matched].slice(0, 14),
      missing: missing.slice(0, 10)
    };
  }

  // ---------- Find the job description in the page ----------

  const DESC_SELECTORS = [
    "#job-details",
    ".jobs-description__content",
    ".jobs-box__html-content",
    ".jobs-description-content__text",
    ".description__text",
    "[class*='jobs-description']",
    ".jobs-search__job-details--container article",
    ".job-view-layout article"
  ];

  function getJobDescription() {
    for (const sel of DESC_SELECTORS) {
      let el;
      try {
        el = document.querySelector(sel);
      } catch {
        continue;
      }
      if (el && el.innerText && el.innerText.trim().length > 200) {
        log("description found via selector:", sel);
        return el.innerText;
      }
    }

    // Fallback: find an "About the job" (or localized) heading and read its container.
    const headings = document.querySelectorAll("h2, h3");
    for (const h of headings) {
      const t = (h.innerText || "").trim().toLowerCase();
      if (
        t === "about the job" || t === "over de functie" ||
        t.includes("关于该职位") || t.includes("关于职位")
      ) {
        let container = h.parentElement;
        for (let i = 0; i < 4 && container; i++) {
          if (container.innerText && container.innerText.trim().length > 300) {
            log("description found via heading fallback");
            return container.innerText;
          }
          container = container.parentElement;
        }
      }
    }
    return null;
  }

  function getJobTitle() {
    const el = document.querySelector(
      ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .top-card-layout__title, [class*='job-title'] h1, h1"
    );
    return el ? el.innerText.trim() : "";
  }

  function onJobPage() {
    return location.pathname.includes("/jobs/") || location.search.includes("currentJobId=");
  }

  // ---------- Panel UI ----------

  function renderPanel(html) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }
    panel.innerHTML = html;
    const closeBtn = panel.querySelector(".ljh-close");
    if (closeBtn) closeBtn.onclick = () => panel.remove();
    const optBtn = panel.querySelector(".ljh-options");
    if (optBtn) optBtn.onclick = () => chrome.runtime.sendMessage({ type: "open-options" });
    return panel;
  }

  function renderResults(dutch, match, title, sen) {
    const dutchClass = { no: "ljh-good", plus: "ljh-warn", unclear: "ljh-warn", required: "ljh-bad" }[dutch.level];

    const senT = seniorityText(sen);
    const senHtml = senT
      ? `<div class="ljh-row"><span class="ljh-badge ${senT.pcls}">${senT.icon} ${senT.label}${
          sen.years !== null && sen.years > 0 ? ` · 要求约 ${sen.years}+ 年经验` : ""
        }</span></div>`
      : `<div class="ljh-kw ljh-dim">未识别出明确的资历/经验要求</div>`;

    let matchHtml;
    if (!match) {
      matchHtml = `<div class="ljh-kw ljh-dim">尚未保存简历 — 点击下方按钮，在设置页粘贴你的简历文本。</div>`;
    } else if (match.score === null) {
      matchHtml = `<div class="ljh-kw ljh-dim">该职位描述中未识别出可对比的技能关键词。</div>`;
    } else {
      const scoreClass = match.score >= 55 ? "ljh-good" : match.score >= 35 ? "ljh-warn" : "ljh-bad";
      matchHtml = `
        <div class="ljh-row"><span class="ljh-badge ${scoreClass}">技能匹配 ${match.score}%</span></div>
        ${match.matched.length ? `<div class="ljh-kw"><b>✓ 你具备:</b> ${match.matched.join(", ")}</div>` : ""}
        ${match.missing.length ? `<div class="ljh-kw ljh-dim"><b>✗ 职位要求但简历未提及:</b> ${match.missing.join(", ")}</div>` : ""}`;
    }

    renderPanel(`
      <div class="ljh-header">
        <span class="ljh-title">${title || "当前职位"}</span>
        <button class="ljh-close" title="关闭">×</button>
      </div>
      <div class="ljh-row"><span class="ljh-badge ${dutchClass}">${dutch.label}</span></div>
      <div class="ljh-kw ljh-dim">${dutch.detail}</div>
      ${senHtml}
      ${matchHtml}
      <button class="ljh-options">打开设置（保存简历）</button>`);
  }

  function renderNoDescription() {
    renderPanel(`
      <div class="ljh-header">
        <span class="ljh-title">LinkedIn Job Helper</span>
        <button class="ljh-close" title="关闭">×</button>
      </div>
      <div class="ljh-kw ljh-dim">插件已运行，但没能在页面上找到职位描述。请点开一个具体职位；如果已点开仍看到本提示，说明 LinkedIn 改了页面结构，请反馈。</div>`);
  }

  // ---------- List-view annotation ----------
  // Fetches each visible job's description through LinkedIn's own job-posting
  // endpoint (same session, throttled to ~1 request/second, cached for 7 days)
  // and puts a badge directly on every card in the list.

  const CACHE_KEY = "ljhJobCache2";
  const CACHE_TTL = 7 * 24 * 3600 * 1000;
  const jobCache = new Map(); // id -> {dutch, score, ts} or {failed: true}
  let cacheLoaded = false;
  let cacheSaveTimer = null;
  const fetchQueue = [];
  const queued = new Set();
  let fetching = false;

  function loadCache(cb) {
    chrome.storage.local.get([CACHE_KEY], data => {
      const stored = data[CACHE_KEY] || {};
      const now = Date.now();
      for (const [id, v] of Object.entries(stored)) {
        if (v && v.ts && now - v.ts < CACHE_TTL) jobCache.set(id, v);
      }
      cacheLoaded = true;
      log("job cache loaded:", jobCache.size, "entries");
      cb && cb();
    });
  }

  function saveCacheSoon() {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = setTimeout(() => {
      const obj = {};
      let entries = [...jobCache.entries()].filter(([, v]) => !v.failed);
      // Cap stored entries; keep the most recent.
      entries.sort((a, b) => b[1].ts - a[1].ts);
      for (const [id, v] of entries.slice(0, 600)) obj[id] = v;
      chrome.storage.local.set({ [CACHE_KEY]: obj });
    }, 4000);
  }

  function getCsrfToken() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    return m ? m[1] : null;
  }

  function deepFindDescription(obj) {
    let best = "";
    let bestAnyText = "";
    const visit = o => {
      if (!o || typeof o !== "object") return;
      const d = o.description;
      if (d && typeof d.text === "string" && d.text.length > best.length) best = d.text;
      if (typeof o.text === "string" && o.text.length > bestAnyText.length) bestAnyText = o.text;
      for (const k in o) visit(o[k]);
    };
    visit(obj);
    return best || bestAnyText;
  }

  async function fetchJobDescription(id) {
    const csrf = getCsrfToken();
    if (csrf) {
      const urls = [
        `/voyager/api/jobs/jobPostings/${id}?decorationId=com.linkedin.voyager.deco.jobs.web.shared.WebFullJobPosting-65`,
        `/voyager/api/jobs/jobPostings/${id}`
      ];
      for (const url of urls) {
        try {
          const r = await fetch(url, {
            headers: { "csrf-token": csrf, accept: "application/json" },
            credentials: "include"
          });
          if (r.ok) {
            const d = deepFindDescription(await r.json());
            if (d && d.length > 100) return d;
          }
        } catch (e) {
          log("voyager fetch failed for", id, e);
        }
      }
    }
    // Fallback: public guest endpoint (works for public postings).
    try {
      const r = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
      if (r.ok) {
        const doc = new DOMParser().parseFromString(await r.text(), "text/html");
        const el = doc.querySelector(".show-more-less-html__markup, .description__text");
        if (el && el.innerText.trim().length > 100) return el.innerText;
      }
    } catch (e) {
      log("guest fetch failed for", id, e);
    }
    return null;
  }

  async function processQueue() {
    if (fetching) return;
    fetching = true;
    while (fetchQueue.length > 0) {
      const id = fetchQueue.shift();
      queued.delete(id);
      if (jobCache.has(id)) continue;
      const desc = await fetchJobDescription(id);
      if (desc) {
        const dutch = analyzeDutch(desc);
        const match = analyzeMatch(desc);
        jobCache.set(id, {
          dutch: { level: dutch.level, label: dutch.label },
          score: match && match.score !== null ? match.score : null,
          sen: descSeniority(desc),
          ts: Date.now()
        });
        saveCacheSoon();
      } else {
        jobCache.set(id, { failed: true, ts: Date.now() });
        log("could not get description for job", id);
      }
      decorateCards();
      // Throttle: be a polite citizen (~1 req/sec with jitter).
      await new Promise(res => setTimeout(res, 800 + Math.random() * 600));
    }
    fetching = false;
  }

  function findCards() {
    const seen = new Map(); // id -> card element
    for (const el of document.querySelectorAll("li[data-occludable-job-id], [data-job-id]")) {
      const id = el.getAttribute("data-occludable-job-id") || el.getAttribute("data-job-id");
      if (id && /^\d+$/.test(id) && !seen.has(id)) seen.set(id, el);
    }
    return seen;
  }

  function cardTitle(card) {
    const el = card.querySelector(
      ".job-card-list__title, .job-card-container__link, a[class*='job-card'], a strong, a"
    );
    const t = el ? el.getAttribute("aria-label") || el.innerText : card.innerText.split("\n")[0];
    return (t || "").trim();
  }

  function badgeHtml(entry, sen) {
    if (!entry) return `<span class="ljh-cb ljh-cb-wait">⏳ 分析中…</span>`;
    if (entry.failed) return `<span class="ljh-cb ljh-cb-wait">无法获取描述</span>`;
    const { level, label } = entry.dutch;
    const icon = { no: "🟢", plus: "🟡", unclear: "🟡", required: "🔴" }[level] || "⚪";
    const cls = { no: "ljh-cb-good", plus: "ljh-cb-warn", unclear: "ljh-cb-warn", required: "ljh-cb-bad" }[level] || "";
    const scorePart = entry.score !== null && entry.score !== undefined
      ? ` · 匹配 ${entry.score}%` : "";
    const senT = seniorityText(sen);
    const senPart = senT ? ` <span class="ljh-cb ${senT.cls}">${senT.text}</span>` : "";
    return `<span class="ljh-cb ${cls}">${icon} ${label}${scorePart}</span>${senPart}`;
  }

  function decorateCards() {
    if (!onJobPage()) return;
    const cards = findCards();
    for (const [id, card] of cards) {
      const entry = jobCache.get(id);
      const sen = entry && !entry.failed
        ? combineSeniority(titleSeniorityLevel(cardTitle(card)), entry.sen)
        : null;

      // LinkedIn recycles list DOM nodes while scrolling, so re-check the id.
      let badge = card.querySelector(":scope .ljh-card-badge");
      const state = entry
        ? (entry.failed ? "failed" : "done-" + (entry.score ?? "x") + "-" + (sen && sen.level ? sen.level : "n"))
        : "pending";
      if (badge && badge.dataset.ljhId === id && badge.dataset.ljhState === state) continue;

      if (!badge) {
        badge = document.createElement("div");
        badge.className = "ljh-card-badge";
        card.appendChild(badge);
      }
      badge.dataset.ljhId = id;
      badge.dataset.ljhState = state;
      badge.innerHTML = badgeHtml(entry, sen);

      if (!entry && !queued.has(id)) {
        queued.add(id);
        fetchQueue.push(id);
      }
    }
    if (fetchQueue.length > 0 && cacheLoaded) processQueue();
  }

  // ---------- Main loop ----------

  function analyze() {
    if (!onJobPage()) {
      noDescSince = null;
      return;
    }

    const desc = getJobDescription();
    if (!desc) {
      // If we've been on a job page for a while without finding a description,
      // show a diagnostic panel so "nothing happens" is distinguishable from
      // "extension not running".
      if (!noDescSince) noDescSince = Date.now();
      else if (Date.now() - noDescSince > 4000 && !document.getElementById(PANEL_ID)) {
        log("no job description found; selectors likely outdated");
        renderNoDescription();
      }
      return;
    }
    noDescSince = null;

    const title = getJobTitle();
    const key = title + "::" + desc.length;
    if (key === lastAnalyzedKey) return;
    lastAnalyzedKey = key;

    log("analyzing job:", title, "desc length:", desc.length);
    const sen = combineSeniority(titleSeniorityLevel(title), descSeniority(desc));
    renderResults(analyzeDutch(desc), analyzeMatch(desc), title, sen);
  }

  function loadSettings(cb) {
    chrome.storage.local.get(["resumeText", "extraKeywords"], data => {
      resumeSkills = findSkills(data.resumeText || "");
      extraKeywords = (data.extraKeywords || "")
        .split(/[,，\n]/)
        .map(s => s.trim())
        .filter(Boolean);
      log("settings loaded; resume skills:", [...resumeSkills], "extra keywords:", extraKeywords.length);
      cb && cb();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    // Ignore our own cache writes; react only to settings edits.
    if (area !== "local" || (!changes.resumeText && !changes.extraKeywords)) return;
    loadSettings(() => {
      lastAnalyzedKey = "";
      // Cached per-job scores were computed against the old resume.
      jobCache.clear();
      chrome.storage.local.remove(CACHE_KEY);
      analyze();
      decorateCards();
    });
  });

  // LinkedIn is a SPA: re-check on DOM mutations (debounced) and on URL changes.
  let debounce = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      analyze();
      decorateCards();
    }, 600);
  });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastAnalyzedKey = "";
      analyze();
      decorateCards();
    }
  }, 800);

  loadSettings(() =>
    loadCache(() => {
      analyze();
      decorateCards();
      observer.observe(document.body, { childList: true, subtree: true });
    })
  );
})();
