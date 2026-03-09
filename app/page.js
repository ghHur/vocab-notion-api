"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Utils ───
const STORAGE_KEY = "vocab-notebook-words";

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

  // Load from localStorage + 자동 동기화
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      setWords(saved);
    } catch {
      setWords([]);
    }
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
      const shuffled = [...words]
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(20, words.length));
      setQuizMode(mode);
      setQuizPool(shuffled);
      setQuizCurrent(0);
      setQuizShowAnswer(false);
      setQuizScore({ correct: 0, wrong: 0 });
      setQuizFinished(false);
    },
    [words],
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
  }, [words, search, filterTag, filterDifficulty, sortBy]);

  const getAllTags = useCallback(() => {
    const set = new Set();
    words.forEach((w) => (w.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [words]);

  const isQuiz = view === "quiz";
  const filtered = getFiltered();
  const allTags = getAllTags();
  const hasFilters = search || filterTag || filterDifficulty > 0;

  // ─── Render: Quiz ───
  const renderQuiz = () => {
    if (!quizMode)
      return (
        <div className="quiz-center fade-in">
          <div className="quiz-title">복습 퀴즈</div>
          <div className="quiz-sub">
            {Math.min(20, words.length)}개 단어로 퀴즈를 시작합니다
          </div>
          <div className="quiz-modes">
            <button
              className="quiz-mode-btn"
              onClick={() => startQuiz("en-ko")}
            >
              <div className="emoji">🇺🇸 → 🇰🇷</div>
              <div className="label">영어 → 한국어</div>
            </button>
            <button
              className="quiz-mode-btn"
              onClick={() => startQuiz("ko-en")}
            >
              <div className="emoji">🇰🇷 → 🇺🇸</div>
              <div className="label">한국어 → 영어</div>
            </button>
          </div>
        </div>
      );

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
          <div className="quiz-question-word">{question}</div>
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
                <div className="quiz-answer-text">{answer}</div>
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
        {allTags.length > 0 && (
          <select
            className={`filter-select${filterTag ? " active" : ""}`}
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
          >
            <option value="">모든 태그</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
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
              setFilterDifficulty(0);
            }}
          >
            필터 초기화
          </button>
        )}
        <span className="filter-count">{filtered.length}개 표시</span>
      </div>

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
            {!isQuiz && (
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
            {words.length >= 3 && !isQuiz && (
              <button
                className="btn btn-outline"
                onClick={() => {
                  setView("quiz");
                  setQuizMode(null);
                  setQuizFinished(false);
                }}
              >
                복습 퀴즈
              </button>
            )}
            {view !== "add" && !isQuiz && (
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
            {isQuiz && (
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
        {view === "add" && renderForm(null)}
        {view === "edit" && editWord && renderForm(editWord)}
        {view === "list" && renderList()}
      </div>

      <Toast message={toast.message} show={toast.show} />
    </>
  );
}
