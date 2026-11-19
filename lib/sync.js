// ─── 동기화 관련 순수 함수들 (화면 코드와 분리해서 테스트하기 쉽게) ───

// 일주일에 한 번은 전체 동기화 (노션에서 직접 지운 단어 반영)
export const FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
// 노션의 수정 시각은 분 단위로 기록되고 기기 시계도 조금씩 어긋날 수 있어서 넉넉히 겹치게 조회
export const SINCE_BUFFER_MS = 5 * 60 * 1000;
// 대량 추가 시 한 요청에 보내는 단어 수
export const BULK_CHUNK_SIZE = 20;

const NOTION_ID_RE =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// 노션 페이지 ID인지 (앱에서 임시로 만든 ID와 구분)
export function isNotionId(id) {
  return typeof id === "string" && NOTION_ID_RE.test(id);
}

function termKey(w) {
  return (w.term || "").toLowerCase();
}

// ─── 이번 동기화를 전체로 할지, 바뀐 것만 받을지 결정 ───
// meta: { dbId, lastSync(ISO), lastFullSync(ms) } | null
export function planSync(meta, dbId, now = Date.now(), { forceFull = false } = {}) {
  const sameDb = !!meta && meta.dbId === dbId;
  const lastSyncMs = sameDb && meta.lastSync ? new Date(meta.lastSync).getTime() : NaN;
  const fullDue =
    !sameDb ||
    !Number.isFinite(lastSyncMs) ||
    !meta.lastFullSync ||
    now - meta.lastFullSync >= FULL_SYNC_INTERVAL_MS;

  if (forceFull || fullDue) {
    return { full: true, since: null, sameDb };
  }
  return {
    full: false,
    since: new Date(lastSyncMs - SINCE_BUFFER_MS).toISOString(),
    sameDb,
  };
}

// ─── 전체 동기화 결과 합치기 ───
// propagateDeletes: 이미 이 DB와 동기화한 적이 있을 때만 true.
//   노션 ID를 가진 로컬 단어가 노션에 없으면 노션에서 지운 것으로 보고 뺀다.
export function mergeFull(prev, notionWords, { propagateDeletes = false } = {}) {
  const localByTerm = new Map();
  prev.forEach((w) => localByTerm.set(termKey(w), w));

  const merged = [];
  const seen = new Set();
  let removed = 0;

  // 1. 양쪽에 다 있는 단어: 로컬 ID가 다르면 로컬 내용을 노션 ID로 유지, 아니면 노션 내용
  //    노션에만 있는 단어: 그대로 추가
  notionWords.forEach((nw) => {
    const key = termKey(nw);
    const local = localByTerm.get(key);
    if (local && local.id !== nw.id) {
      merged.push({ ...local, id: nw.id, _localOnly: undefined });
    } else {
      merged.push(nw);
    }
    seen.add(key);
  });

  const canDelete = propagateDeletes && notionWords.length > 0;

  // 2. 로컬에만 있는 단어
  prev.forEach((w) => {
    const key = termKey(w);
    if (seen.has(key)) return;
    if (canDelete && !w._localOnly && isNotionId(w.id)) {
      removed++; // 노션에서 지워진 단어
      return;
    }
    merged.push(w._localOnly ? w : { ...w, _localOnly: true });
    seen.add(key);
  });

  return { merged, removed };
}

// ─── 바뀐 단어만 받아온 결과 합치기 ───
export function mergeIncremental(prev, changedWords) {
  const next = [...prev];
  const idIndex = new Map();
  const termIndex = new Map();
  next.forEach((w, i) => {
    idIndex.set(w.id, i);
    // 아직 노션과 연결되지 않은 로컬 단어만 단어 이름으로 짝을 맞춘다
    if (w._localOnly || !isNotionId(w.id)) termIndex.set(termKey(w), i);
  });

  const added = [];
  changedWords.forEach((nw) => {
    let idx = idIndex.get(nw.id);
    if (idx !== undefined) {
      next[idx] = nw;
      return;
    }
    idx = termIndex.get(termKey(nw));
    if (idx !== undefined) {
      next[idx] = { ...next[idx], id: nw.id, _localOnly: undefined };
      termIndex.delete(termKey(nw));
      idIndex.set(nw.id, idx);
      return;
    }
    added.push(nw);
  });

  return [...added, ...next];
}

// ─── 업로드가 끝난 단어에 노션 ID 붙이기 ───
// idMap: Map(로컬 ID → 노션 ID)
export function applyUploadedIds(words, idMap) {
  if (idMap.size === 0) return words;
  return words.map((w) =>
    idMap.has(w.id) ? { ...w, id: idMap.get(w.id), _localOnly: undefined } : w,
  );
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
