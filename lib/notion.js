import { Client } from "@notionhq/client";

// ─── Notion 클라이언트 생성 (요청별) ───
function getClient(apiKey) {
  return new Client({ auth: apiKey });
}

// Notion 텍스트 한 조각의 최대 길이
const TEXT_CHUNK = 2000;

// Notion API 평균 속도 제한(초당 약 3회)에 맞춘 값
const CREATE_CONCURRENCY = 3;
const CREATE_INTERVAL_MS = 340;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── 일시적 오류(속도 제한, 서버 오류)면 잠깐 기다렸다가 다시 시도 ───
const RETRYABLE_CODES = new Set([
  "rate_limited",
  "service_unavailable",
  "internal_server_error",
  "conflict_error",
  "notionhq_client_request_timeout",
]);
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function getRetryAfterMs(error) {
  const h = error?.headers;
  const raw = typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"];
  const sec = Number(raw);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
}

// 새 페이지 생성은 서버가 처리했을 수도 있는 오류(타임아웃, 500)에서 다시 시도하면
// 같은 단어가 두 번 생길 수 있어서, 확실히 처리되지 않은 오류에서만 다시 시도한다.
const SAFE_CREATE_CODES = new Set(["rate_limited", "service_unavailable"]);
const SAFE_CREATE_STATUS = new Set([429, 503]);

export async function withRetry(
  fn,
  { retries = 4, baseDelayMs = 1000, createSafe = false } = {},
) {
  const codes = createSafe ? SAFE_CREATE_CODES : RETRYABLE_CODES;
  const statuses = createSafe ? SAFE_CREATE_STATUS : RETRYABLE_STATUS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = codes.has(error?.code) || statuses.has(error?.status);
      if (!retryable || attempt >= retries) throw error;
      const wait = getRetryAfterMs(error) || baseDelayMs * 2 ** attempt;
      await sleep(wait);
    }
  }
}

// ─── 동시에 최대 N개, 시작 간격을 두고 실행 (결과 순서 유지) ───
export async function mapWithRateLimit(
  items,
  fn,
  { concurrency = CREATE_CONCURRENCY, intervalMs = CREATE_INTERVAL_MS } = {},
) {
  const results = new Array(items.length);
  let next = 0;
  let lastSlot = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const slot = Math.max(Date.now(), lastSlot + intervalMs);
      lastSlot = slot;
      const wait = slot - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        results[i] = { id: await fn(items[i], i) };
      } catch (error) {
        results[i] = { error: error?.message || "추가 실패" };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

// ─── 긴 텍스트는 2000자씩 나눠서 저장 ───
export function toRichText(value) {
  const s = value || "";
  if (s.length <= TEXT_CHUNK) return [{ text: { content: s } }];
  const parts = [];
  for (let i = 0; i < s.length; i += TEXT_CHUNK) {
    parts.push({ text: { content: s.slice(i, i + TEXT_CHUNK) } });
  }
  return parts;
}

function plainText(arr) {
  return (arr || []).map((t) => t.plain_text || "").join("");
}

// ─── 태그 정리(속성 재구성) 중에 원래 태그를 잠시 옮겨 두는 속성 이름 ───
export const REBUILD_PROP = "tags_old_rebuild";
// 노션 API 한 요청에 담을 수 있는 다중 선택 옵션 수
export const MAX_OPTIONS_PER_REQUEST = 100;

function multiNames(prop) {
  return (prop?.multi_select || []).map((t) => t.name);
}

// 태그 정리 중이면 아직 옮겨지지 않은 단어는 임시 속성의 태그를 보여 준다
function pageTags(p) {
  const tags = multiNames(p.tags);
  if (tags.length === 0 && p[REBUILD_PROP]) return multiNames(p[REBUILD_PROP]);
  return tags;
}

// ─── Notion 페이지 → 앱 단어 객체 변환 ───
export function pageToWord(page) {
  const p = page.properties;
  return {
    id: page.id,
    term: plainText(p.term?.title),
    meaning: plainText(p.meaning?.rich_text),
    example: plainText(p.example?.rich_text),
    notes: plainText(p.notes?.rich_text),
    tags: pageTags(p),
    difficulty: p.difficulty?.number || 0,
    createdAt: p.createdAt?.date?.start
      ? new Date(p.createdAt.date.start).getTime()
      : new Date(page.created_time).getTime(),
  };
}

// ─── 앱 단어 객체 → Notion 프로퍼티 변환 ───
export function wordToProperties(word) {
  const props = {};

  if (word.term !== undefined) {
    props.term = { title: toRichText(word.term) };
  }
  if (word.meaning !== undefined) {
    props.meaning = { rich_text: toRichText(word.meaning) };
  }
  if (word.example !== undefined) {
    props.example = { rich_text: toRichText(word.example) };
  }
  if (word.notes !== undefined) {
    props.notes = { rich_text: toRichText(word.notes) };
  }
  if (word.tags !== undefined) {
    props.tags = { multi_select: (word.tags || []).map((name) => ({ name })) };
  }
  if (word.difficulty !== undefined) {
    props.difficulty = { number: word.difficulty || 0 };
  }
  if (word.createdAt !== undefined) {
    props.createdAt = {
      date: { start: new Date(word.createdAt).toISOString() },
    };
  }

  return props;
}

// ─── 단어 조회 (페이지네이션 포함) ───
// since(ISO 시각)를 주면 그 이후에 추가·수정된 단어만 가져온다.
export async function getAllWords(apiKey, dbId, { since } = {}) {
  const notion = getClient(apiKey);
  let allResults = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await withRetry(() =>
      notion.databases.query({
        database_id: dbId,
        ...(since && {
          filter: {
            timestamp: "last_edited_time",
            last_edited_time: { on_or_after: since },
          },
        }),
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 100,
        ...(startCursor && { start_cursor: startCursor }),
      }),
    );

    allResults = allResults.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return allResults.map(pageToWord);
}

// ─── 데이터베이스 tags 속성에 등록된 태그 옵션 이름 목록 ───
export async function getTagOptions(apiKey, dbId) {
  const notion = getClient(apiKey);
  const db = await withRetry(() => notion.databases.retrieve({ database_id: dbId }));
  return (db.properties?.tags?.multi_select?.options || []).map((o) => o.name);
}

// ─── 안 쓰는 태그 옵션 삭제 ───
// 실제로 어떤 단어에도 없는 이름만 지운다 (노션에서 한 번 더 확인).
// 노션은 남길 옵션 목록 전체를 보내야 해서, 옵션이 많으면 노션이 거절할 수 있다.
export async function removeUnusedTagOptions(apiKey, dbId, names) {
  const notion = getClient(apiKey);
  const inUse = [];
  const safe = [];
  for (const name of names) {
    const res = await withRetry(() =>
      notion.databases.query({
        database_id: dbId,
        filter: { property: "tags", multi_select: { contains: name } },
        page_size: 1,
      }),
    );
    (res.results.length > 0 ? inUse : safe).push(name);
  }
  if (safe.length === 0) return { removed: [], inUse, notRemoved: [] };

  const db = await withRetry(() => notion.databases.retrieve({ database_id: dbId }));
  const options = db.properties?.tags?.multi_select?.options || [];
  const drop = new Set(safe);
  const keep = options
    .filter((o) => !drop.has(o.name))
    .map(({ id, name, color }) => ({ id, name, color }));
  if (keep.length > MAX_OPTIONS_PER_REQUEST) {
    // 남길 옵션이 100개를 넘으면 노션이 거절하므로, 태그 속성 재구성으로 지워야 한다
    const error = new Error(
      `남길 태그가 ${keep.length}개라 노션 API 한도(${MAX_OPTIONS_PER_REQUEST}개)를 넘어요`,
    );
    error.code = "needs_rebuild";
    error.details = { safe, inUse, keepCount: keep.length };
    throw error;
  }
  await withRetry(() =>
    notion.databases.update({
      database_id: dbId,
      properties: { tags: { multi_select: { options: keep } } },
    }),
  );

  const after = await getTagOptions(apiKey, dbId);
  const left = new Set(after);
  return {
    removed: safe.filter((n) => !left.has(n)),
    inUse,
    notRemoved: safe.filter((n) => left.has(n)),
  };
}

// ─── 태그 정리 상태 (중간에 멈춘 정리가 있는지) ───
export async function getTagStatus(apiKey, dbId) {
  const notion = getClient(apiKey);
  const db = await withRetry(() => notion.databases.retrieve({ database_id: dbId }));
  return {
    options: (db.properties?.tags?.multi_select?.options || []).map((o) => o.name),
    rebuilding: !!db.properties?.[REBUILD_PROP],
  };
}

// ─── 모든 단어에 실제로 쓰인 태그 이름 모으기 ───
async function collectUsedTags(notion, dbId, propName) {
  const used = new Set();
  let cursor;
  do {
    const res = await withRetry(() =>
      notion.databases.query({
        database_id: dbId,
        filter: { property: propName, multi_select: { is_not_empty: true } },
        page_size: 100,
        ...(cursor && { start_cursor: cursor }),
      }),
    );
    res.results.forEach((page) =>
      multiNames(page.properties?.[propName]).forEach((n) => used.add(n)),
    );
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return used;
}

// ─── 태그 속성 재구성 ①: 시작 ───
// 노션 API로는 남길 옵션이 100개를 넘으면 옵션을 지울 수 없어서,
//   1) 기존 tags 속성을 임시 이름(REBUILD_PROP)으로 바꾸고
//   2) 지울 태그만 뺀 새 tags 속성을 만든 뒤 (한 번에 100개까지 색 유지, 나머지는 단어를 쓸 때 자동 생성)
//   3) stepTagRebuild로 모든 단어의 태그를 새 속성에 다시 쓰고
//   4) finishTagRebuild로 임시 속성을 지운다.
// 이미 임시 속성이 있으면 (중간에 멈춘 정리) 그대로 이어서 한다.
export async function startTagRebuild(apiKey, dbId, removeNames) {
  const notion = getClient(apiKey);
  const db = await withRetry(() => notion.databases.retrieve({ database_id: dbId }));
  const props = db.properties || {};
  if (props[REBUILD_PROP]) {
    // 이름만 바꾸고 새 속성을 못 만든 채 멈췄다면 새 tags 속성부터 만든다
    if (!props.tags) {
      await withRetry(() =>
        notion.databases.update({
          database_id: dbId,
          properties: { tags: { multi_select: { options: [] } } },
        }),
      );
    }
    return { resumed: true, removed: [], inUse: [] };
  }
  if (props.tags?.type !== "multi_select") {
    throw new Error("노션 DB에 tags(다중 선택) 속성이 없습니다");
  }

  const options = props.tags.multi_select.options || [];
  const used = await collectUsedTags(notion, dbId, "tags");
  const wanted = new Set(removeNames);
  const inUse = removeNames.filter((n) => used.has(n));
  const removed = options.map((o) => o.name).filter((n) => wanted.has(n) && !used.has(n));
  if (removed.length === 0) {
    const error = new Error("지울 수 있는 태그가 없어요 (모두 단어에 쓰이고 있어요)");
    error.code = "nothing_to_remove";
    throw error;
  }

  const drop = new Set(removed);
  // 안 쓰이지만 지우지 않을 태그는 단어로 다시 생기지 않으니 먼저 넣고, 남는 자리에 쓰이는 태그를 넣는다
  const keepUnused = options.filter((o) => !drop.has(o.name) && !used.has(o.name));
  const keepUsed = options.filter((o) => used.has(o.name));
  if (keepUnused.length > MAX_OPTIONS_PER_REQUEST) {
    throw new Error("안 쓰는 태그가 너무 많아요. 안 쓰는 태그를 한 번에 함께 지워 주세요");
  }
  const initial = [...keepUnused, ...keepUsed]
    .slice(0, MAX_OPTIONS_PER_REQUEST)
    .map(({ name, color }) => ({ name, color }));

  await withRetry(() =>
    notion.databases.update({
      database_id: dbId,
      properties: { tags: { name: REBUILD_PROP } },
    }),
  );
  await withRetry(() =>
    notion.databases.update({
      database_id: dbId,
      properties: { tags: { multi_select: { options: initial } } },
    }),
  );
  return { resumed: false, removed, inUse };
}

// ─── 태그 속성 재구성 ②: 단어 태그 옮기기 (한 번에 limit개씩, cursor로 이어서) ───
// 새 tags가 이미 채워진 단어(옮긴 단어, 정리 중에 수정한 단어)는 건너뛴다.
export async function stepTagRebuild(apiKey, dbId, cursor, limit = 40) {
  const notion = getClient(apiKey);
  const res = await withRetry(() =>
    notion.databases.query({
      database_id: dbId,
      filter: { property: REBUILD_PROP, multi_select: { is_not_empty: true } },
      page_size: limit,
      ...(cursor && { start_cursor: cursor }),
    }),
  );
  const todo = res.results.filter((page) => multiNames(page.properties?.tags).length === 0);
  const results = await mapWithRateLimit(todo, async (page) => {
    const names = multiNames(page.properties?.[REBUILD_PROP]);
    await withRetry(() =>
      notion.pages.update({
        page_id: page.id,
        properties: { tags: { multi_select: names.map((name) => ({ name })) } },
      }),
    );
    return page.id;
  });
  return {
    processed: res.results.length,
    written: results.filter((r) => r.id).length,
    failed: results.filter((r) => r.error).length,
    nextCursor: res.has_more ? res.next_cursor : null,
  };
}

// ─── 태그 속성 재구성 ③: 마무리 ───
// 아직 옮기지 못한 단어가 있으면 임시 속성을 지우지 않고 remaining: true를 돌려준다.
export async function finishTagRebuild(apiKey, dbId) {
  const notion = getClient(apiKey);
  const db = await withRetry(() => notion.databases.retrieve({ database_id: dbId }));
  if (!db.properties?.[REBUILD_PROP]) return { done: true };
  const left = await withRetry(() =>
    notion.databases.query({
      database_id: dbId,
      filter: {
        and: [
          { property: REBUILD_PROP, multi_select: { is_not_empty: true } },
          { property: "tags", multi_select: { is_empty: true } },
        ],
      },
      page_size: 1,
    }),
  );
  if (left.results.length > 0) return { done: false, remaining: true };
  await withRetry(() =>
    notion.databases.update({
      database_id: dbId,
      properties: { [REBUILD_PROP]: null },
    }),
  );
  return { done: true };
}

// ─── 단어 추가 ───
export async function createWord(apiKey, dbId, word, notion = getClient(apiKey)) {
  const response = await withRetry(() =>
    notion.pages.create({
      parent: { database_id: dbId },
      properties: wordToProperties(word),
    }),
    { createSafe: true },
  );
  return response.id;
}

// ─── 여러 단어 한 번에 추가 (속도 제한을 지키며 3개씩 병렬) ───
// 결과는 입력 순서대로 { id } 또는 { error }
export async function createWords(apiKey, dbId, words) {
  const notion = getClient(apiKey);
  return mapWithRateLimit(words, (word) => {
    if (!word?.term?.trim()) throw new Error("단어(term)가 비어 있습니다");
    return createWord(apiKey, dbId, word, notion);
  });
}

// ─── 단어 수정 ───
export async function updateWord(apiKey, pageId, word) {
  const notion = getClient(apiKey);
  await withRetry(() =>
    notion.pages.update({
      page_id: pageId,
      properties: wordToProperties(word),
    }),
  );
}

// ─── 여러 단어 한 번에 수정 (속도 제한을 지키며 3개씩 병렬) ───
// items: [{ id, ...바꿀 필드 }]  결과는 입력 순서대로 { id } 또는 { error }
export async function updateWords(apiKey, items) {
  const notion = getClient(apiKey);
  return mapWithRateLimit(items, async (item) => {
    if (!item?.id) throw new Error("단어 id가 없습니다");
    const { id, ...fields } = item;
    await withRetry(() =>
      notion.pages.update({
        page_id: id,
        properties: wordToProperties(fields),
      }),
    );
    return id;
  });
}

// ─── 단어 삭제 (아카이브) ───
export async function deleteWord(apiKey, pageId) {
  const notion = getClient(apiKey);
  await withRetry(() =>
    notion.pages.update({
      page_id: pageId,
      archived: true,
    }),
  );
}
