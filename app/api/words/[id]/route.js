import { NextResponse } from "next/server";
import { updateWord, deleteWord } from "@/lib/notion";

// ─── PATCH /api/words/:id — 단어 수정 ───
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    await updateWord(id, body);
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
    const { id } = await params;
    await deleteWord(id);
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
