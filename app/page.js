"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  planSync,
  mergeFull,
  mergeIncremental,
  applyUploadedIds,
  chunk,
  isNotionId,
  BULK_CHUNK_SIZE,
} from "@/lib/sync";
import { migrateAllTags, findUnusedTagOptions } from "@/lib/tagMigration";

// ─── Utils ───
const STORAGE_KEY = "vocab-notebook-words";
const THEME_KEY = "vocab-theme";
const NOTION_KEY = "vocab-notion-credentials";
const SYNC_META_KEY = "vocab-notion-sync-meta"; // { dbId, lastSync, lastFullSync }

function loadSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || null;
  } catch {
    return null;
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Star SVG ───
function StarSvg({ filled, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill={filled ? "var(--accent)" : "transparent"}
        stroke={filled ? "var(--accent)" : "var(--text-muted)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function Stars({ rating, interactive = false, onRate, size = 14 }) {
  return (
    <div className="stars">
      {[1, 2, 3].map((i) => (
        <button
          key={i}
          className={`star${interactive ? "" : " readonly"}`}
          onClick={
            interactive
              ? (e) => {
                  e.stopPropagation();
                  onRate(i === rating ? 0 : i);
                }
              : undefined
          }
        >
          <StarSvg filled={i <= rating} size={size} />
        </button>
      ))}
    </div>
  );
}

// ─── Toast ───
function Toast({ message, show }) {
  return <div className={`toast${show ? " show" : ""}`}>{message}</div>;
}

// ─── Main App ───
export default function VocabApp() {
  const [words, setWords] = useState([]);
  const [view, setView] = useState("list"); // list | add | edit | quiz
  const [editWord, setEditWord] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState(0);
  const [sortBy, setSortBy] = useState("newest");
  const [expandedId, setExpandedId] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | success | error
  const [syncProgress, setSyncProgress] = useState(null); // { done, total } 대량 업로드 진행률
  const uploadingRef = useRef(false);
  const promotingRef = useRef(false);
  const [tagAudit, setTagAudit] = useState(null); // { unused, total, usedCount } 노션 태그 점검 결과
  const [busy, setBusy] = useState(null); // 진행 중인 작업 설명 (로딩 표시용)
  const [installPrompt, setInstallPrompt] = useState(null); // 앱 설치 안내 이벤트
  const [notionTagOptions, setNotionTagOptions] = useState(null); // 노션 DB에 등록된 태그 옵션 이름
  const [notionTagRebuilding, setNotionTagRebuilding] = useState(false); // 중간에 멈춘 태그 정리가 있는지
  const wordsRef = useRef([]);
  useEffect(() => {
    wordsRef.current = words;
  }, [words]);
  const [toast, setToast] = useState({ message: "", show: false });

  // Quiz state
  const [quizMode, setQuizMode] = useState(null);
  const [quizPool, setQuizPool] = useState([]);
  const [quizCurrent, setQuizCurrent] = useState(0);
  const [quizShowAnswer, setQuizShowAnswer] = useState(false);
  const [quizScore, setQuizScore] = useState({ correct: 0, wrong: 0 });
  const [quizFinished, setQuizFinished] = useState(false);

  // Form state
  const [formTags, setFormTags] = useState([]);
  const [formDifficulty, setFormDifficulty] = useState(0);
  const [tagInput, setTagInput] = useState("");

  // Theme
  const [theme, setTheme] = useState("dark");

  // Tag tabs - hierarchical (3-level)
  const [activeSubject, setActiveSubjectState] = useState("");
  const [activeSource, setActiveSourceState] = useState("");   // Level 2: mid-level
  const [activeDetail, setActiveDetailState] = useState("");   // Level 3: detail
  const [filterCategory, setFilterCategory] = useState("");

  // Fill-in-the-blank quiz state
  const [fillPool, setFillPool] = useState([]);
  const [fillCurrent, setFillCurrent] = useState(0);
  const [fillScore, setFillScore] = useState({ correct: 0, wrong: 0 });
  const [fillFinished, setFillFinished] = useState(false);
  const [fillAnswered, setFillAnswered] = useState(false);
  const [fillUserAnswer, setFillUserAnswer] = useState("");

  // Quiz scope selection state
  const [quizSubject, setQuizSubject] = useState("");
  const [quizSource, setQuizSource] = useState("");
  const [quizDetail, setQuizDetail] = useState("");
  const [quizCategory, setQuizCategory] = useState("");

  // Matching quiz state
  const [matchPool, setMatchPool] = useState([]); // words for this round
  const [matchTerms, setMatchTerms] = useState([]); // shuffled terms (left)
  const [matchMeanings, setMatchMeanings] = useState([]); // shuffled meanings (right)
  const [matchSelected, setMatchSelected] = useState(null); // { side: 'term'|'meaning', index }
  const [matchPaired, setMatchPaired] = useState({}); // { termIdx: meaningIdx }
  const [matchWrong, setMatchWrong] = useState(null); // { term, meaning } for shake
  const [matchRound, setMatchRound] = useState(0);
  const [matchTotalCorrect, setMatchTotalCorrect] = useState(0);
  const [matchTotalCount, setMatchTotalCount] = useState(0);
  const [matchFinished, setMatchFinished] = useState(false);
  const [matchStarted, setMatchStarted] = useState(false);

  // Tag manager state
  const [tmSelectedTag, setTmSelectedTag] = useState("");
  const [tmSelectedWords, setTmSelectedWords] = useState(new Set());
  const [tmRenameInput, setTmRenameInput] = useState("");
  const [tmMergeTarget, setTmMergeTarget] = useState("");
  const [tmBulkAddInput, setTmBulkAddInput] = useState("");
  const [tmAction, setTmAction] = useState(""); // rename | merge | bulkAdd | bulkRemove

  // Notion credentials
  const [notionApiKey, setNotionApiKey] = useState("");
  const [notionDbId, setNotionDbId] = useState("");
  const [showNotionSettings, setShowNotionSettings] = useState(false);

  const hasNotionCredentials = !!(notionApiKey && notionDbId);

  // Load from localStorage + 자동 동기화
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      setWords(saved);
    } catch {
      setWords([]);
    }
    // 테마 복원
    const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
    setTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);
    // Notion 자격증명 복원
    try {
      const creds = JSON.parse(localStorage.getItem(NOTION_KEY));
      if (creds?.apiKey && creds?.dbId) {
        setNotionApiKey(creds.apiKey);
        setNotionDbId(creds.dbId);
      }
    } catch {}
    // Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notion 자격증명 로드 후 자동 동기화
  useEffect(() => {
    if (hasNotionCredentials) {
      syncFromNotion({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNotionCredentials]);

  const saveWords = useCallback((w) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  }, []);

  const showToast = useCallback((msg) => {
    setToast({ message: msg, show: true });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000);
  }, []);

  // ─── Theme ───
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute("data-theme", next);
  }, [theme]);

  // ─── TTS ───
  const speak = useCallback((text, e) => {
    if (e) e.stopPropagation();
    if (!text || typeof window === "undefined" || !window.speechSynthesis)
      return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const enVoice =
      voices.find((v) => v.lang === "en-US") ||
      voices.find((v) => v.lang.startsWith("en"));
    if (enVoice) utterance.voice = enVoice;
    window.speechSynthesis.speak(utterance);
  }, []);

  // ─── Quiz scope helpers ───
  const getQuizScopedWords = useCallback(() => {
    let w = [...words];
    if (quizSubject) w = w.filter((x) => {
      const tags = x.tags || [];
      return tags.some(t => t === quizSubject || t.startsWith(quizSubject + "-"));
    });
    if (quizSource) w = w.filter((x) => {
      const tags = x.tags || [];
      return tags.some(t => t === quizSource || t.startsWith(quizSource + "-"));
    });
    if (quizDetail) w = w.filter((x) => (x.tags || []).includes(quizDetail));
    if (quizCategory) w = w.filter((x) => (x.tags || []).includes(quizCategory));
    return w;
  }, [words, quizSubject, quizSource, quizDetail, quizCategory]);

  const resetQuizScope = () => {
    setQuizSubject("");
    setQuizSource("");
    setQuizDetail("");
    setQuizCategory("");
  };

  // ─── Fill-in-the-Blank ───
  const startFillBlank = useCallback(() => {
    const scoped = getQuizScopedWords();
    const wordsWithEx = scoped.filter(
      (w) =>
        w.term &&
        w.example &&
        w.example.toLowerCase().includes(w.term.toLowerCase()),
    );
    if (wordsWithEx.length < 3)
      return showToast("예문이 있는 단어가 3개 이상 필요합니다");
    const shuffled = [...wordsWithEx]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(15, wordsWithEx.length));
    setFillPool(shuffled);
    setFillCurrent(0);
    setFillScore({ correct: 0, wrong: 0 });
    setFillFinished(false);
    setFillAnswered(false);
    setFillUserAnswer("");
  }, [getQuizScopedWords, showToast]);

  const fillCheck = useCallback(() => {
    const w = fillPool[fillCurrent];
    const inputEl = document.getElementById("fill-input");
    if (!inputEl) return;
    const userAnswer = inputEl.value.trim().toLowerCase();
    const correct = userAnswer === w.term.toLowerCase();
    setFillScore((s) => ({
      ...s,
      [correct ? "correct" : "wrong"]: s[correct ? "correct" : "wrong"] + 1,
    }));
    setFillAnswered(true);
    setFillUserAnswer(userAnswer);
    if (inputEl) {
      inputEl.classList.add(correct ? "correct" : "wrong");
      inputEl.disabled = true;
    }
  }, [fillPool, fillCurrent]);

  const fillNext = useCallback(() => {
    const next = fillCurrent + 1;
    setFillCurrent(next);
    if (next >= fillPool.length) {
      setFillFinished(true);
    }
    setFillAnswered(false);
    setFillUserAnswer("");
    setTimeout(() => {
      const el = document.getElementById("fill-input");
      if (el) el.focus();
    }, 50);
  }, [fillCurrent, fillPool]);

  // ─── Matching Quiz ───
  const MATCH_PER_ROUND = 6;

  const startMatchRound = useCallback((pool, round, prevCorrect, prevTotal) => {
    const start = round * MATCH_PER_ROUND;
    const roundWords = pool.slice(start, start + MATCH_PER_ROUND);
    if (roundWords.length === 0) {
      setMatchFinished(true);
      return;
    }
    // Shuffle terms and meanings independently
    const terms = roundWords.map((w, i) => ({ text: w.term, origIdx: i }))
      .sort(() => Math.random() - 0.5);
    const meanings = roundWords.map((w, i) => ({ text: w.meaning, origIdx: i }))
      .sort(() => Math.random() - 0.5);
    setMatchTerms(terms);
    setMatchMeanings(meanings);
    setMatchSelected(null);
    setMatchPaired({});
    setMatchWrong(null);
    setMatchRound(round);
    setMatchTotalCorrect(prevCorrect);
    setMatchTotalCount(prevTotal);
    setMatchFinished(false);
  }, []);

  const startMatchQuiz = useCallback(() => {
    const scoped = getQuizScopedWords();
    if (scoped.length < 4) {
      showToast("최소 4개 이상의 단어가 필요합니다");
      return;
    }
    const shuffled = [...scoped].sort(() => Math.random() - 0.5);
    setMatchPool(shuffled);
    setMatchStarted(true);
    setMatchFinished(false);
    setMatchTotalCorrect(0);
    setMatchTotalCount(0);
    startMatchRound(shuffled, 0, 0, 0);
  }, [getQuizScopedWords, showToast, startMatchRound]);

  const handleMatchSelect = useCallback((side, index) => {
    if (!matchSelected) {
      setMatchSelected({ side, index });
      return;
    }
    // If same side, just switch selection
    if (matchSelected.side === side) {
      setMatchSelected({ side, index });
      return;
    }
    // Different sides — check match
    const termIdx = side === "term" ? index : matchSelected.index;
    const meaningIdx = side === "meaning" ? index : matchSelected.index;
    const termOrigIdx = matchTerms[termIdx].origIdx;
    const meaningOrigIdx = matchMeanings[meaningIdx].origIdx;

    if (termOrigIdx === meaningOrigIdx) {
      // Correct match
      setMatchPaired((prev) => ({ ...prev, [termIdx]: meaningIdx }));
      setMatchSelected(null);
      const newCorrect = matchTotalCorrect + 1;
      const newTotal = matchTotalCount + 1;
      setMatchTotalCorrect(newCorrect);
      setMatchTotalCount(newTotal);

      // Check if round complete
      const pairedCount = Object.keys(matchPaired).length + 1;
      if (pairedCount >= matchTerms.length) {
        // Next round after short delay
        setTimeout(() => {
          startMatchRound(matchPool, matchRound + 1, newCorrect, newTotal);
        }, 600);
      }
    } else {
      // Wrong match
      setMatchWrong({ term: termIdx, meaning: meaningIdx });
      setMatchSelected(null);
      setMatchTotalCount((c) => c + 1);
      setTimeout(() => setMatchWrong(null), 500);
    }
  }, [matchSelected, matchTerms, matchMeanings, matchPaired, matchPool,
      matchRound, matchTotalCorrect, matchTotalCount, startMatchRound]);

  // ─── Notion Settings ───
  const saveNotionCredentials = useCallback((apiKey, dbId) => {
    setNotionApiKey(apiKey);
    setNotionDbId(dbId);
    localStorage.setItem(NOTION_KEY, JSON.stringify({ apiKey, dbId }));
    setShowNotionSettings(false);
    showToast("Notion 연결 설정 저장됨");
  }, [showToast]);

  const disconnectNotion = useCallback(() => {
    setNotionApiKey("");
    setNotionDbId("");
    localStorage.removeItem(NOTION_KEY);
    localStorage.removeItem(SYNC_META_KEY);
    setShowNotionSettings(false);
    showToast("Notion 연결 해제됨");
  }, [showToast]);

  // ─── Notion Sync ───
  const notionFetch = useCallback(async (path, method = "GET", body = null) => {
    if (!notionApiKey || !notionDbId) throw new Error("Notion 연결 설정이 필요합니다");
    const headers = {
      "Content-Type": "application/json",
      "x-notion-api-key": notionApiKey,
      "x-notion-db-id": notionDbId,
    };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(path, options);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    return res.json();
  }, [notionApiKey, notionDbId]);

  // 평소에는 마지막 동기화 이후 바뀐 단어만 받아오고,
  // 처음 연결했을 때·일주일마다·직접 요청했을 때는 전체를 받아와 노션에서 지운 단어까지 반영한다.
  const syncFromNotion = useCallback(
    async ({ silent = false, full = false } = {}) => {
      setSyncStatus("syncing");
      if (!silent) setBusy(full ? "노션 전체 동기화 중…" : "노션과 동기화 중…");
      try {
        const meta = loadSyncMeta();
        const plan = planSync(meta, notionDbId, Date.now(), { forceFull: full });
        const path = plan.since
          ? `/api/words?since=${encodeURIComponent(plan.since)}`
          : "/api/words";
        const data = await notionFetch(path);
        if (data.success && data.words) {
          // 토스트에 보여줄 "노션에서 지운 단어 수" (상태 갱신은 아래 함수형 업데이트로)
          const removed = plan.full
            ? mergeFull(wordsRef.current, data.words, {
                propagateDeletes: plan.sameDb,
              }).removed
            : 0;
          setWords((prev) => {
            let next;
            if (plan.full) {
              next = mergeFull(prev, data.words, {
                propagateDeletes: plan.sameDb,
              }).merged;
            } else {
              next = mergeIncremental(prev, data.words);
            }
            saveWords(next);
            return next;
          });
          localStorage.setItem(
            SYNC_META_KEY,
            JSON.stringify({
              dbId: notionDbId,
              lastSync: data.serverTime || new Date().toISOString(),
              lastFullSync: plan.full ? Date.now() : meta.lastFullSync,
            }),
          );
          setSyncStatus("success");
          // 노션 연결로 들어온 단어의 대기 태그를 진짜 태그로 옮기기 (뒤에서 조용히)
          if (!promotingRef.current) {
            promotingRef.current = true;
            (async () => {
              let total = 0;
              try {
                for (let i = 0; i < 100; i++) {
                  const r = await notionFetch("/api/tags/promote", "POST", {});
                  total += r.promoted || 0;
                  if (!r.remaining || (r.promoted || 0) === 0) break;
                }
              } catch (e) {
                console.warn("대기 태그 옮기기 실패:", e);
              }
              promotingRef.current = false;
              if (total > 0) showToast(`새 태그를 노션에 반영했어요 (단어 ${total}개)`);
            })();
          }
          if (!silent) {
            if (plan.full) {
              showToast(
                `전체 동기화 완료! ${data.words.length}개 단어` +
                  (removed > 0 ? ` (노션에서 지운 ${removed}개 반영)` : ""),
              );
            } else {
              showToast(
                data.words.length > 0
                  ? `동기화 완료! 바뀐 단어 ${data.words.length}개`
                  : "이미 최신 상태예요",
              );
            }
          }
        }
      } catch (e) {
        setSyncStatus("error");
        if (!silent) showToast("동기화 실패: " + (e.message || "연결 오류"));
      }
      if (!silent) setBusy(null);
      setTimeout(() => setSyncStatus("idle"), 3000);
    },
    [notionFetch, notionDbId, saveWords, showToast],
  );

  const syncAdd = useCallback(
    async (word) => {
      try {
        const data = await notionFetch("/api/words", "POST", word);
        if (data.success && data.id) {
          setWords((prev) => {
            const next = prev.map((w) =>
              w.id === word.id
                ? { ...w, id: data.id, _localOnly: undefined }
                : w,
            );
            saveWords(next);
            return next;
          });
        }
      } catch (e) {
        console.warn("Notion 추가 실패:", e);
      }
    },
    [notionFetch, saveWords],
  );

  const syncUpdate = useCallback(
    async (wordId, patch) => {
      try {
        await notionFetch("/api/words/" + wordId, "PATCH", patch);
      } catch (e) {
        console.warn("Notion 수정 실패:", e);
      }
    },
    [notionFetch],
  );

  const syncDelete = useCallback(
    async (wordId) => {
      try {
        await notionFetch("/api/words/" + wordId, "DELETE");
      } catch (e) {
        console.warn("Notion 삭제 실패:", e);
      }
    },
    [notionFetch],
  );

  // ─── 여러 단어를 20개씩 묶어서 노션에 올리기 ───
  // 묶음마다 결과를 바로 저장해서, 중간에 앱을 닫아도 올라간 단어는 연결이 유지되고
  // 남은 단어는 "↑ Notion 업로드" 버튼으로 이어서 올릴 수 있다.
  const uploadWordsInBulk = useCallback(
    async (toUpload) => {
      const total = toUpload.length;
      let done = 0;
      let uploaded = 0;
      setBusy("노션에 단어를 올리는 중…");
      setSyncProgress({ done: 0, total });
      for (const group of chunk(toUpload, BULK_CHUNK_SIZE)) {
        try {
          const data = await notionFetch("/api/words/bulk", "POST", {
            words: group,
          });
          const idMap = new Map();
          (data.results || []).forEach((r, i) => {
            if (r?.id && group[i]) idMap.set(group[i].id, r.id);
          });
          uploaded += idMap.size;
          setWords((prev) => {
            const next = applyUploadedIds(prev, idMap);
            saveWords(next);
            return next;
          });
        } catch (e) {
          console.warn("Notion 일괄 추가 실패:", e);
        }
        done += group.length;
        setSyncProgress({ done, total });
      }
      setSyncProgress(null);
      setBusy(null);
      return { uploaded, failed: total - uploaded };
    },
    [notionFetch, saveWords],
  );

  // ─── 태그 규칙 통일 (1회성): 노션 최신 상태를 받아 규칙대로 바꾸고, 바뀐 단어만 20개씩 노션에 반영 ───
  const migrateTagsToRule = useCallback(async () => {
    if (uploadingRef.current) return;
    if (
      !window.confirm(
        "모든 단어의 태그를 새 규칙으로 바꿀까요?\n" +
          "· 출처 태그: Week01 → W1\n" +
          "· 학술영어·학술어휘 → 일반, 나머지 → 전공용어\n" +
          "· 과목 이름 태그(생물학·음악·통계·철학·글쓰기·수학) 삭제\n" +
          "· 윤리 → 윤리학, MATH1040 빠진 섹션 태그 채우기",
      )
    )
      return;
    uploadingRef.current = true;
    setSyncStatus("syncing");
    setBusy("태그를 새 규칙으로 바꾸는 중…");
    try {
      const data = await notionFetch("/api/words");
      if (!data.success || !data.words) throw new Error("노션 단어 목록을 받지 못했어요");
      const base = mergeFull(wordsRef.current, data.words, {
        propagateDeletes: false,
      }).merged;
      const { next, changed, missingSource } = migrateAllTags(base);
      setWords(next);
      saveWords(next);

      const toPush = changed.filter((w) => isNotionId(w.id) && !w._localOnly);
      const total = toPush.length;
      let done = 0;
      let updated = 0;
      setSyncProgress({ done: 0, total });
      for (const group of chunk(toPush, BULK_CHUNK_SIZE)) {
        try {
          const res = await notionFetch("/api/words/bulk", "PATCH", {
            words: group.map((w) => ({ id: w.id, tags: w.tags })),
          });
          updated += (res.results || []).filter((r) => r?.id).length;
        } catch (e) {
          console.warn("Notion 일괄 수정 실패:", e);
        }
        done += group.length;
        setSyncProgress({ done, total });
      }
      setSyncProgress(null);
      const failed = total - updated;
      setSyncStatus(failed > 0 ? "error" : "success");
      showToast(
        `태그 통일 완료! ${updated}개 단어 노션 반영` +
          (failed > 0 ? ` · ${failed}개 실패 — 다시 누르면 남은 것만 이어서 해요` : "") +
          (missingSource > 0 ? ` · 출처 태그 없는 단어 ${missingSource}개` : ""),
      );
    } catch (e) {
      setSyncProgress(null);
      setSyncStatus("error");
      showToast("태그 통일 실패: " + (e.message || "연결 오류"));
    }
    setBusy(null);
    uploadingRef.current = false;
    setTimeout(() => setSyncStatus("idle"), 3000);
  }, [notionFetch, saveWords, showToast]);

  // ─── 노션 DB의 태그 옵션 목록 (태그 관리에서 단어 없는 태그 표시용) ───
  const loadNotionTagOptions = useCallback(async () => {
    try {
      const data = await notionFetch("/api/tags");
      if (data.success) {
        setNotionTagOptions(data.options || []);
        setNotionTagRebuilding(!!data.rebuilding);
      }
    } catch (e) {
      console.warn("태그 옵션 조회 실패:", e);
    }
  }, [notionFetch]);

  // ─── 태그 속성 재구성으로 태그 지우기 ───
  // 노션 API는 남길 태그가 100개를 넘으면 태그를 지울 수 없어서, tags 속성을 새로 만들고
  // 모든 단어의 태그를 다시 써서 지울 태그만 빠지게 한다. 중간에 멈춰도 이어서 할 수 있다.
  const runTagRebuild = useCallback(
    async (names) => {
      setBusy("노션 태그를 정리하는 중… (단어 태그를 새로 쓰는 중)");
      setSyncStatus("syncing");
      const total = Math.max(1, words.filter((w) => (w.tags || []).length > 0).length);
      let done = 0;
      setSyncProgress({ done: 0, total });
      try {
        const start = await notionFetch("/api/tags/rebuild", "POST", { action: "start", names });
        setNotionTagRebuilding(true);
        for (let pass = 0; pass < 3; pass++) {
          let cursor = null;
          do {
            let step;
            for (let attempt = 0; ; attempt++) {
              try {
                step = await notionFetch("/api/tags/rebuild", "POST", { action: "step", cursor });
                break;
              } catch (e) {
                if (attempt >= 2) throw e;
                await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
              }
            }
            if (pass === 0) {
              done = Math.min(total, done + step.processed);
              setSyncProgress({ done, total });
            }
            cursor = step.nextCursor;
          } while (cursor);
          const fin = await notionFetch("/api/tags/rebuild", "POST", { action: "finish" });
          if (fin.done) {
            setNotionTagRebuilding(false);
            setSyncStatus("success");
            const removed = start.removed?.length || 0;
            showToast(
              start.resumed
                ? "중간에 멈췄던 태그 정리를 마쳤어요"
                : `태그 ${removed}개를 지웠어요` +
                    (start.inUse?.length ? ` · ${start.inUse.length}개는 단어에 쓰이고 있어 남김` : ""),
            );
            if (names.includes(tmSelectedTag)) setTmSelectedTag("");
            break;
          }
          if (pass === 2) throw new Error("아직 옮기지 못한 단어가 있어요");
        }
      } catch (e) {
        setSyncStatus("error");
        let msg = e.message || "";
        try {
          msg = JSON.parse(msg).error || msg;
        } catch {}
        showToast("태그 정리가 중간에 멈췄어요: " + msg.slice(0, 60) + " — 태그 관리에서 '이어서 하기'를 눌러 주세요");
      }
      setSyncProgress(null);
      setBusy(null);
      setTimeout(() => setSyncStatus("idle"), 3000);
      loadNotionTagOptions();
      // 모든 단어의 수정 시각이 바뀌었으니 바뀐 단어만 받아오는 동기화로 맞춘다
      syncFromNotion({ silent: true });
    },
    [words, notionFetch, showToast, loadNotionTagOptions, syncFromNotion, tmSelectedTag],
  );

  // ─── 단어 없는 태그를 노션 DB에서 삭제 ───
  const deleteUnusedTags = useCallback(
    async (names) => {
      if (!names.length) return;
      const label = names.length === 1 ? `"${names[0]}"` : `${names.length}개 태그`;
      if (!window.confirm(`${label}를 노션 DB에서 지울까요?\n어떤 단어에도 쓰이지 않는 태그라 단어는 바뀌지 않아요.`))
        return;
      setBusy("노션에서 태그를 지우는 중…");
      try {
        const res = await notionFetch("/api/tags", "DELETE", { names });
        const removed = res.removed?.length || 0;
        const parts = [`${removed}개 삭제`];
        if (res.inUse?.length) parts.push(`${res.inUse.length}개는 노션에서 사용 중이라 남김`);
        if (res.notRemoved?.length) parts.push(`${res.notRemoved.length}개는 노션이 지우지 않음 — 노션에서 직접 지워 주세요`);
        showToast("태그 정리: " + parts.join(" · "));
        if (removed > 0 && names.includes(tmSelectedTag)) setTmSelectedTag("");
      } catch (e) {
        const msg = e.message || "";
        let info = null;
        try {
          info = JSON.parse(msg);
        } catch {}
        if (info?.needsRebuild || /100/.test(msg)) {
          // 남길 태그가 100개를 넘어 바로는 못 지움 → 태그 속성 재구성으로 지우기
          setBusy(null);
          const count = words.filter((w) => (w.tags || []).length > 0).length;
          if (
            window.confirm(
              `노션 API 제한(한 번에 태그 100개)으로 바로 지울 수 없어서, tags 속성을 새로 만들어 지울게요.\n\n` +
                `· 태그가 있는 단어 약 ${count}개의 태그를 다시 써서 몇 분 걸려요\n` +
                `· 단어 내용과 태그는 그대로고, 일부 태그 색만 바뀔 수 있어요\n` +
                `· 중간에 앱을 닫아도 태그 관리에서 이어서 할 수 있어요\n\n진행할까요?`,
            )
          ) {
            await runTagRebuild(names);
          }
          return;
        }
        showToast("태그 삭제 실패: " + (msg.slice(0, 80) || "연결 오류"));
      }
      setBusy(null);
      loadNotionTagOptions();
    },
    [notionFetch, showToast, loadNotionTagOptions, tmSelectedTag, words, runTagRebuild],
  );

  // 태그 관리를 열 때 노션 태그 옵션 목록 받아오기
  useEffect(() => {
    if (view === "tags" && hasNotionCredentials) loadNotionTagOptions();
  }, [view, hasNotionCredentials, loadNotionTagOptions]);

  // ─── 노션 태그 점검: 노션 DB의 태그 옵션 중 어떤 단어에도 안 쓰이는 것 찾기 ───
  // (노션 API는 옵션을 한 번에 100개까지만 지정할 수 있어서 삭제는 노션에서 직접 한다)
  const auditNotionTags = useCallback(async () => {
    setSyncStatus("syncing");
    setBusy("노션 태그를 점검하는 중…");
    try {
      const [tagData, wordData] = await Promise.all([
        notionFetch("/api/tags"),
        notionFetch("/api/words"),
      ]);
      if (!tagData.success || !wordData.success) throw new Error("노션 정보를 받지 못했어요");
      setTagAudit(findUnusedTagOptions(tagData.options || [], wordData.words || []));
      setSyncStatus("success");
    } catch (e) {
      setSyncStatus("error");
      showToast("태그 점검 실패: " + (e.message || "연결 오류"));
    }
    setBusy(null);
    setTimeout(() => setSyncStatus("idle"), 3000);
  }, [notionFetch, showToast]);

  const uploadAllToNotion = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setSyncStatus("syncing");
    try {
      // 노션에 이미 있는 단어는 건너뛰기 위해 먼저 노션 단어 목록 확인
      let notionTerms = new Set();
      try {
        const data = await notionFetch("/api/words");
        if (data.success && data.words) {
          notionTerms = new Set(data.words.map((w) => w.term.toLowerCase()));
        }
      } catch (e) {
        console.warn("Notion 조회 실패, 전체 업로드 진행:", e);
      }
      const toUpload = words.filter(
        (w) => w._localOnly || !notionTerms.has(w.term.toLowerCase()),
      );
      const { uploaded, failed } = await uploadWordsInBulk(toUpload);
      setSyncStatus(failed > 0 ? "error" : "success");
      showToast(
        `${uploaded}개 단어 업로드 완료!` +
          (failed > 0 ? ` ${failed}개 실패 — 다시 눌러 이어서 올릴 수 있어요` : ""),
      );
    } catch (e) {
      setSyncStatus("error");
      showToast("업로드 실패: " + e.message);
    }
    uploadingRef.current = false;
    setTimeout(() => setSyncStatus("idle"), 3000);
  }, [words, notionFetch, uploadWordsInBulk, showToast]);

  // ─── Handlers ───
  const handleAdd = useCallback(() => {
    const term = document.getElementById("f-term").value.trim();
    const meaning = document.getElementById("f-meaning").value.trim();
    if (!term || !meaning) return showToast("단어와 뜻은 필수입니다");
    const word = {
      id: generateId(),
      term,
      meaning,
      example: document.getElementById("f-example").value.trim(),
      notes: document.getElementById("f-notes").value.trim(),
      tags: formTags,
      difficulty: formDifficulty,
      createdAt: Date.now(),
      _localOnly: true,
    };
    const next = [word, ...words];
    setWords(next);
    saveWords(next);
    setFormTags([]);
    setFormDifficulty(0);
    showToast("단어가 추가되었습니다");
    setView("list");
    syncAdd(word);
  }, [words, formTags, formDifficulty, saveWords, showToast, syncAdd]);

  const handleEdit = useCallback(() => {
    const term = document.getElementById("f-term").value.trim();
    const meaning = document.getElementById("f-meaning").value.trim();
    if (!term || !meaning) return showToast("단어와 뜻은 필수입니다");
    const next = words.map((w) =>
      w.id === editWord.id
        ? {
            ...w,
            term,
            meaning,
            example: document.getElementById("f-example").value.trim(),
            notes: document.getElementById("f-notes").value.trim(),
            tags: formTags,
            difficulty: formDifficulty,
          }
        : w,
    );
    setWords(next);
    saveWords(next);
    const updated = next.find((w) => w.id === editWord.id);
    showToast("수정 완료");
    syncUpdate(updated.id, updated);
    setFormTags([]);
    setFormDifficulty(0);
    setView("list");
    setEditWord(null);
  }, [
    words,
    editWord,
    formTags,
    formDifficulty,
    saveWords,
    showToast,
    syncUpdate,
  ]);

  const handleDelete = useCallback(
    (id) => {
      const next = words.filter((w) => w.id !== id);
      setWords(next);
      saveWords(next);
      showToast("삭제되었습니다");
      syncDelete(id);
    },
    [words, saveWords, showToast, syncDelete],
  );

  const handleRate = useCallback(
    (id, r) => {
      const next = words.map((w) =>
        w.id === id ? { ...w, difficulty: r } : w,
      );
      setWords(next);
      saveWords(next);
      syncUpdate(id, { difficulty: r });
    },
    [words, saveWords, syncUpdate],
  );

  // ─── Merge Duplicates ───
  const getDuplicateCount = useCallback(() => {
    const seen = new Map();
    words.forEach((w) => {
      const key = w.term.trim().toLowerCase();
      seen.set(key, (seen.get(key) || 0) + 1);
    });
    let dupes = 0;
    seen.forEach((count) => { if (count > 1) dupes += count; });
    return dupes;
  }, [words]);

  const mergeDuplicates = useCallback(() => {
    const groups = new Map();
    words.forEach((w) => {
      const key = w.term.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    });

    const merged = [];
    const deletedIds = [];

    groups.forEach((group) => {
      if (group.length === 1) {
        merged.push(group[0]);
        return;
      }

      // Keep the earliest created one as base
      group.sort((a, b) => a.createdAt - b.createdAt);
      const base = { ...group[0] };

      // Merge tags from all duplicates
      const allTags = new Set(base.tags || []);
      // Merge meanings, examples, notes (keep non-empty, combine unique)
      const meanings = new Set([base.meaning]);
      const examples = new Set(base.example ? [base.example] : []);
      const notes = new Set(base.notes ? [base.notes] : []);
      let maxDifficulty = base.difficulty || 0;

      for (let i = 1; i < group.length; i++) {
        const w = group[i];
        (w.tags || []).forEach((t) => allTags.add(t));
        if (w.meaning) meanings.add(w.meaning);
        if (w.example) examples.add(w.example);
        if (w.notes) notes.add(w.notes);
        if ((w.difficulty || 0) > maxDifficulty) maxDifficulty = w.difficulty;
        deletedIds.push(w.id);
      }

      base.tags = [...allTags];
      // Combine unique meanings with semicolons
      const meaningArr = [...meanings].filter(Boolean);
      if (meaningArr.length > 1) base.meaning = meaningArr.join("; ");
      // Keep the longest example
      const exampleArr = [...examples].filter(Boolean);
      if (exampleArr.length > 0) base.example = exampleArr.sort((a, b) => b.length - a.length)[0];
      // Combine unique notes
      const noteArr = [...notes].filter(Boolean);
      if (noteArr.length > 1) base.notes = noteArr.join(" / ");
      base.difficulty = maxDifficulty;

      merged.push(base);
    });

    if (deletedIds.length === 0) {
      showToast("중복된 단어가 없습니다");
      return;
    }

    // Delete duplicates from Notion
    deletedIds.forEach((id) => syncDelete(id));
    // Update the base words in Notion
    merged.forEach((w) => {
      if (groups.get(w.term.trim().toLowerCase()).length > 1) {
        syncUpdate(w.id, w);
      }
    });

    setWords(merged);
    saveWords(merged);
    showToast(`${deletedIds.length}개 중복 단어가 통합되었습니다`);
  }, [words, saveWords, showToast, syncDelete, syncUpdate]);

  // ─── Tag Manager Actions ───
  const tmRenameTag = useCallback((oldName, newName) => {
    if (!newName.trim() || oldName === newName.trim()) return;
    const trimmed = newName.trim();
    const next = words.map((w) => {
      if (!(w.tags || []).includes(oldName)) return w;
      const tags = w.tags.map((t) => (t === oldName ? trimmed : t));
      // Remove duplicate if newName already existed
      const unique = [...new Set(tags)];
      return { ...w, tags: unique };
    });
    setWords(next);
    saveWords(next);
    next.filter((w) => (w.tags || []).includes(trimmed)).forEach((w) => syncUpdate(w.id, w));
    setTmSelectedTag(trimmed);
    showToast(`"${oldName}" → "${trimmed}" 변경 완료`);
  }, [words, saveWords, showToast, syncUpdate]);

  const tmDeleteTag = useCallback((tagName) => {
    const next = words.map((w) => {
      if (!(w.tags || []).includes(tagName)) return w;
      return { ...w, tags: w.tags.filter((t) => t !== tagName) };
    });
    setWords(next);
    saveWords(next);
    next.forEach((w, i) => {
      if (words[i].tags?.includes(tagName)) syncUpdate(w.id, w);
    });
    setTmSelectedTag("");
    showToast(`"${tagName}" 태그 삭제 완료`);
  }, [words, saveWords, showToast, syncUpdate]);

  const tmMergeTags = useCallback((source, target) => {
    if (!target || source === target) return;
    const next = words.map((w) => {
      const tags = w.tags || [];
      if (!tags.includes(source)) return w;
      const newTags = [...new Set(tags.map((t) => (t === source ? target : t)))];
      return { ...w, tags: newTags };
    });
    setWords(next);
    saveWords(next);
    next.filter((w) => (w.tags || []).includes(target)).forEach((w) => syncUpdate(w.id, w));
    setTmSelectedTag(target);
    showToast(`"${source}" → "${target}" 병합 완료`);
  }, [words, saveWords, showToast, syncUpdate]);

  const tmBulkAddTag = useCallback((wordIds, tagName) => {
    if (!tagName.trim()) return;
    const trimmed = tagName.trim();
    const idSet = new Set(wordIds);
    const next = words.map((w) => {
      if (!idSet.has(w.id)) return w;
      if ((w.tags || []).includes(trimmed)) return w;
      return { ...w, tags: [...(w.tags || []), trimmed] };
    });
    setWords(next);
    saveWords(next);
    next.filter((w) => idSet.has(w.id)).forEach((w) => syncUpdate(w.id, w));
    showToast(`${idSet.size}개 단어에 "${trimmed}" 태그 추가`);
  }, [words, saveWords, showToast, syncUpdate]);

  const tmBulkRemoveTag = useCallback((wordIds, tagName) => {
    const idSet = new Set(wordIds);
    const next = words.map((w) => {
      if (!idSet.has(w.id)) return w;
      return { ...w, tags: (w.tags || []).filter((t) => t !== tagName) };
    });
    setWords(next);
    saveWords(next);
    next.filter((w) => idSet.has(w.id)).forEach((w) => syncUpdate(w.id, w));
    showToast(`${idSet.size}개 단어에서 "${tagName}" 태그 제거`);
  }, [words, saveWords, showToast, syncUpdate]);

  // ─── Tags ───
  const addFormTag = useCallback(() => {
    if (!tagInput.trim()) return;
    if (!formTags.includes(tagInput.trim()))
      setFormTags((prev) => [...prev, tagInput.trim()]);
    setTagInput("");
  }, [tagInput, formTags]);

  const removeFormTag = useCallback(
    (tag) => setFormTags((prev) => prev.filter((t) => t !== tag)),
    [],
  );

  // ─── Export / Import ───
  const exportWords = useCallback(() => {
    const blob = new Blob([JSON.stringify(words, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocabulary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("단어장 내보내기 완료!");
  }, [words, showToast]);

  const exportCSV = useCallback(() => {
    let csv = "term,meaning,example,notes,tags,difficulty,date\n";
    words.forEach((w) => {
      csv += `"${(w.term || "").replace(/"/g, '""')}","${(w.meaning || "").replace(/"/g, '""')}","${(w.example || "").replace(/"/g, '""')}","${(w.notes || "").replace(/"/g, '""')}","${(w.tags || []).join(";")}",${w.difficulty || 0},"${formatDate(w.createdAt)}"\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocabulary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV 내보내기 완료!");
  }, [words, showToast]);

  const importWords = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (!Array.isArray(imported)) throw new Error();
          const existing = new Set(words.map((w) => w.term.toLowerCase()));
          let added = 0;
          const toAdd = [];
          imported.forEach((w) => {
            if (w.term && w.meaning && !existing.has(w.term.toLowerCase())) {
              toAdd.push({
                ...w,
                id: w.id || generateId(),
                createdAt: w.createdAt || Date.now(),
                _localOnly: true,
              });
              existing.add(w.term.toLowerCase());
              added++;
            }
          });
          const next = [...toAdd, ...words];
          setWords(next);
          saveWords(next);
          showToast(`${added}개 단어 가져오기 완료!`);
          // Notion이 연결돼 있으면 가져온 단어를 20개씩 묶어서 바로 올리기
          if (notionApiKey && notionDbId && toAdd.length > 0 && !uploadingRef.current) {
            (async () => {
              uploadingRef.current = true;
              setSyncStatus("syncing");
              const { uploaded, failed } = await uploadWordsInBulk(toAdd);
              uploadingRef.current = false;
              setSyncStatus(failed > 0 ? "error" : "success");
              showToast(
                `${uploaded}개 단어 Notion 동기화 완료!` +
                  (failed > 0 ? ` ${failed}개 실패 — "↑ Notion 업로드"로 다시 올릴 수 있어요` : ""),
              );
              setTimeout(() => setSyncStatus("idle"), 3000);
            })();
          }
        } catch {
          showToast("파일 형식이 올바르지 않습니다");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [words, saveWords, showToast, notionApiKey, notionDbId, uploadWordsInBulk]);

  // ─── Quiz ───
  const startQuiz = useCallback(
    (mode) => {
      const scoped = getQuizScopedWords();
      const shuffled = [...scoped]
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(20, scoped.length));
      setQuizMode(mode);
      setQuizPool(shuffled);
      setQuizCurrent(0);
      setQuizShowAnswer(false);
      setQuizScore({ correct: 0, wrong: 0 });
      setQuizFinished(false);
    },
    [getQuizScopedWords],
  );

  const quizJudge = useCallback(
    (correct) => {
      setQuizScore((s) => ({
        ...s,
        [correct ? "correct" : "wrong"]: s[correct ? "correct" : "wrong"] + 1,
      }));
      setQuizCurrent((c) => {
        const next = c + 1;
        if (next >= quizPool.length) setQuizFinished(true);
        return next;
      });
      setQuizShowAnswer(false);
    },
    [quizPool],
  );

  // ─── Filtering ───
  const getFiltered = useCallback(() => {
    let w = [...words];
    if (search) {
      const s = search.toLowerCase();
      w = w.filter(
        (x) =>
          x.term.toLowerCase().includes(s) ||
          x.meaning.toLowerCase().includes(s) ||
          (x.notes || "").toLowerCase().includes(s),
      );
    }
    if (filterTag) w = w.filter((x) => {
      const tags = x.tags || [];
      return tags.some(t => t === filterTag || t.startsWith(filterTag + "-"));
    });
    if (filterCategory) w = w.filter((x) => (x.tags || []).includes(filterCategory));
    if (filterDifficulty > 0)
      w = w.filter((x) => (x.difficulty || 0) === filterDifficulty);
    w.sort((a, b) => {
      if (sortBy === "newest") return b.createdAt - a.createdAt;
      if (sortBy === "oldest") return a.createdAt - b.createdAt;
      if (sortBy === "alpha") return a.term.localeCompare(b.term);
      if (sortBy === "difficulty")
        return (b.difficulty || 0) - (a.difficulty || 0);
      return 0;
    });
    return w;
  }, [words, search, filterTag, filterCategory, filterDifficulty, sortBy]);

  const getAllTags = useCallback(() => {
    const set = new Set();
    words.forEach((w) => (w.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [words]);

  // ─── Tag classification helpers ───
  const isSubjectTag = (tag) => /^[A-Z]+\d+$/.test(tag);
  const isSourceTag = (tag) => tag.includes("-");
  const isCategoryTag = (tag) => !isSubjectTag(tag) && !isSourceTag(tag);

  // Determine if a source tag is mid-level (one segment after subject) or detail (2+ segments)
  const isMidLevelSourceTag = (tag, subject) => {
    if (!tag.startsWith(subject + "-")) return false;
    const rest = tag.slice(subject.length + 1);
    return !rest.includes("-");
  };

  const getSubjectTags = useCallback(() => {
    const counts = {};
    words.forEach((w) =>
      (w.tags || []).filter(isSubjectTag).forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      }),
    );
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [words]);

  // Get all source tags for a subject (used by quiz scope)
  const getSourceTagsForSubject = useCallback(
    (subject) => {
      const counts = {};
      words.forEach((w) => {
        const tags = w.tags || [];
        if (tags.some(t => t === subject || t.startsWith(subject + "-"))) {
          tags
            .filter((t) => isSourceTag(t) && t.startsWith(subject + "-"))
            .forEach((t) => {
              counts[t] = (counts[t] || 0) + 1;
            });
        }
      });
      return Object.entries(counts).sort((a, b) => {
        const aNum = a[0].replace(subject + "-", "");
        const bNum = b[0].replace(subject + "-", "");
        return aNum.localeCompare(bNum, undefined, { numeric: true });
      });
    },
    [words],
  );

  // Get mid-level tags for a subject (Level 2)
  const getMidLevelTagsForSubject = useCallback(
    (subject) => {
      // Collect all unique mid-level prefixes from source tags
      const midSet = new Set();
      words.forEach((w) => {
        const tags = w.tags || [];
        if (tags.some(t => t === subject || t.startsWith(subject + "-"))) {
          tags.filter((t) => isSourceTag(t) && t.startsWith(subject + "-")).forEach((t) => {
            const rest = t.slice(subject.length + 1);
            const firstSegment = rest.split("-")[0];
            midSet.add(subject + "-" + firstSegment);
          });
        }
      });
      // Count words for each mid-level (including words that have detail tags under it)
      const counts = {};
      midSet.forEach((mid) => {
        counts[mid] = words.filter((w) => {
          const tags = w.tags || [];
          return tags.some((t) => t === mid || t.startsWith(mid + "-"));
        }).length;
      });
      return Object.entries(counts).sort((a, b) => {
        const aLabel = a[0].replace(subject + "-", "");
        const bLabel = b[0].replace(subject + "-", "");
        return aLabel.localeCompare(bLabel, undefined, { numeric: true });
      });
    },
    [words],
  );

  // Get detail-level tags for a mid-level tag (Level 3)
  const getDetailTagsForMidLevel = useCallback(
    (midLevel) => {
      const counts = {};
      words.forEach((w) => {
        const tags = w.tags || [];
        tags.filter((t) => isSourceTag(t) && t.startsWith(midLevel + "-")).forEach((t) => {
          counts[t] = (counts[t] || 0) + 1;
        });
      });
      return Object.entries(counts).sort((a, b) => {
        const aLabel = a[0].replace(midLevel + "-", "");
        const bLabel = b[0].replace(midLevel + "-", "");
        return aLabel.localeCompare(bLabel, undefined, { numeric: true });
      });
    },
    [words],
  );

  // Check if a subject has any detail-level tags (determines if 3-level hierarchy is needed)
  const subjectHasDetailTags = useCallback(
    (subject) => {
      return words.some((w) => {
        const tags = w.tags || [];
        return tags.some((t) => {
          if (!t.startsWith(subject + "-")) return false;
          const rest = t.slice(subject.length + 1);
          return rest.includes("-");
        });
      });
    },
    [words],
  );

  const getCategoryTags = useCallback(() => {
    const counts = {};
    words.forEach((w) =>
      (w.tags || []).filter(isCategoryTag).forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      }),
    );
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [words]);

  const getSubjectWordCount = useCallback(
    (subject) => {
      return words.filter((w) => {
        const tags = w.tags || [];
        return tags.some((t) => t === subject || t.startsWith(subject + "-"));
      }).length;
    },
    [words],
  );

  const getMidLevelWordCount = useCallback(
    (midLevel) => {
      return words.filter((w) => {
        const tags = w.tags || [];
        return tags.some((t) => t === midLevel || t.startsWith(midLevel + "-"));
      }).length;
    },
    [words],
  );

  const handleSubjectClick = (subject) => {
    if (activeSubject === subject) {
      setActiveSubjectState("");
      setActiveSourceState("");
      setActiveDetailState("");
      setFilterTag("");
    } else {
      setActiveSubjectState(subject);
      setActiveSourceState("");
      setActiveDetailState("");
      setFilterTag(subject);
    }
  };

  const handleSourceClick = (source) => {
    if (activeSource === source) {
      setActiveSourceState("");
      setActiveDetailState("");
      setFilterTag(activeSubject);
    } else {
      setActiveSourceState(source);
      setActiveDetailState("");
      setFilterTag(source || activeSubject);
    }
  };

  const handleDetailClick = (detail) => {
    if (activeDetail === detail) {
      setActiveDetailState("");
      setFilterTag(activeSource);
    } else {
      setActiveDetailState(detail);
      setFilterTag(detail || activeSource);
    }
  };

  // Get visible tags for a word card (compact display)
  const getVisibleTags = useCallback(
    (wordTags) => {
      const tags = wordTags || [];
      // 1. Remove redundant parent tags (keep only the most specific hierarchical tag per chain)
      const filtered = tags.filter((t) => {
        if (isSubjectTag(t)) {
          // Hide subject tag if a more specific source tag exists for it
          return !tags.some((other) => other.startsWith(t + "-"));
        }
        if (isSourceTag(t)) {
          // Hide mid-level if a more specific detail tag exists
          return !tags.some((other) => other !== t && other.startsWith(t + "-"));
        }
        return true; // Always show category tags
      });
      // 2. Hide tags that match the current active filter context
      return filtered.filter((t) => {
        if (activeDetail && t === activeDetail) return false;
        if (activeSource && t === activeSource) return false;
        if (activeSubject && t === activeSubject) return false;
        return true;
      });
    },
    [activeSubject, activeSource, activeDetail],
  );

  const isQuiz = view === "quiz";
  const isFill = view === "fillblank";
  const isMatch = view === "match";
  const isTagManager = view === "tags";
  const filtered = getFiltered();
  const allTags = getAllTags();
  const subjectTags = getSubjectTags();
  const categoryTags = getCategoryTags();
  const hasFilters = search || filterTag || filterCategory || filterDifficulty > 0;

  // ─── Render: Quiz Scope Selector ───
  const renderQuizScope = () => {
    const scopedWords = getQuizScopedWords();
    const scopedSubjects = getSubjectTags();
    const scopedCategories = getCategoryTags();
    const quizHasDetail = quizSubject ? subjectHasDetailTags(quizSubject) : false;
    const quizMidTags = quizSubject && quizHasDetail ? getMidLevelTagsForSubject(quizSubject) : [];
    const quizSourceTags = quizSubject && !quizHasDetail ? getSourceTagsForSubject(quizSubject) : [];
    const quizDetailTags = quizSource ? getDetailTagsForMidLevel(quizSource) : [];

    return (
      <div className="quiz-scope">
        {/* Subject selection */}
        {scopedSubjects.length > 0 && (
          <div className="quiz-scope-section">
            <div className="quiz-scope-label">과목</div>
            <div className="quiz-scope-tags">
              <button
                className={`tag-tab${quizSubject === "" ? " active" : ""}`}
                onClick={() => {
                  setQuizSubject("");
                  setQuizSource("");
                  setQuizDetail("");
                }}
              >
                전체
              </button>
              {scopedSubjects.map(([t, c]) => (
                <button
                  key={t}
                  className={`tag-tab${quizSubject === t ? " active" : ""}`}
                  onClick={() => {
                    setQuizSubject(quizSubject === t ? "" : t);
                    setQuizSource("");
                    setQuizDetail("");
                  }}
                >
                  {t}<span className="tag-tab-count">{c}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Source selection (Level 2) - 3-level mode: mid-level tags */}
        {quizSubject && quizHasDetail && quizMidTags.length > 0 && (
          <div className="quiz-scope-section">
            <div className="quiz-scope-label">범위</div>
            <div className="quiz-scope-tags">
              <button
                className={`tag-tab${quizSource === "" ? " active" : ""}`}
                onClick={() => { setQuizSource(""); setQuizDetail(""); }}
              >
                전체
              </button>
              {quizMidTags.map(([t, c]) => {
                const label = t.replace(quizSubject + "-", "");
                return (
                  <button
                    key={t}
                    className={`tag-tab${quizSource === t ? " active" : ""}`}
                    onClick={() => { setQuizSource(quizSource === t ? "" : t); setQuizDetail(""); }}
                  >
                    {label}<span className="tag-tab-count">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Source selection (Level 2) - 2-level mode: all source tags */}
        {quizSubject && !quizHasDetail && quizSourceTags.length > 0 && (
          <div className="quiz-scope-section">
            <div className="quiz-scope-label">범위</div>
            <div className="quiz-scope-tags">
              <button
                className={`tag-tab${quizSource === "" ? " active" : ""}`}
                onClick={() => setQuizSource("")}
              >
                전체
              </button>
              {quizSourceTags.map(([t, c]) => {
                const label = t.replace(quizSubject + "-", "");
                return (
                  <button
                    key={t}
                    className={`tag-tab${quizSource === t ? " active" : ""}`}
                    onClick={() => setQuizSource(quizSource === t ? "" : t)}
                  >
                    {label}<span className="tag-tab-count">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Detail selection (Level 3) */}
        {quizSource && quizDetailTags.length > 0 && (
          <div className="quiz-scope-section">
            <div className="quiz-scope-label">세부 범위</div>
            <div className="quiz-scope-tags">
              <button
                className={`tag-tab${quizDetail === "" ? " active" : ""}`}
                onClick={() => setQuizDetail("")}
              >
                전체
              </button>
              {quizDetailTags.map(([t, c]) => {
                const label = t.replace(quizSource + "-", "");
                return (
                  <button
                    key={t}
                    className={`tag-tab${quizDetail === t ? " active" : ""}`}
                    onClick={() => setQuizDetail(quizDetail === t ? "" : t)}
                  >
                    {label}<span className="tag-tab-count">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Category selection */}
        {scopedCategories.length > 0 && (
          <div className="quiz-scope-section">
            <div className="quiz-scope-label">카테고리</div>
            <div className="quiz-scope-tags">
              <button
                className={`tag-tab${quizCategory === "" ? " active" : ""}`}
                onClick={() => setQuizCategory("")}
              >
                전체
              </button>
              {scopedCategories.map(([t, c]) => (
                <button
                  key={t}
                  className={`tag-tab${quizCategory === t ? " active" : ""}`}
                  onClick={() => setQuizCategory(quizCategory === t ? "" : t)}
                >
                  {t}<span className="tag-tab-count">{c}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="quiz-scope-count">
          선택된 단어: <strong>{scopedWords.length}</strong>개
        </div>
      </div>
    );
  };

  // ─── Render: Quiz ───
  const renderQuiz = () => {
    if (!quizMode) {
      const scopedCount = getQuizScopedWords().length;
      return (
        <div className="quiz-center fade-in">
          <div className="quiz-title">복습 퀴즈</div>
          {renderQuizScope()}
          <div className="quiz-sub">
            {Math.min(20, scopedCount)}개 단어로 퀴즈를 시작합니다
          </div>
          <div className="quiz-modes">
            <button
              className="quiz-mode-btn"
              onClick={() => startQuiz("en-ko")}
              disabled={scopedCount < 3}
            >
              <div className="emoji">🇺🇸 → 🇰🇷</div>
              <div className="label">영어 → 한국어</div>
            </button>
            <button
              className="quiz-mode-btn"
              onClick={() => startQuiz("ko-en")}
              disabled={scopedCount < 3}
            >
              <div className="emoji">🇰🇷 → 🇺🇸</div>
              <div className="label">한국어 → 영어</div>
            </button>
          </div>
          {scopedCount < 3 && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
              최소 3개 이상의 단어가 필요합니다
            </div>
          )}
        </div>
      );
    }

    if (quizFinished || quizPool.length === 0) {
      const total = quizScore.correct + quizScore.wrong;
      const pct = total > 0 ? Math.round((quizScore.correct / total) * 100) : 0;
      const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "💪" : "📖";
      return (
        <div className="quiz-center fade-in">
          <div className="quiz-result-icon">{emoji}</div>
          <div className="quiz-title">퀴즈 완료!</div>
          <div className="quiz-result-pct">{pct}%</div>
          <div className="quiz-result-detail">
            {total}개 중 {quizScore.correct}개 정답
          </div>
          <div className="quiz-result-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setQuizMode(null);
                setQuizFinished(false);
              }}
            >
              다시 하기
            </button>
            <button className="btn btn-outline" onClick={() => setView("list")}>
              돌아가기
            </button>
          </div>
        </div>
      );
    }

    const w = quizPool[quizCurrent];
    const question = quizMode === "en-ko" ? w.term : w.meaning;
    const answer = quizMode === "en-ko" ? w.meaning : w.term;
    const qLabel =
      quizMode === "en-ko" ? "이 단어의 뜻은?" : "이 뜻의 영어 단어는?";
    const hint = w.example
      ? w.example.replace(
          new RegExp(w.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
          "____",
        )
      : null;

    return (
      <div style={{ maxWidth: 500, margin: "0 auto" }} className="fade-in">
        <div className="quiz-header">
          <span>
            {quizCurrent + 1} / {quizPool.length}
          </span>
          <div>
            <span className="quiz-score-ok">✓ {quizScore.correct}</span>
            &nbsp;&nbsp;
            <span className="quiz-score-fail">✗ {quizScore.wrong}</span>
          </div>
        </div>
        <div className="quiz-progress-bar">
          <div
            className="quiz-progress-fill"
            style={{ width: `${(quizCurrent / quizPool.length) * 100}%` }}
          />
        </div>
        <div className="quiz-center">
          <div className="quiz-question-label">{qLabel}</div>
          <div className="quiz-question-word">
            {question}{" "}
            {quizMode === "en-ko" && (
              <button
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  opacity: 0.5,
                  fontSize: 20,
                  verticalAlign: "middle",
                }}
                onClick={(e) => speak(w.term, e)}
              >
                🔊
              </button>
            )}
          </div>
          {hint && !quizShowAnswer && (
            <div className="quiz-hint">힌트: {hint}</div>
          )}
          {!quizShowAnswer ? (
            <button
              className="quiz-reveal-btn"
              onClick={() => setQuizShowAnswer(true)}
            >
              정답 보기
            </button>
          ) : (
            <>
              <div className="quiz-answer-box">
                <div className="quiz-answer-text">
                  {answer}{" "}
                  <button
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      opacity: 0.5,
                      fontSize: 18,
                      verticalAlign: "middle",
                    }}
                    onClick={(e) =>
                      speak(quizMode === "en-ko" ? answer : w.term, e)
                    }
                  >
                    🔊
                  </button>
                </div>
                {w.example && (
                  <div className="quiz-answer-example">{w.example}</div>
                )}
              </div>
              <div className="quiz-judge">
                <button className="quiz-wrong" onClick={() => quizJudge(false)}>
                  몰랐어요 ✗
                </button>
                <button className="quiz-right" onClick={() => quizJudge(true)}>
                  알았어요 ✓
                </button>
              </div>
            </>
          )}
        </div>
        <button
          className="btn-ghost"
          style={{ width: "100%", marginTop: 20, textAlign: "center" }}
          onClick={() => setView("list")}
        >
          퀴즈 종료
        </button>
      </div>
    );
  };

  // ─── Render: Fill-in-the-Blank ───
  const renderFillBlank = () => {
    // Selection screen
    if (fillPool.length === 0 && !fillFinished) {
      const scoped = getQuizScopedWords();
      const wordsWithEx = scoped.filter(
        (w) =>
          w.term &&
          w.example &&
          w.example.toLowerCase().includes(w.term.toLowerCase()),
      );
      return (
        <div className="quiz-center fade-in">
          <div className="quiz-title">빈칸 퀴즈</div>
          {renderQuizScope()}
          <div className="quiz-sub">
            예문이 있는 단어 {wordsWithEx.length}개로 퀴즈를 시작합니다
          </div>
          <button
            className="btn btn-primary"
            onClick={startFillBlank}
            disabled={wordsWithEx.length < 3}
            style={{ marginTop: 12 }}
          >
            시작하기
          </button>
          {wordsWithEx.length < 3 && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
              예문이 있는 단어가 3개 이상 필요합니다
            </div>
          )}
        </div>
      );
    }

    if (fillFinished) {
      const total = fillScore.correct + fillScore.wrong;
      const pct = total > 0 ? Math.round((fillScore.correct / total) * 100) : 0;
      const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "💪" : "📖";
      return (
        <div className="quiz-center fade-in">
          <div className="quiz-result-icon">{emoji}</div>
          <div className="quiz-title">빈칸 퀴즈 완료!</div>
          <div className="quiz-result-pct">{pct}%</div>
          <div className="quiz-result-detail">
            {total}개 중 {fillScore.correct}개 정답
          </div>
          <div className="quiz-result-actions">
            <button className="btn btn-primary" onClick={() => {
              setFillPool([]);
              setFillFinished(false);
            }}>
              다시 하기
            </button>
            <button className="btn btn-outline" onClick={() => setView("list")}>
              돌아가기
            </button>
          </div>
        </div>
      );
    }
    const w = fillPool[fillCurrent];
    const regex = new RegExp(
      w.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    const parts = w.example.split(regex);
    return (
      <div style={{ maxWidth: 560, margin: "0 auto" }} className="fade-in">
        <div className="quiz-header">
          <span>
            {fillCurrent + 1} / {fillPool.length}
          </span>
          <div>
            <span className="quiz-score-ok">✓ {fillScore.correct}</span>
            &nbsp;&nbsp;
            <span className="quiz-score-fail">✗ {fillScore.wrong}</span>
          </div>
        </div>
        <div className="quiz-progress-bar">
          <div
            className="quiz-progress-fill"
            style={{ width: `${(fillCurrent / fillPool.length) * 100}%` }}
          />
        </div>
        <div className="quiz-center">
          <div className="quiz-question-label">
            빈칸에 들어갈 단어를 입력하세요
          </div>
          <div
            style={{ marginBottom: 12, fontSize: 15, color: "var(--text-dim)" }}
          >
            {w.meaning}
          </div>
          <div className="fill-sentence" style={{ marginBottom: 24 }}>
            {parts.map((part, i) => (
              <span key={i}>
                {part}
                {i < parts.length - 1 &&
                  (fillAnswered ? (
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>
                      {w.term}
                    </span>
                  ) : (
                    <input
                      className="fill-blank-input"
                      id="fill-input"
                      placeholder="?"
                      autoComplete="off"
                      autoCapitalize="off"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") fillCheck();
                      }}
                    />
                  ))}
              </span>
            ))}
          </div>
          {!fillAnswered ? (
            <button className="quiz-reveal-btn" onClick={fillCheck}>
              확인
            </button>
          ) : (
            <>
              <div
                className="quiz-answer-box"
                style={{
                  borderColor:
                    fillUserAnswer === w.term.toLowerCase()
                      ? "rgba(90,171,106,0.4)"
                      : "rgba(212,84,84,0.4)",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    color:
                      fillUserAnswer === w.term.toLowerCase()
                        ? "var(--success)"
                        : "var(--danger)",
                    marginBottom: 4,
                  }}
                >
                  {fillUserAnswer === w.term.toLowerCase()
                    ? "정답! ✓"
                    : "오답 ✗"}
                </div>
                {fillUserAnswer !== w.term.toLowerCase() && (
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    내 답:{" "}
                    <span style={{ textDecoration: "line-through" }}>
                      {fillUserAnswer || "(빈 답)"}
                    </span>
                  </div>
                )}
                <div
                  className="quiz-answer-text"
                  style={{ color: "var(--accent)" }}
                >
                  {w.term}{" "}
                  <button
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      opacity: 0.5,
                      fontSize: 18,
                      verticalAlign: "middle",
                    }}
                    onClick={(e) => speak(w.term, e)}
                  >
                    🔊
                  </button>
                </div>
              </div>
              <button
                className="quiz-reveal-btn"
                onClick={fillNext}
                style={{ marginTop: 12 }}
              >
                {fillCurrent + 1 >= fillPool.length ? "결과 보기" : "다음 →"}
              </button>
            </>
          )}
        </div>
        <button
          className="btn-ghost"
          style={{ width: "100%", marginTop: 20, textAlign: "center" }}
          onClick={() => setView("list")}
        >
          퀴즈 종료
        </button>
      </div>
    );
  };

  // ─── Render: Form ───
  const renderForm = (initial) => {
    const isEdit = !!initial;
    const onSubmit = isEdit ? handleEdit : handleAdd;
    return (
      <div className="form-panel fade-in">
        <div className="form-title">
          {isEdit ? "단어 수정" : "새 단어 추가"}
        </div>
        <div className="form-grid">
          <div className="form-row2">
            <div>
              <label className="form-label">단어 *</label>
              <input
                id="f-term"
                className="form-input"
                placeholder="English word"
                defaultValue={initial?.term || ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
              />
            </div>
            <div>
              <label className="form-label">뜻 *</label>
              <input
                id="f-meaning"
                className="form-input"
                placeholder="한국어 뜻"
                defaultValue={initial?.meaning || ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
              />
            </div>
          </div>
          <div>
            <label className="form-label">예문</label>
            <input
              id="f-example"
              className="form-input"
              placeholder="The word in context..."
              defaultValue={initial?.example || ""}
            />
          </div>
          <div>
            <label className="form-label">메모</label>
            <textarea
              id="f-notes"
              className="form-textarea"
              placeholder="어원, 유의어, 참고 사항 등"
              defaultValue={initial?.notes || ""}
            />
          </div>
          <div className="form-bottom-row">
            <div>
              <label className="form-label">태그</label>
              <div className="tag-input-row">
                <input
                  id="f-tag-input"
                  className="form-input"
                  placeholder="예: COMP1010, 게임용어"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFormTag();
                    }
                  }}
                />
                <button className="btn-tag" onClick={addFormTag}>
                  + 태그
                </button>
              </div>
              <div className="tag-list">
                {formTags.map((t) => (
                  <span
                    key={t}
                    className="tag tag-removable"
                    onClick={() => removeFormTag(t)}
                  >
                    {t} <span style={{ opacity: 0.5 }}>×</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">난이도</label>
              <div className="stars" style={{ cursor: "pointer" }}>
                {[1, 2, 3].map((i) => (
                  <button
                    key={i}
                    className="star"
                    onClick={() =>
                      setFormDifficulty(formDifficulty === i ? 0 : i)
                    }
                  >
                    <StarSvg filled={i <= formDifficulty} size={20} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button
            className="btn btn-outline"
            onClick={() => {
              setFormTags([]);
              setFormDifficulty(0);
              setView("list");
              setEditWord(null);
            }}
          >
            취소
          </button>
          <button className="btn btn-primary" onClick={onSubmit}>
            {isEdit ? "수정 완료" : "추가"}
          </button>
        </div>
      </div>
    );
  };

  // ─── Render: List ───
  const renderList = () => (
    <>
      <div className="data-bar">
        {hasNotionCredentials && words.some((w) => w._localOnly) && (
          <button
            className="btn btn-outline"
            style={{
              fontSize: 12,
              padding: "6px 12px",
              ...(syncStatus === "syncing" ? { opacity: 0.5, pointerEvents: "none" } : {}),
            }}
            onClick={uploadAllToNotion}
          >
            ↑ Notion 업로드
          </button>
        )}
        {words.length > 0 && (
          <>
            <button
              className="btn btn-outline"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={exportWords}
            >
              JSON 내보내기
            </button>
            <button
              className="btn btn-outline"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={exportCSV}
            >
              CSV 내보내기
            </button>
          </>
        )}
        <button
          className="btn btn-outline"
          style={{ fontSize: 12, padding: "6px 12px" }}
          onClick={importWords}
        >
          가져오기
        </button>
        {getDuplicateCount() > 0 && (
          <button
            className="btn btn-outline btn-merge"
            style={{ fontSize: 12, padding: "6px 12px" }}
            onClick={() => {
              if (window.confirm(`중복된 단어 ${getDuplicateCount()}개를 통합하시겠습니까?\n같은 단어의 태그가 합쳐지고, 뜻/메모가 병합됩니다.`)) {
                mergeDuplicates();
              }
            }}
          >
            중복 통합
          </button>
        )}
      </div>

      <div className="search-wrap">
        <svg
          className="search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text)"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="search-input"
          placeholder="단어, 뜻, 메모로 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="filters">
        <select
          className="filter-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="newest">최신순</option>
          <option value="oldest">오래된순</option>
          <option value="alpha">알파벳순</option>
          <option value="difficulty">난이도순</option>
        </select>
        {categoryTags.length > 0 && (
          <select
            className={`filter-select${filterCategory ? " active" : ""}`}
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">모든 카테고리</option>
            {categoryTags.map(([t, c]) => (
              <option key={t} value={t}>
                {t} ({c})
              </option>
            ))}
          </select>
        )}
        {[1, 2, 3].map((d) => (
          <button
            key={d}
            className={`diff-btn${filterDifficulty === d ? " active" : ""}`}
            onClick={() => setFilterDifficulty(filterDifficulty === d ? 0 : d)}
          >
            <StarSvg filled={filterDifficulty === d} size={12} />
            <span>{d}</span>
          </button>
        ))}
        {hasFilters && (
          <button
            className="filter-reset"
            onClick={() => {
              setSearch("");
              setFilterTag("");
              setFilterCategory("");
              setFilterDifficulty(0);
              setActiveSubjectState("");
              setActiveSourceState("");
              setActiveDetailState("");
            }}
          >
            필터 초기화
          </button>
        )}
        <span className="filter-count">{filtered.length}개 표시</span>
      </div>

      {/* Hierarchical Tag Tabs (up to 3 levels) */}
      {(subjectTags.length > 0 || words.length > 0) && (
        <div className="tag-hierarchy">
          {/* Level 1: Subject tabs */}
          <div className="tag-level">
            <button
              className={`tag-tab${activeSubject === "" ? " active" : ""}`}
              onClick={() => handleSubjectClick("")}
            >
              전체<span className="tag-tab-count">{words.length}</span>
            </button>
            {subjectTags.map(([t, c]) => (
              <button
                key={t}
                className={`tag-tab${activeSubject === t ? " active" : ""}`}
                onClick={() => handleSubjectClick(t)}
              >
                {t}<span className="tag-tab-count">{c}</span>
              </button>
            ))}
          </div>
          {/* Level 2: Mid-level tabs (only when subject is selected) */}
          {activeSubject && (() => {
            const hasDetail = subjectHasDetailTags(activeSubject);
            if (hasDetail) {
              // 3-level mode: show mid-level tags at Level 2
              const midTags = getMidLevelTagsForSubject(activeSubject);
              if (midTags.length === 0) return null;
              const subjectCount = getSubjectWordCount(activeSubject);
              return (
                <div className="tag-level tag-level-2">
                  <button
                    className={`tag-tab${activeSource === "" ? " active" : ""}`}
                    onClick={() => handleSourceClick("")}
                  >
                    전체<span className="tag-tab-count">{subjectCount}</span>
                  </button>
                  {midTags.map(([t, c]) => {
                    const label = t.replace(activeSubject + "-", "");
                    return (
                      <button
                        key={t}
                        className={`tag-tab${activeSource === t ? " active" : ""}`}
                        onClick={() => handleSourceClick(t)}
                      >
                        {label}<span className="tag-tab-count">{c}</span>
                      </button>
                    );
                  })}
                </div>
              );
            } else {
              // 2-level mode: show all source tags at Level 2 (no detail tags exist)
              const sourceTags = getSourceTagsForSubject(activeSubject);
              if (sourceTags.length === 0) return null;
              const subjectCount = getSubjectWordCount(activeSubject);
              return (
                <div className="tag-level tag-level-2">
                  <button
                    className={`tag-tab${activeSource === "" ? " active" : ""}`}
                    onClick={() => handleSourceClick("")}
                  >
                    전체<span className="tag-tab-count">{subjectCount}</span>
                  </button>
                  {sourceTags.map(([t, c]) => {
                    const label = t.replace(activeSubject + "-", "");
                    return (
                      <button
                        key={t}
                        className={`tag-tab${activeSource === t ? " active" : ""}`}
                        onClick={() => handleSourceClick(t)}
                      >
                        {label}<span className="tag-tab-count">{c}</span>
                      </button>
                    );
                  })}
                </div>
              );
            }
          })()}
          {/* Level 3: Detail tabs (only when mid-level is selected and detail tags exist) */}
          {activeSource && (() => {
            const detailTags = getDetailTagsForMidLevel(activeSource);
            if (detailTags.length === 0) return null;
            const midCount = getMidLevelWordCount(activeSource);
            return (
              <div className="tag-level tag-level-3">
                <button
                  className={`tag-tab${activeDetail === "" ? " active" : ""}`}
                  onClick={() => handleDetailClick("")}
                >
                  전체<span className="tag-tab-count">{midCount}</span>
                </button>
                {detailTags.map(([t, c]) => {
                  const label = t.replace(activeSource + "-", "");
                  return (
                    <button
                      key={t}
                      className={`tag-tab${activeDetail === t ? " active" : ""}`}
                      onClick={() => handleDetailClick(t)}
                    >
                      {label}<span className="tag-tab-count">{c}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {filtered.length === 0 ? (
        words.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📚</div>
            <div className="empty-title">단어장이 비어 있어요</div>
            <div className="empty-sub">
              &#39;+ 단어 추가&#39; 버튼으로 첫 단어를 등록해 보세요
            </div>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">🔍</div>
            <div className="empty-title">검색 결과가 없습니다</div>
            <div className="empty-sub">
              다른 키워드로 검색하거나 필터를 조정해 보세요
            </div>
          </div>
        )
      ) : (
        filtered.map((w) => {
          const isExpanded = expandedId === w.id;
          return (
            <div
              key={w.id}
              className="word-card fade-in"
              onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}
            >
              <div className="card-main">
                <div className="card-top">
                  <div className="card-left">
                    <div className="term-row">
                      <span className="term">{w.term}</span>
                      <span
                        className="star"
                        onClick={(e) => speak(w.term, e)}
                        title="발음 듣기"
                        style={{
                          cursor: "pointer",
                          opacity: 0.5,
                          fontSize: 16,
                        }}
                      >
                        🔊
                      </span>
                      <Stars
                        rating={w.difficulty || 0}
                        interactive
                        onRate={(r) => {
                          handleRate(w.id, r);
                        }}
                      />
                    </div>
                    <div className="meaning">{w.meaning}</div>
                  </div>
                  <div className="card-right">
                    {getVisibleTags(w.tags).map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                    <span className="date">{formatDate(w.createdAt)}</span>
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div
                  className="card-detail"
                  onClick={(e) => e.stopPropagation()}
                >
                  {w.example && (
                    <>
                      <div className="detail-label">예문</div>
                      <div className="detail-example">{w.example}</div>
                    </>
                  )}
                  {w.notes && (
                    <>
                      <div className="detail-label">메모</div>
                      <div className="detail-notes">{w.notes}</div>
                    </>
                  )}
                  <div className="card-actions">
                    <button
                      className="btn btn-outline"
                      onClick={() => {
                        setFormTags([...(w.tags || [])]);
                        setFormDifficulty(w.difficulty || 0);
                        setEditWord(w);
                        setView("edit");
                      }}
                    >
                      수정
                    </button>
                    <button
                      className="btn btn-outline btn-danger"
                      onClick={() => {
                        if (confirm("정말 삭제할까요?")) handleDelete(w.id);
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );

  // ─── Render: Matching Quiz ───
  const renderMatchQuiz = () => {
    // Selection screen
    if (!matchStarted) {
      const scopedCount = getQuizScopedWords().length;
      return (
        <div className="quiz-center fade-in">
          <div className="quiz-title">매칭 퀴즈</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 12 }}>
            단어와 뜻을 짝 맞추세요
          </div>
          {renderQuizScope()}
          <div className="quiz-sub">
            {scopedCount}개 단어 ({Math.ceil(Math.min(scopedCount, 30) / MATCH_PER_ROUND)}라운드)
          </div>
          <button
            className="btn btn-primary"
            onClick={startMatchQuiz}
            disabled={scopedCount < 4}
            style={{ marginTop: 4 }}
          >
            시작하기
          </button>
          {scopedCount < 4 && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
              최소 4개 이상의 단어가 필요합니다
            </div>
          )}
        </div>
      );
    }

    // Result screen
    if (matchFinished) {
      const pct = matchTotalCount > 0
        ? Math.round((matchTotalCorrect / matchTotalCount) * 100) : 0;
      const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "💪" : "📖";
      return (
        <div className="quiz-center fade-in">
          <div className="quiz-result-icon">{emoji}</div>
          <div className="quiz-title">매칭 퀴즈 완료!</div>
          <div className="quiz-result-pct">{pct}%</div>
          <div className="quiz-result-detail">
            {matchTotalCount}번 시도, {matchTotalCorrect}번 정답
          </div>
          <div className="quiz-result-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setMatchStarted(false);
                setMatchFinished(false);
              }}
            >
              다시 하기
            </button>
            <button className="btn btn-outline" onClick={() => setView("list")}>
              돌아가기
            </button>
          </div>
        </div>
      );
    }

    // Game board
    const roundTotal = Math.ceil(Math.min(matchPool.length, 30) / MATCH_PER_ROUND);
    const pairedCount = Object.keys(matchPaired).length;

    return (
      <div style={{ maxWidth: 600, margin: "0 auto" }} className="fade-in">
        <div className="quiz-header">
          <span>라운드 {matchRound + 1} / {roundTotal}</span>
          <div>
            <span className="quiz-score-ok">✓ {matchTotalCorrect}</span>
            &nbsp;&nbsp;
            <span className="quiz-score-fail">✗ {matchTotalCount - matchTotalCorrect}</span>
          </div>
        </div>
        <div className="quiz-progress-bar">
          <div
            className="quiz-progress-fill"
            style={{ width: `${(pairedCount / matchTerms.length) * 100}%` }}
          />
        </div>

        <div className="match-board">
          {/* Terms column */}
          <div className="match-column">
            {matchTerms.map((t, i) => {
              const isPaired = i in matchPaired;
              const isSelected = matchSelected?.side === "term" && matchSelected.index === i;
              const isWrong = matchWrong?.term === i;
              return (
                <button
                  key={i}
                  className={`match-card match-term${isPaired ? " paired" : ""}${isSelected ? " selected" : ""}${isWrong ? " wrong" : ""}`}
                  onClick={() => !isPaired && handleMatchSelect("term", i)}
                  disabled={isPaired}
                >
                  {t.text}
                </button>
              );
            })}
          </div>

          {/* Meanings column */}
          <div className="match-column">
            {matchMeanings.map((m, i) => {
              const isPaired = Object.values(matchPaired).includes(i);
              const isSelected = matchSelected?.side === "meaning" && matchSelected.index === i;
              const isWrong = matchWrong?.meaning === i;
              return (
                <button
                  key={i}
                  className={`match-card match-meaning${isPaired ? " paired" : ""}${isSelected ? " selected" : ""}${isWrong ? " wrong" : ""}`}
                  onClick={() => !isPaired && handleMatchSelect("meaning", i)}
                  disabled={isPaired}
                >
                  {m.text}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Tag Manager ───
  const renderTagManager = () => {
    // Build tag list with counts
    const tagMap = {};
    words.forEach((w) =>
      (w.tags || []).forEach((t) => {
        tagMap[t] = (tagMap[t] || 0) + 1;
      }),
    );
    const tagList = Object.entries(tagMap).sort((a, b) => a[0].localeCompare(b[0]));
    // 노션 DB에 옵션으로만 남아 있고 어떤 단어에도 없는 태그
    const unusedTags = (notionTagOptions || [])
      .filter((t) => !tagMap[t])
      .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
    const selectedIsUnused = !!tmSelectedTag && !tagMap[tmSelectedTag] && unusedTags.includes(tmSelectedTag);

    // Words with selected tag
    const taggedWords = tmSelectedTag
      ? words.filter((w) => (w.tags || []).includes(tmSelectedTag))
      : [];

    return (
      <>
        <div className="tm-layout">
          {/* Left: Tag list */}
          <div className="tm-sidebar">
            <div className="tm-section-title">전체 태그 ({tagList.length})</div>
            <div className="tm-tag-list">
              {tagList.map(([t, c]) => (
                <button
                  key={t}
                  className={`tm-tag-item${tmSelectedTag === t ? " active" : ""}`}
                  onClick={() => {
                    setTmSelectedTag(tmSelectedTag === t ? "" : t);
                    setTmSelectedWords(new Set());
                    setTmAction("");
                    setTmRenameInput(t);
                    setTmMergeTarget("");
                    setTmBulkAddInput("");
                  }}
                >
                  <span className="tm-tag-name">{t}</span>
                  <span className="tm-tag-count">{c}</span>
                </button>
              ))}
              {tagList.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: 13, padding: 12 }}>
                  태그가 없습니다
                </div>
              )}
            </div>
            {notionTagRebuilding && (
              <div className="tm-panel" style={{ margin: "8px 0" }}>
                <div className="tm-panel-hint">태그 정리가 중간에 멈춰 있어요.</div>
                <div className="tm-panel-row">
                  <button
                    className="btn btn-primary"
                    disabled={!!busy}
                    onClick={() => runTagRebuild([])}
                  >
                    이어서 하기
                  </button>
                </div>
              </div>
            )}
            {unusedTags.length > 0 && (
              <>
                <div className="tm-section-title tm-unused-title">
                  <span>단어 없는 태그 ({unusedTags.length})</span>
                  <button
                    className="tm-unused-all"
                    disabled={!!busy}
                    onClick={() => deleteUnusedTags(unusedTags)}
                  >
                    모두 삭제
                  </button>
                </div>
                <div className="tm-tag-list">
                  {unusedTags.map((t) => (
                    <button
                      key={t}
                      className={`tm-tag-item tm-tag-unused${tmSelectedTag === t ? " active" : ""}`}
                      onClick={() => {
                        setTmSelectedTag(tmSelectedTag === t ? "" : t);
                        setTmSelectedWords(new Set());
                        setTmAction("");
                      }}
                    >
                      <span className="tm-tag-name">{t}</span>
                      <span className="tm-tag-count">0</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right: Tag detail & actions */}
          <div className="tm-main">
            {selectedIsUnused ? (
              <>
                <div className="tm-tag-header">
                  <div className="tm-tag-title">{tmSelectedTag}</div>
                  <div className="tm-tag-subtitle">0개 단어 · 노션 DB에 옵션으로만 남아 있어요</div>
                </div>
                <div className="tm-panel">
                  <div className="tm-panel-hint">
                    어떤 단어에도 쓰이지 않는 태그예요. 지워도 단어는 바뀌지 않아요.
                  </div>
                  <div className="tm-panel-row">
                    <button
                      className="btn btn-outline btn-danger"
                      disabled={!!busy}
                      onClick={() => deleteUnusedTags([tmSelectedTag])}
                    >
                      노션에서 삭제
                    </button>
                  </div>
                </div>
              </>
            ) : !tmSelectedTag ? (
              <div className="tm-empty">
                <div style={{ fontSize: 32, marginBottom: 8 }}>🏷️</div>
                <div style={{ color: "var(--text-dim)", fontSize: 14 }}>
                  왼쪽에서 태그를 선택하세요
                </div>
              </div>
            ) : (
              <>
                <div className="tm-tag-header">
                  <div className="tm-tag-title">{tmSelectedTag}</div>
                  <div className="tm-tag-subtitle">{taggedWords.length}개 단어</div>
                </div>

                {/* Action buttons */}
                <div className="tm-actions">
                  <button
                    className={`btn btn-outline tm-action-btn${tmAction === "rename" ? " active" : ""}`}
                    onClick={() => {
                      setTmAction(tmAction === "rename" ? "" : "rename");
                      setTmRenameInput(tmSelectedTag);
                    }}
                  >
                    이름 변경
                  </button>
                  <button
                    className={`btn btn-outline tm-action-btn${tmAction === "merge" ? " active" : ""}`}
                    onClick={() => {
                      setTmAction(tmAction === "merge" ? "" : "merge");
                      setTmMergeTarget("");
                    }}
                  >
                    태그 병합
                  </button>
                  <button
                    className={`btn btn-outline tm-action-btn${tmAction === "bulkAdd" ? " active" : ""}`}
                    onClick={() => {
                      setTmAction(tmAction === "bulkAdd" ? "" : "bulkAdd");
                      setTmBulkAddInput("");
                    }}
                  >
                    일괄 태그 추가
                  </button>
                  <button
                    className={`btn btn-outline tm-action-btn${tmAction === "bulkRemove" ? " active" : ""}`}
                    onClick={() => setTmAction(tmAction === "bulkRemove" ? "" : "bulkRemove")}
                  >
                    일괄 태그 제거
                  </button>
                  <button
                    className="btn btn-outline btn-danger"
                    onClick={() => {
                      if (confirm(`"${tmSelectedTag}" 태그를 모든 단어에서 삭제할까요?`))
                        tmDeleteTag(tmSelectedTag);
                    }}
                  >
                    태그 삭제
                  </button>
                </div>

                {/* Action panels */}
                {tmAction === "rename" && (
                  <div className="tm-panel">
                    <div className="tm-panel-title">태그 이름 변경</div>
                    <div className="tm-panel-row">
                      <input
                        className="tm-input"
                        value={tmRenameInput}
                        onChange={(e) => setTmRenameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            tmRenameTag(tmSelectedTag, tmRenameInput);
                            setTmAction("");
                          }
                        }}
                        placeholder="새 태그 이름"
                      />
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          tmRenameTag(tmSelectedTag, tmRenameInput);
                          setTmAction("");
                        }}
                        disabled={!tmRenameInput.trim() || tmRenameInput.trim() === tmSelectedTag}
                      >
                        변경
                      </button>
                    </div>
                  </div>
                )}

                {tmAction === "merge" && (
                  <div className="tm-panel">
                    <div className="tm-panel-title">
                      "{tmSelectedTag}"를 다른 태그로 병합
                    </div>
                    <div className="tm-panel-row">
                      <select
                        className="tm-input"
                        value={tmMergeTarget}
                        onChange={(e) => setTmMergeTarget(e.target.value)}
                      >
                        <option value="">병합할 태그 선택...</option>
                        {tagList
                          .filter(([t]) => t !== tmSelectedTag)
                          .map(([t, c]) => (
                            <option key={t} value={t}>
                              {t} ({c})
                            </option>
                          ))}
                      </select>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          if (confirm(`"${tmSelectedTag}" → "${tmMergeTarget}"로 병합할까요?`)) {
                            tmMergeTags(tmSelectedTag, tmMergeTarget);
                            setTmAction("");
                          }
                        }}
                        disabled={!tmMergeTarget}
                      >
                        병합
                      </button>
                    </div>
                  </div>
                )}

                {tmAction === "bulkAdd" && (
                  <div className="tm-panel">
                    <div className="tm-panel-title">
                      선택한 단어에 태그 추가 ({tmSelectedWords.size}개 선택됨)
                    </div>
                    <div className="tm-panel-row">
                      <input
                        className="tm-input"
                        value={tmBulkAddInput}
                        onChange={(e) => setTmBulkAddInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && tmSelectedWords.size > 0 && tmBulkAddInput.trim()) {
                            tmBulkAddTag(tmSelectedWords, tmBulkAddInput);
                            setTmBulkAddInput("");
                          }
                        }}
                        placeholder="추가할 태그 이름 (예: Week03)"
                      />
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          tmBulkAddTag(tmSelectedWords, tmBulkAddInput);
                          setTmBulkAddInput("");
                        }}
                        disabled={tmSelectedWords.size === 0 || !tmBulkAddInput.trim()}
                      >
                        추가
                      </button>
                    </div>
                    <div className="tm-panel-hint">
                      아래 목록에서 단어를 선택한 후 태그를 입력하세요
                    </div>
                  </div>
                )}

                {tmAction === "bulkRemove" && (
                  <div className="tm-panel">
                    <div className="tm-panel-title">
                      선택한 단어에서 "{tmSelectedTag}" 태그 제거 ({tmSelectedWords.size}개 선택됨)
                    </div>
                    <div className="tm-panel-row">
                      <button
                        className="btn btn-danger"
                        onClick={() => {
                          tmBulkRemoveTag(tmSelectedWords, tmSelectedTag);
                          setTmSelectedWords(new Set());
                        }}
                        disabled={tmSelectedWords.size === 0}
                      >
                        선택한 단어에서 태그 제거
                      </button>
                    </div>
                    <div className="tm-panel-hint">
                      아래 목록에서 단어를 선택하세요
                    </div>
                  </div>
                )}

                {/* Word list with checkboxes (for bulk actions) */}
                <div className="tm-word-list">
                  {(tmAction === "bulkAdd" || tmAction === "bulkRemove") && taggedWords.length > 0 && (
                    <label className="tm-word-item tm-select-all">
                      <input
                        type="checkbox"
                        checked={tmSelectedWords.size === taggedWords.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTmSelectedWords(new Set(taggedWords.map((w) => w.id)));
                          } else {
                            setTmSelectedWords(new Set());
                          }
                        }}
                      />
                      <span className="tm-word-term">전체 선택</span>
                    </label>
                  )}
                  {taggedWords.map((w) => (
                    <label
                      key={w.id}
                      className={`tm-word-item${tmSelectedWords.has(w.id) ? " selected" : ""}`}
                    >
                      {(tmAction === "bulkAdd" || tmAction === "bulkRemove") && (
                        <input
                          type="checkbox"
                          checked={tmSelectedWords.has(w.id)}
                          onChange={(e) => {
                            const next = new Set(tmSelectedWords);
                            if (e.target.checked) next.add(w.id);
                            else next.delete(w.id);
                            setTmSelectedWords(next);
                          }}
                        />
                      )}
                      <div className="tm-word-info">
                        <span className="tm-word-term">{w.term}</span>
                        <span className="tm-word-meaning">{w.meaning}</span>
                      </div>
                      <div className="tm-word-tags">
                        {(w.tags || []).map((t) => (
                          <span key={t} className={`tag${t === tmSelectedTag ? " tag-current" : ""}`}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <>
      <div className="header">
        <div className="header-inner">
          <div>
            <div className="logo">
              Vocabulary<span>.</span>
            </div>
            <div className="word-count">{words.length}개 단어 수집됨</div>
          </div>
          <div className="header-actions">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title="테마 전환"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            {(isQuiz || isFill || isMatch || isTagManager) ? (
              <button
                className="btn btn-outline"
                onClick={() => setView("list")}
              >
                돌아가기
              </button>
            ) : (
              <>
                {/* 관리 그룹 */}
                <div className="header-group">
                  {hasNotionCredentials ? (
                    <>
                      <button
                        className="btn btn-outline btn-sm"
                        style={syncStatus === "syncing" ? { opacity: 0.5, pointerEvents: "none" } : {}}
                        onClick={() => syncFromNotion()}
                        title="Notion 동기화 (바뀐 단어만)"
                      >
                        {syncProgress
                          ? `⟳ ${syncProgress.done}/${syncProgress.total}`
                          : `${syncStatus === "syncing" ? "⟳" : syncStatus === "success" ? "✓" : syncStatus === "error" ? "!" : "↻"} 동기화`}
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowNotionSettings(true)}
                        title="Notion 설정"
                        style={{ padding: "6px 6px" }}
                      >
                        ⚙
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => setShowNotionSettings(true)}
                    >
                      Notion 연결
                    </button>
                  )}
                  {words.length > 0 && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setTmSelectedTag("");
                        setTmAction("");
                        setTmSelectedWords(new Set());
                        setView("tags");
                      }}
                    >
                      태그 관리
                    </button>
                  )}
                </div>
                {/* 퀴즈 그룹 */}
                {words.length >= 3 && (
                  <div className="header-group">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        resetQuizScope();
                        setView("quiz");
                        setQuizMode(null);
                        setQuizFinished(false);
                      }}
                    >
                      복습 퀴즈
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        resetQuizScope();
                        setFillPool([]);
                        setFillFinished(false);
                        setView("fillblank");
                      }}
                    >
                      빈칸 퀴즈
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        resetQuizScope();
                        setMatchStarted(false);
                        setMatchFinished(false);
                        setView("match");
                      }}
                    >
                      매칭 퀴즈
                    </button>
                  </div>
                )}
                {/* 단어 추가 */}
                {view !== "add" && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setFormTags([]);
                      setFormDifficulty(0);
                      setView("add");
                    }}
                  >
                    + 단어 추가
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="content">
        {view === "quiz" && renderQuiz()}
        {view === "fillblank" && renderFillBlank()}
        {view === "match" && renderMatchQuiz()}
        {view === "tags" && renderTagManager()}
        {view === "add" && renderForm(null)}
        {view === "edit" && editWord && renderForm(editWord)}
        {view === "list" && renderList()}
      </div>

      {/* Notion Settings Modal */}
      {showNotionSettings && (
        <div className="modal-overlay" onClick={() => setShowNotionSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Notion 연결 설정</div>
            <div className="modal-desc">
              Notion Integration의 API Key와 데이터베이스 ID를 입력하세요.
              이 정보는 브라우저에만 저장되며 서버에 보관되지 않습니다.
            </div>
            <div className="modal-field">
              <label className="modal-label">Notion API Key (Integration Secret)</label>
              <input
                className="modal-input"
                type="password"
                defaultValue={notionApiKey}
                id="notion-api-key"
                placeholder="ntn_..."
              />
            </div>
            <div className="modal-field">
              <label className="modal-label">Database ID</label>
              <input
                className="modal-input"
                type="text"
                defaultValue={notionDbId}
                id="notion-db-id"
                placeholder="32자리 ID (URL에서 복사)"
              />
            </div>
            <div className="modal-help">
              <details>
                <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: 13 }}>
                  설정 방법 안내
                </summary>
                <ol style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.8, paddingLeft: 18, marginTop: 8 }}>
                  <li><a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>Notion Integrations</a>에서 새 Integration 생성</li>
                  <li>Internal Integration Secret (ntn_...)을 복사</li>
                  <li>Notion에서 단어장용 데이터베이스 생성</li>
                  <li>속성: term(제목), meaning(텍스트), example(텍스트), notes(텍스트), tags(다중선택), difficulty(숫자), createdAt(날짜)</li>
                  <li>데이터베이스 페이지에서 ··· → 연결 → 생성한 Integration 연결</li>
                  <li>데이터베이스 URL에서 32자리 ID 복사</li>
                </ol>
              </details>
            </div>
            {installPrompt && (
              <div className="modal-field">
                <button
                  className="btn btn-primary"
                  style={{ width: "100%" }}
                  onClick={async () => {
                    installPrompt.prompt();
                    try {
                      await installPrompt.userChoice;
                    } catch {}
                    setInstallPrompt(null);
                  }}
                >
                  이 기기에 앱으로 설치
                </button>
              </div>
            )}
            <div className="modal-actions">
              {hasNotionCredentials && (
                <>
                  <button
                    className="btn btn-outline btn-danger"
                    onClick={disconnectNotion}
                  >
                    연결 해제
                  </button>
                  <button
                    className="btn btn-outline"
                    disabled={!!busy}
                    title="노션의 모든 단어를 다시 받아오고, 노션에서 지운 단어도 반영합니다"
                    onClick={() => {
                      setShowNotionSettings(false);
                      syncFromNotion({ full: true });
                    }}
                  >
                    전체 동기화
                  </button>
                  <button
                    className="btn btn-outline"
                    disabled={!!busy}
                    title="모든 단어의 태그를 새 규칙(과목 / 과목-단원 / 전공용어·일반)으로 통일합니다"
                    onClick={() => {
                      setShowNotionSettings(false);
                      migrateTagsToRule();
                    }}
                  >
                    태그 통일
                  </button>
                  <button
                    className="btn btn-outline"
                    disabled={!!busy}
                    title="노션 DB에 옵션으로만 남아 있고 어떤 단어에도 쓰이지 않는 태그를 찾습니다"
                    onClick={() => {
                      setShowNotionSettings(false);
                      auditNotionTags();
                    }}
                  >
                    태그 점검
                  </button>
                </>
              )}
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-outline"
                onClick={() => setShowNotionSettings(false)}
              >
                취소
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const key = document.getElementById("notion-api-key").value.trim();
                  const dbId = document.getElementById("notion-db-id").value.trim();
                  if (!key || !dbId) return showToast("모든 필드를 입력하세요");
                  saveNotionCredentials(key, dbId);
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {tagAudit && (
        <div className="modal-overlay" onClick={() => setTagAudit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">노션 태그 점검</div>
            <div className="modal-desc">
              노션 DB의 태그 옵션 {tagAudit.total}개 중 {tagAudit.usedCount}개가 단어에 쓰이고 있어요.
              {tagAudit.unused.length > 0
                ? ` 아래 ${tagAudit.unused.length}개는 어떤 단어에도 쓰이지 않아요.`
                : " 안 쓰는 태그 옵션이 없어요."}
            </div>
            {tagAudit.unused.length > 0 && (
              <>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    maxHeight: 280,
                    overflowY: "auto",
                    margin: "8px 0 12px",
                  }}
                >
                  {tagAudit.unused.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
                <div className="modal-desc" style={{ fontSize: 12 }}>
                  어떤 단어에도 쓰이지 않는 옵션이라 지워도 단어는 바뀌지 않아요.
                  태그 관리에서 하나씩 지우거나, 아래 버튼으로 한 번에 지울 수 있어요.
                </div>
              </>
            )}
            <div className="modal-actions">
              {tagAudit.unused.length > 0 && (
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(tagAudit.unused.join("\n"))
                      .then(() => showToast("목록을 복사했어요"))
                      .catch(() => showToast("복사하지 못했어요"));
                  }}
                >
                  목록 복사
                </button>
              )}
              {tagAudit.unused.length > 0 && (
                <button
                  className="btn btn-outline btn-danger"
                  disabled={!!busy}
                  onClick={() => {
                    const names = tagAudit.unused;
                    setTagAudit(null);
                    deleteUnusedTags(names);
                  }}
                >
                  모두 지우기
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={() => setTagAudit(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="busy-bar" role="status" aria-live="polite">
          <div className="busy-row">
            <span className="busy-spinner" aria-hidden="true" />
            <span>{busy}</span>
            {syncProgress && syncProgress.total > 0 && (
              <span className="busy-count">
                {syncProgress.done}/{syncProgress.total}
              </span>
            )}
          </div>
          {syncProgress && syncProgress.total > 0 && (
            <div className="busy-track">
              <div
                className="busy-fill"
                style={{ width: `${Math.round((syncProgress.done / syncProgress.total) * 100)}%` }}
              />
            </div>
          )}
          <div className="busy-hint">끝날 때까지 앱을 닫지 마세요</div>
        </div>
      )}

      <Toast message={toast.message} show={toast.show} />
    </>
  );
}
