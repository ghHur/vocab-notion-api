import { NextResponse } from "next/server";
import { getAllWords, createWord } from "@/lib/notion";

// 단어가 많을 때 첫 전체 동기화가 중간에 끊기지 않도록 최대 실행 시간을 늘린다.
// (Vercel 무료 플랜: 예전 설정은 최대 60초, Fluid Compute는 최대 300초)
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ─── 요청에서 Notion 자격증명 추출 ───
function getCredentials(request) {
  const apiKey = request.headers.get("x-notion-api-key") || process.env.NOTION_API_KEY;
  const dbId = request.headers.get("x-notion-db-id") || process.env.NOTION_DB_ID;
  if (!apiKey || !dbId) {
    throw new Error("Notion API Key와 Database ID가 필요합니다");
  }
  return { apiKey, dbId };
}

// ─── GET /api/words — 단어 조회 ───
// ?since=ISO시각 을 붙이면 그 이후에 추가·수정된 단어만 돌려준다 (증분 동기화).
export async function GET(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const sinceParam = new URL(request.url).searchParams.get("since");
    let since;
    if (sinceParam) {
      const t = new Date(sinceParam);
      if (Number.isNaN(t.getTime())) {
        return NextResponse.json({ error: "since 값이 올바른 시각이 아닙니다" }, { status: 400 });
      }
      since = t.toISOString();
    }
    // 조회를 시작하기 직전의 서버 시각 — 다음 증분 동기화의 기준점
    const serverTime = new Date().toISOString();
    const words = await getAllWords(apiKey, dbId, { since });
    return NextResponse.json({ success: true, words, serverTime, full: !since });
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
