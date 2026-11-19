import { NextResponse } from "next/server";
import { getTagStatus, removeUnusedTagOptions } from "@/lib/notion";

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

// ─── GET /api/tags — 노션 DB tags 속성에 등록된 태그 옵션 목록 ───
export async function GET(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const { options, rebuilding } = await getTagStatus(apiKey, dbId);
    return NextResponse.json({ success: true, options, rebuilding });
  } catch (error) {
    console.error("GET /api/tags error:", error);
    return NextResponse.json(
      { error: error.message || "태그 옵션 조회 실패" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/tags — 어떤 단어에도 안 쓰이는 태그 옵션 삭제 ───
// 요청: { names: [...] }  응답: { success, removed, inUse, notRemoved }
export async function DELETE(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const body = await request.json();
    const names = Array.isArray(body?.names)
      ? [...new Set(body.names.filter((n) => typeof n === "string" && n.trim()))]
      : [];
    if (names.length === 0) {
      return NextResponse.json({ error: "names 배열이 필요합니다" }, { status: 400 });
    }
    if (names.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100개까지 지울 수 있습니다" }, { status: 400 });
    }
    const result = await removeUnusedTagOptions(apiKey, dbId, names);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error.code === "needs_rebuild") {
      // 남길 태그가 100개를 넘어 바로 지울 수 없음 → 앱이 태그 속성 재구성으로 지운다
      return NextResponse.json(
        { error: error.message, needsRebuild: true, ...error.details },
        { status: 409 }
      );
    }
    console.error("DELETE /api/tags error:", error);
    return NextResponse.json(
      { error: error.message || "태그 옵션 삭제 실패" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
