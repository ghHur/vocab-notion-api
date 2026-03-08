import { Client } from "@notionhq/client";

// ─── Notion 클라이언트 초기화 ───
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DB_ID = process.env.NOTION_DB_ID;

// ─── Notion 페이지 → 앱 단어 객체 변환 ───
export function pageToWord(page) {
  const p = page.properties;
  return {
    id: page.id,
    term: p.term?.title?.[0]?.plain_text || "",
    meaning: p.meaning?.rich_text?.[0]?.plain_text || "",
    example: p.example?.rich_text?.[0]?.plain_text || "",
    notes: p.notes?.rich_text?.[0]?.plain_text || "",
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
    props.term = { title: [{ text: { content: word.term } }] };
  }
  if (word.meaning !== undefined) {
    props.meaning = { rich_text: [{ text: { content: word.meaning } }] };
  }
  if (word.example !== undefined) {
    props.example = { rich_text: [{ text: { content: word.example || "" } }] };
  }
  if (word.notes !== undefined) {
    props.notes = { rich_text: [{ text: { content: word.notes || "" } }] };
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

// ─── 전체 단어 조회 (페이지네이션 포함) ───
export async function getAllWords() {
  let allResults = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: DB_ID,
      sorts: [{ property: "createdAt", direction: "descending" }],
      page_size: 100,
      ...(startCursor && { start_cursor: startCursor }),
    });

    allResults = allResults.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return allResults.map(pageToWord);
}

// ─── 단어 추가 ───
export async function createWord(word) {
  const response = await notion.pages.create({
    parent: { database_id: DB_ID },
    properties: wordToProperties(word),
  });
  return response.id;
}

// ─── 단어 수정 ───
export async function updateWord(pageId, word) {
  await notion.pages.update({
    page_id: pageId,
    properties: wordToProperties(word),
  });
}

// ─── 단어 삭제 (아카이브) ───
export async function deleteWord(pageId) {
  await notion.pages.update({
    page_id: pageId,
    archived: true,
  });
}
