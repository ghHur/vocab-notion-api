import { NextResponse } from "next/server";
import { getTagOptions } from "@/lib/notion";

export const dynamic = "force-dynamic";

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
    const options = await getTagOptions(apiKey, dbId);
    return NextResponse.json({ success: true, options });
  } catch (error) {
    console.error("GET /api/tags error:", error);
    return NextResponse.json(
      { error: error.message || "태그 옵션 조회 실패" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
