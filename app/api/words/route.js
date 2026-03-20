import { NextResponse } from "next/server";
import { getAllWords, createWord } from "@/lib/notion";

// ─── GET /api/words — 전체 단어 조회 ───
export async function GET() {
  try {
    const words = await getAllWords();
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
    const body = await request.json();
    const id = await createWord(body);
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
