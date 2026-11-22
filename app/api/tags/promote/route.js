import { NextResponse } from "next/server";
import { promotePendingTags } from "@/lib/notion";

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

// ─── POST /api/tags/promote — 대기 태그(tags_pending)를 진짜 태그로 옮기기 (40개씩) ───
// 응답: { success, promoted, failed, remaining }
export async function POST(request) {
  try {
    const { apiKey, dbId } = getCredentials(request);
    const result = await promotePendingTags(apiKey, dbId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("POST /api/tags/promote error:", error);
    return NextResponse.json(
      { error: error.message || "대기 태그 옮기기 실패" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
