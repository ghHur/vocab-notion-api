"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Utils ───
const STORAGE_KEY = "vocab-notebook-words";
const THEME_KEY = "vocab-theme";

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

  // Tag tabs - hierarchical
  const [activeSubject, setActiveSubjectState] = useState("");
  const [activeSource, setActiveSourceState] = useState("");
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
  const [quizCategory, setQuizCategory] = useState("");

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
    // Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // 앱 시작 시 Notion 자동 동기화 (조용히)
    syncFromNotion(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (quizSubject) w = w.filter((x) => (x.tags || []).includes(quizSubject));
    if (quizSource) w = w.filter((x) => (x.tags || []).includes(quizSource));
    if (quizCategory) w = w.filter((x) => (x.tags || []).includes(quizCategory));
    return w;
  }, [words, quizSubject, quizSource, quizCategory]);

  const resetQuizScope = () => {
    setQuizSubject("");
    setQuizSource("");
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

  // ─── Notion Sync ───
  const notionFetch = useCallback(async (path, method = "GET", body = null) => {
    const options = { method, headers: { "Content-Type": "application/json" } };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(path, options);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    return res.json();
  }, []);

  const syncFromNotion = useCallback(
    async (silent = false) => {
      setSyncStatus("syncing");
      try {
        const data = await notionFetch("/api/words");
        if (data.success && data.words) {
          setWords((prev) => {
            const notionIds = new Set(data.words.map((w) => w.id));
            const localOnly = prev.filter(
              (w) => !notionIds.has(w.id) && w._localOnly,
            );
            const merged = [...data.words, ...localOnly];
            saveWords(merged);
            return merged;
          });
          setSyncStatus("success");
          if (!silent) showToast(`동기화 완료! ${data.words.length}개 단어`);
        }
      } catch (e) {
        setSyncStatus("error");
        if (!silent) showToast("동기화 실패: " + (e.message || "연결 오류"));
      }
      setTimeout(() => setSyncStatus("idle"), 3000);
    },
    [notionFetch, saveWords, showToast],
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

  const uploadAllToNotion = useCallback(async () => {
    setSyncStatus("syncing");
    let uploaded = 0;
    try {
      const updated = [...words];
      for (let i = 0; i < updated.length; i++) {
        const data = await notionFetch("/api/words", "POST", updated[i]);
        if (data.success && data.id) {
          updated[i] = { ...updated[i], id: data.id, _localOnly: undefined };
          uploaded++;
        }
      }
      setWords(updated);
      saveWords(updated);
      setSyncStatus("success");
      showToast(`${uploaded}개 단어 업로드 완료!`);
    } catch (e) {
      setSyncStatus("error");
      showToast("업로드 실패: " + e.message);
    }
    setTimeout(() => setSyncStatus("idle"), 3000);
  }, [words, notionFetch, saveWords, showToast]);

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
              });
              existing.add(w.term.toLowerCase());
              added++;
            }
          });
          const next = [...toAdd, ...words];
          setWords(next);
          saveWords(next);
          showToast(`${added}개 단어 가져오기 완료!`);
        } catch {
          showToast("파일 형식이 올바르지 않습니다");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [words, saveWords, showToast]);

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
    if (filterTag) w = w.filter((x) => (x.tags || []).includes(filterTag));
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

  const getSubjectTags = useCallback(() => {
    const counts = {};
    words.forEach((w) =>
      (w.tags || []).filter(isSubjectTag).forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      }),
    );
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [words]);

  const getSourceTagsForSubject = useCallback(
    (subject) => {
      const counts = {};
      words.forEach((w) => {
        const tags = w.tags || [];
        if (tags.includes(subject)) {
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
      return words.filter((w) => (w.tags || []).includes(subject)).length;
    },
    [words],
  );

  const handleSubjectClick = (subject) => {
    if (activeSubject === subject) {
      setActiveSubjectState("");
      setActiveSourceState("");
      setFilterTag("");
    } else {
      setActiveSubjectState(subject);
      setActiveSourceState("");
      setFilterTag(subject);
    }
  };

  const handleSourceClick = (source) => {
    if (activeSource === source) {
      setActiveSourceState("");
      setFilterTag(activeSubject);
    } else {
      setActiveSourceState(source);
      setFilterTag(source);
    }
  };

  const isQuiz = view === "quiz";
  const isFill = view === "fillblank";
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
    const sourceTags = quizSubject ? getSourceTagsForSubject(quizSubject) : [];

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
                  }}
                >
                  {t}<span className="tag-tab-count">{c}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Source selection (Level 2) */}
        {quizSubject && sourceTags.length > 0 && (
          <div className="quiz-scope-section">
            <div className="quiz-scope-label">범위</div>
            <div className="quiz-scope-tags">
              <button
                className={`tag-tab${quizSource === "" ? " active" : ""}`}
                onClick={() => setQuizSource("")}
              >
                전체
              </button>
              {sourceTags.map(([t, c]) => {
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
        {words.some((w) => w._localOnly) && (
          <button
            className="btn btn-outline"
            style={{ fontSize: 12, padding: "6px 12px" }}
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
            }}
          >
            필터 초기화
          </button>
        )}
        <span className="filter-count">{filtered.length}개 표시</span>
      </div>

      {/* Hierarchical Tag Tabs */}
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
          {/* Level 2: Source tabs (only when subject is selected) */}
          {activeSubject && (() => {
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
                    {(w.tags || []).map((t) => (
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
            {!isQuiz && !isFill && (
              <button
                className="btn btn-outline"
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  ...(syncStatus === "syncing"
                    ? { opacity: 0.5, pointerEvents: "none" }
                    : {}),
                }}
                onClick={syncFromNotion}
                title="Notion 동기화"
              >
                {syncStatus === "syncing"
                  ? "⟳"
                  : syncStatus === "success"
                    ? "✓"
                    : syncStatus === "error"
                      ? "!"
                      : "↻"}{" "}
                동기화
              </button>
            )}
            {words.length >= 3 && !isQuiz && !isFill && (
              <>
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    resetQuizScope();
                    setView("quiz");
                    setQuizMode(null);
                    setQuizFinished(false);
                  }}
                >
                  복습 퀴즈
                </button>
                <button className="btn btn-outline" onClick={() => {
                    resetQuizScope();
                    setFillPool([]);
                    setFillFinished(false);
                    setView("fillblank");
                  }}>
                  빈칸 퀴즈
                </button>
              </>
            )}
            {view !== "add" && !isQuiz && !isFill && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setFormTags([]);
                  setFormDifficulty(0);
                  setView("add");
                }}
              >
                + 단어 추가
              </button>
            )}
            {(isQuiz || isFill) && (
              <button
                className="btn btn-outline"
                onClick={() => setView("list")}
              >
                돌아가기
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="content">
        {view === "quiz" && renderQuiz()}
        {view === "fillblank" && renderFillBlank()}
        {view === "add" && renderForm(null)}
        {view === "edit" && editWord && renderForm(editWord)}
        {view === "list" && renderList()}
      </div>

      <Toast message={toast.message} show={toast.show} />
    </>
  );
}
