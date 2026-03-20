import { NextResponse } from "next/server";
import { getAllWords, createWord } from "@/lib/notion";

// ─── 요청에서 Notion 자격증명 추출 ───
function getCredentials(request) {
  const apiKey = request.headers.get("x-notion-api-key") || process.env.NOTION_API_KEY;
  const dbId = request.headers.get("x-notion-db-id") || process.env.NOTION_DB_ID;
  if (!apiKey || !dbId) {
    throw new Error("Notion API Key와 Database ID가 필요합니다");
  }
  return { apiKey, dbId };
}

// ─── GET /api/words — 전체 단어 조회 ───
export async function GET(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const words = await getAllWords(apiKey, dbId);
    return NextResponse.json({ success: true, words });
  } catch (error) {
    console.error("GET /api/words error:", error);
    return NextResponse.json(
      { error: error.message || "단어 조회 실패" },
      { status: 500 }
    );
  }
}

// ─── POST /api/words — 단어 추가 ───
export async function POST(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const body = await request.json();
    const id = await createWord(apiKey, dbId, body);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("POST /api/words error:", error);
    return NextResponse.json(
      { error: error.message || "단어 추가 실패" },
      { status: 500 }
    );
  }
}

// ─── OPTIONS — CORS preflight ───
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
