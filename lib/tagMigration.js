// ─── 태그 규칙 통일 (1회성 정리) ───
// 규칙
//   과목 태그: 대문자+숫자 (BIOL1030)
//   출처 태그: 과목-단원 (W1, Lec1, Ch1, Sec1.1 — 숫자 앞에 0 안 붙임), 세부는 "-" 한 단계 더
//   분류 태그: 모든 단어에 "전공용어" 또는 "일반" 하나 + 세부 분야 태그(해부학, 실존주의 등)

export const MAJOR_TAG = "전공용어";
export const GENERAL_TAG = "일반";

// 이 태그가 있으면 "일반" 단어로 본다 (이름만 다르고 같은 뜻)
const GENERAL_ALIASES = new Set(["일반", "학술영어", "학술어휘"]);

// 과목 태그와 같은 정보라서 지우는 과목 이름 태그
const REMOVE_TAGS = new Set(["생물학", "음악", "통계", "철학", "글쓰기", "수학"]);

// 이름이 겹치는 분류 태그 합치기
const MERGE_TAGS = { 윤리: "윤리학" };

const SUBJECT_RE = /^[A-Z]+\d+$/;

// 출처 태그 표기 통일: COURSE-Week01 / COURSE-W01 → COURSE-W1 (뒤에 붙은 세부 단원은 유지)
export function normalizeSourceTag(tag) {
  const m = tag.match(/^([A-Z]+\d+)-(?:Week|W)0*(\d+)(-.*)?$/);
  if (!m) return tag;
  return `${m[1]}-W${m[2]}${m[3] || ""}`;
}

// MATH1040 단어 중 출처 태그가 빠진 단어의 섹션 (json 원본 파일 기준)
export const MATH1040_SECTION_BY_TERM = {
  "actuary": "Sec9.1",
  "addition rule": "Sec3.3",
  "advisory committee": "Sec3.4",
  "approximately normal": "Sec5.4",
  "area under the curve": "Sec5.2",
  "at least": "Sec4.2",
  "at least one": "Sec3.2",
  "at most": "Sec4.2",
  "attribute": "Sec1.2",
  "bell-shaped": "Sec5.1",
  "bell-shaped distribution": "Sec2.4",
  "best predicted value": "Sec9.2",
  "between": "Sec5.1",
  "bimodal": "Sec2.3",
  "binomial distribution mean (μ = np)": "Sec4.2",
  "binomial distribution standard deviation (σ = √npq)": "Sec4.2",
  "binomial distribution variance (σ² = npq)": "Sec4.2",
  "binomial experiment": "Sec4.2",
  "binomial probability formula": "Sec4.2",
  "blinding": "Sec1.3",
  "bottom percent / lowest percent": "Sec5.3",
  "box-and-whisker plot": "Sec2.5",
  "braking distance": "Sec5.3",
  "btu (british thermal unit)": "Sec9.2",
  "carbon dioxide emissions": "Sec9.2",
  "central limit theorem (clt)": "Sec5.4",
  "chebyshev's theorem": "Sec2.4",
  "class": "Sec2.1",
  "class boundary": "Sec2.1",
  "class width": "Sec2.1",
  "classical probability": "Sec3.1",
  "classify": "Sec1.1",
  "cluster sample": "Sec1.3",
  "coefficient": "Sec9.2",
  "coefficient of determination (r²)": "Sec9.2",
  "coefficient of variation": "Sec2.4",
  "cohabitation": "Sec1.1",
  "combination": "Sec3.4",
  "commute": "Sec4.2",
  "complement": "Sec3.1",
  "conditional probability": "Sec3.2",
  "confer": "Sec2.2",
  "conferred": "Sec3.1",
  "confounding variable": "Sec1.3",
  "consecutive": "Sec2.1",
  "contingency table": "Sec3.2",
  "continuous random variable": "Sec4.1",
  "control group": "Sec1.3",
  "convenience sample": "Sec1.3",
  "correlation": "Sec9.1",
  "correlation coefficient (r)": "Sec9.1",
  "corrupt": "Sec3.3",
  "countable": "Sec4.1",
  "cumulative area": "Sec5.1",
  "cumulative frequency": "Sec2.1",
  "data": "Sec1.1",
  "data point": "Sec9.2",
  "death penalty": "Sec3.3",
  "decile": "Sec2.5",
  "defective": "Sec3.4",
  "dependent events": "Sec3.2",
  "dependent variable (y)": "Sec9.1",
  "descriptive statistics": "Sec1.1",
  "deviation": "Sec2.4",
  "discrete probability distribution": "Sec4.1",
  "discrete random variable": "Sec4.1",
  "distinct": "Sec3.4",
  "distinguishable permutations": "Sec3.4",
  "divisible": "Sec3.1",
  "dot plot": "Sec2.2",
  "double-blind experiment": "Sec1.3",
  "draw a conclusion": "Sec1.1",
  "elliptical cross trainer": "Sec5.2",
  "empirical probability": "Sec3.1",
  "empirical rule": "Sec2.4",
  "energy-efficiency rating": "Sec9.2",
  "enrollment": "Sec1.2",
  "equally likely": "Sec3.1",
  "event": "Sec3.1",
  "expected number": "Sec5.2",
  "expected value": "Sec4.1",
  "experiment": "Sec1.3",
  "explanatory variable": "Sec9.1",
  "extrapolation": "Sec9.2",
  "face card": "Sec3.3",
  "factorial": "Sec3.4",
  "failure (f)": "Sec4.2",
  "favor": "Sec3.3",
  "fewer than": "Sec4.2",
  "finding value given a probability": "Sec5.3",
  "first offense": "Sec4.2",
  "five-number summary": "Sec2.5",
  "fractile": "Sec2.5",
  "frequency": "Sec2.1",
  "frequency distribution": "Sec2.1",
  "frequency polygon": "Sec2.1",
  "fundamental counting principle": "Sec3.1",
  "gestation period": "Sec9.2",
  "geyser": "Sec9.1",
  "gross domestic product (gdp)": "Sec9.1",
  "guarantee": "Sec5.3",
  "histogram": "Sec2.1",
  "inclusive": "Sec3.1",
  "independent events": "Sec3.2",
  "independent variable (x)": "Sec9.1",
  "inferential statistics": "Sec1.1",
  "inflection points": "Sec5.1",
  "intercept function": "Sec9.2",
  "interpolation": "Sec9.2",
  "interquartile range": "Sec2.5",
  "interval": "Sec5.2",
  "interval level": "Sec1.2",
  "inverse normal (z-table 역방향 읽기)": "Sec5.3",
  "jury selection pool": "Sec3.2",
  "laid off": "Sec5.3",
  "law of large numbers": "Sec3.1",
  "least-squares method": "Sec9.2",
  "level of measurement": "Sec1.2",
  "life expectancy": "Sec5.3",
  "life span": "Sec9.2",
  "line of best fit": "Sec9.2",
  "linear regression": "Sec9.2",
  "linreg": "Sec9.2",
  "load-bearing capacity": "Sec5.4",
  "lower class limit": "Sec2.1",
  "mean": "Sec2.3",
  "mean of probability distribution (μ)": "Sec4.1",
  "mean of x (x̄)": "Sec9.2",
  "mean of y (ȳ)": "Sec9.2",
  "measure of central tendency": "Sec2.3",
  "median": "Sec2.3",
  "midpoint": "Sec2.1",
  "midrange": "Sec2.3",
  "milligrams per deciliter (mg/dl)": "Sec5.2",
  "minitab": "Sec9.2",
  "mode": "Sec2.3",
  "more than": "Sec4.2",
  "multiple choice": "Sec3.2",
  "multiple regression": "Sec9.2",
  "multiplication rule": "Sec3.2",
  "mutually exclusive events": "Sec3.3",
  "n (number of trials)": "Sec4.2",
  "ncr (combination formula)": "Sec3.4",
  "negative correlation": "Sec9.2",
  "negative linear correlation": "Sec9.1",
  "no correlation": "Sec9.1",
  "nominal level": "Sec1.2",
  "nondefective": "Sec3.4",
  "nonlinear correlation": "Sec9.1",
  "nonnumerical": "Sec1.2",
  "normal curve": "Sec5.1",
  "normal distribution": "Sec5.1",
  "normally distributed": "Sec5.1",
  "not mutually exclusive": "Sec3.3",
  "npr (permutation formula)": "Sec3.4",
  "numerical value": "Sec1.1",
  "observational study": "Sec1.3",
  "observed y-value": "Sec9.2",
  "ogive": "Sec2.1",
  "old faithful": "Sec9.2",
  "ordered arrangement": "Sec3.4",
  "ordered pair": "Sec2.2",
  "ordered pairs": "Sec9.1",
  "ordinal level": "Sec1.2",
  "outcome": "Sec3.1",
  "outlier": "Sec2.3",
  "p (probability of success)": "Sec4.2",
  "p(a and b)": "Sec3.3",
  "p(a or b)": "Sec3.3",
  "pairs of data": "Sec9.2",
  "parameter": "Sec1.1",
  "pareto chart": "Sec2.2",
  "partition": "Sec2.5",
  "percentile": "Sec2.5",
  "perfect correlation": "Sec9.1",
  "permutation": "Sec3.4",
  "pie chart": "Sec2.2",
  "placebo": "Sec1.3",
  "placebo effect": "Sec1.3",
  "population": "Sec1.1",
  "population mean (μ)": "Sec5.4",
  "population standard deviation (σ)": "Sec5.4",
  "positive correlation": "Sec9.2",
  "positive linear correlation": "Sec9.1",
  "predict": "Sec9.2",
  "predicted y-value (ŷ)": "Sec9.2",
  "prediction interval": "Sec9.2",
  "prime number": "Sec3.3",
  "probability": "Sec1.1",
  "probability density function (pdf)": "Sec5.1",
  "probability distribution": "Sec4.1",
  "probability experiment": "Sec3.1",
  "probationary period": "Sec4.1",
  "proficiency exam": "Sec9.2",
  "proportional": "Sec2.2",
  "q (probability of failure)": "Sec4.2",
  "qualitative data": "Sec1.2",
  "quantitative data": "Sec1.2",
  "quartile": "Sec2.5",
  "raffle": "Sec4.1",
  "random variable": "Sec4.1",
  "randomization": "Sec1.3",
  "randomly selected": "Sec3.2",
  "range": "Sec2.1",
  "range of probability": "Sec3.1",
  "ratio level": "Sec1.2",
  "regression equation": "Sec9.2",
  "regression line": "Sec9.2",
  "relative frequency": "Sec2.1",
  "replication": "Sec1.3",
  "representative": "Sec1.3",
  "residual": "Sec9.2",
  "respondent": "Sec1.1",
  "response variable": "Sec9.1",
  "role model": "Sec3.2",
  "roulette": "Sec4.1",
  "sample": "Sec1.1",
  "sample size (n)": "Sec5.4",
  "sample space": "Sec3.1",
  "sample statistic": "Sec5.4",
  "sampling distribution": "Sec5.4",
  "sampling distribution of sample means": "Sec5.4",
  "scatter plot": "Sec2.2",
  "sector": "Sec2.2",
  "seniority": "Sec5.3",
  "sequence": "Sec3.1",
  "shipment": "Sec3.4",
  "sigma notation": "Sec2.3",
  "significant (linear correlation)": "Sec9.2",
  "simple event": "Sec3.1",
  "simple random sample": "Sec1.3",
  "simulation": "Sec1.3",
  "skewed left": "Sec2.3",
  "skewed right": "Sec2.3",
  "slope (m)": "Sec9.2",
  "slope function": "Sec9.2",
  "spread out": "Sec2.4",
  "standard deck of cards": "Sec3.1",
  "standard deviation": "Sec2.4",
  "standard deviation of probability distribution (σ)": "Sec4.1",
  "standard error of the mean": "Sec5.4",
  "standard normal distribution": "Sec5.1",
  "standard normal table (z-table)": "Sec5.1",
  "statistic": "Sec1.1",
  "statistics": "Sec1.1",
  "stem-and-leaf plot": "Sec2.2",
  "stratified sample": "Sec1.3",
  "strong correlation": "Sec9.1",
  "subdivision": "Sec3.4",
  "subjective probability": "Sec3.1",
  "subset": "Sec1.1",
  "success (s)": "Sec4.2",
  "successively": "Sec3.2",
  "sum of squares": "Sec2.4",
  "sum of squares of residuals": "Sec9.2",
  "summation notation (σ)": "Sec9.2",
  "symmetric": "Sec5.1",
  "symmetric distribution": "Sec2.3",
  "systematic sample": "Sec1.3",
  "systolic blood pressure": "Sec9.2",
  "time series chart": "Sec2.2",
  "to the left of": "Sec5.1",
  "to the right of": "Sec5.1",
  "transformation": "Sec5.2",
  "transforming z-score to x-value": "Sec5.3",
  "treatment group": "Sec1.3",
  "tree diagram": "Sec3.1",
  "trend": "Sec2.2",
  "trial": "Sec3.1",
  "triglyceride": "Sec5.2",
  "trimmed mean": "Sec2.3",
  "true zero": "Sec1.2",
  "unbiased": "Sec4.2",
  "uncountable": "Sec4.1",
  "uniform distribution": "Sec2.3",
  "unusual": "Sec2.5",
  "unusual event": "Sec3.2",
  "upper class limit": "Sec2.1",
  "upper percent / top percent": "Sec5.3",
  "vacant": "Sec3.4",
  "variance": "Sec2.4",
  "variance of probability distribution (σ²)": "Sec4.1",
  "variation": "Sec2.4",
  "venn diagram": "Sec3.3",
  "weak correlation": "Sec9.1",
  "weighted mean": "Sec2.3",
  "with repetition": "Sec3.1",
  "with replacement": "Sec3.2",
  "without regard to order": "Sec3.4",
  "without repetition": "Sec3.1",
  "without replacement": "Sec3.2",
  "y-intercept (b)": "Sec9.2",
  "yield": "Sec9.2",
  "z-score": "Sec2.5",
  "z-score for sample means": "Sec5.4"
};

function hasSourceTag(tags, subject) {
  return tags.some((t) => t.startsWith(subject + "-"));
}

// 단어 하나의 태그를 새 규칙으로 바꾼 결과
export function migrateWordTags(word) {
  const original = word.tags || [];
  const isGeneral = original.some((t) => GENERAL_ALIASES.has(t));
  const out = [];
  const push = (t) => {
    if (t && !out.includes(t)) out.push(t);
  };

  original.forEach((raw) => {
    const t = (raw || "").trim();
    if (!t) return;
    if (GENERAL_ALIASES.has(t) || REMOVE_TAGS.has(t)) return;
    if (t === MAJOR_TAG) return;
    if (MERGE_TAGS[t]) return push(MERGE_TAGS[t]);
    if (t.includes("-")) return push(normalizeSourceTag(t));
    push(t);
  });

  // 출처 태그가 빠진 MATH1040 단어는 원본 파일의 섹션으로 채우기
  if (out.includes("MATH1040") && !hasSourceTag(out, "MATH1040")) {
    const sec = MATH1040_SECTION_BY_TERM[(word.term || "").trim().toLowerCase()];
    if (sec) push(`MATH1040-${sec}`);
  }

  // 순서: 과목 → 출처 → 전공용어/일반 → 세부 분야
  const subjects = out.filter((t) => SUBJECT_RE.test(t));
  const sources = out.filter((t) => t.includes("-"));
  const topics = out.filter((t) => !SUBJECT_RE.test(t) && !t.includes("-"));
  return [...subjects, ...sources, isGeneral ? GENERAL_TAG : MAJOR_TAG, ...topics];
}

function sameTags(a, b) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

// 전체 단어에 적용: { next, changed(바뀐 단어 목록), missingSource(출처 태그 없는 단어 수) }
export function migrateAllTags(words) {
  const changed = [];
  const next = words.map((w) => {
    const tags = migrateWordTags(w);
    if (sameTags(tags, w.tags || [])) return w;
    const updated = { ...w, tags };
    changed.push(updated);
    return updated;
  });
  const missingSource = next.filter((w) => {
    const subject = (w.tags || []).find((t) => SUBJECT_RE.test(t));
    return !subject || !hasSourceTag(w.tags, subject);
  }).length;
  return { next, changed, missingSource };
}

// ─── 노션 태그 점검: 노션에 옵션으로만 남아 있고 어떤 단어에도 안 쓰이는 태그 ───
export function findUnusedTagOptions(options, words) {
  const used = new Set();
  words.forEach((w) => (w.tags || []).forEach((t) => used.add(t)));
  const unused = options
    .filter((name) => !used.has(name))
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  return { unused, total: options.length, usedCount: options.length - unused.length };
}
