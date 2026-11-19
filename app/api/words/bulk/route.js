import { NextResponse } from "next/server";
import { createWords } from "@/lib/notion";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 한 요청에 받는 최대 단어 수 (노션 속도 제한 때문에 20개면 약 7초)
const MAX_BULK = 50;

function getCredentials(request) {
  const apiKey = request.headers.get("x-notion-api-key") || process.env.NOTION_API_KEY;
  const dbId = request.headers.get("x-notion-db-id") || process.env.NOTION_DB_ID;
  if (!apiKey || !dbId) {
    throw new Error("Notion API Key와 Database ID가 필요합니다");
  }
  return { apiKey, dbId };
}

// ─── POST /api/words/bulk — 여러 단어 한 번에 추가 ───
// 요청: { words: [...] }  응답: { success, results: [{ id } | { error }] } (입력 순서대로)
export async function POST(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const body = await request.json();
    const words = body?.words;
    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: "words 배열이 필요합니다" }, { status: 400 });
    }
    if (words.length > MAX_BULK) {
      return NextResponse.json(
        { error: `한 번에 최대 ${MAX_BULK}개까지 보낼 수 있습니다` },
        { status: 400 }
      );
    }
    const results = await createWords(apiKey, dbId, words);
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("POST /api/words/bulk error:", error);
    return NextResponse.json(
      { error: error.message || "단어 일괄 추가 실패" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
