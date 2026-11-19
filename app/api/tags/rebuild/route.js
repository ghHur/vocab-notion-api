import { NextResponse } from "next/server";
import { startTagRebuild, stepTagRebuild, finishTagRebuild } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getCredentials(request) {
  const apiKey = request.headers.get("x-notion-api-key") || process.env.NOTION_API_KEY;
  const dbId = request.headers.get("x-notion-db-id") || process.env.NOTION_DB_ID;
  if (!apiKey || !dbId) {
    throw new Error("Notion API Key와 Database ID가 필요합니다");
  }
  return { apiKey, dbId };
}

// ─── POST /api/tags/rebuild — 태그 속성 재구성으로 태그 옵션 지우기 ───
// { action: "start", names }  → 기존 tags를 임시 속성으로 옮기고 새 tags 생성 (이미 진행 중이면 이어서)
// { action: "step", cursor }  → 단어 태그를 새 속성으로 옮기기 (40개씩)
// { action: "finish" }        → 다 옮겼으면 임시 속성 삭제
export async function POST(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const body = await request.json();
    const action = body?.action;
    if (action === "start") {
      const names = Array.isArray(body?.names)
        ? [...new Set(body.names.filter((n) => typeof n === "string" && n.trim()))]
        : [];
      const result = await startTagRebuild(apiKey, dbId, names);
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "step") {
      const cursor = typeof body?.cursor === "string" && body.cursor ? body.cursor : undefined;
      const result = await stepTagRebuild(apiKey, dbId, cursor);
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "finish") {
      const result = await finishTagRebuild(apiKey, dbId);
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ error: "action은 start, step, finish 중 하나여야 합니다" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/tags/rebuild error:", error);
    return NextResponse.json(
      { error: error.message || "태그 정리 실패", code: error.code },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
