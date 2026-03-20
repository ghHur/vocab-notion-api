import { NextResponse } from "next/server";
import { updateWord, deleteWord } from "@/lib/notion";

// ─── 요청에서 Notion 자격증명 추출 ───
function getCredentials(request) {
  const apiKey = request.headers.get("x-notion-api-key") || process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error("Notion API Key가 필요합니다");
  }
  return { apiKey };
}

// ─── PATCH /api/words/:id — 단어 수정 ───
export async function PATCH(request, { params }) {
  try {
    const { apiKey } = getCredentials(request);
    const { id } = await params;
    const body = await request.json();
    await updateWord(apiKey, id, body);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/words/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "단어 수정 실패" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/words/:id — 단어 삭제 ───
export async function DELETE(request, { params }) {
  try {
    const { apiKey } = getCredentials(request);
    const { id } = await params;
    await deleteWord(apiKey, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/words/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "단어 삭제 실패" },
      { status: 500 }
    );
  }
}

// ─── OPTIONS — CORS preflight ───
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
