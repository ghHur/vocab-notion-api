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

// ─── Notion 페이지 → 앱 단어 객체 변환 ───
export function pageToWord(page) {
  const p = page.properties;
  return {
    id: page.id,
    term: plainText(p.term?.title),
    meaning: plainText(p.meaning?.rich_text),
    example: plainText(p.example?.rich_text),
    notes: plainText(p.notes?.rich_text),
    tags: (p.tags?.multi_select || []).map((t) => t.name),
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
