export default function Home() {
  return (
    <div style={{ padding: 40, fontFamily: "system-ui" }}>
      <h1>Vocabulary API</h1>
      <p>Notion 동기화 API가 정상 작동 중입니다.</p>
      <h3>엔드포인트</h3>
      <ul>
        <li><code>GET /api/words</code> — 전체 단어 조회</li>
        <li><code>POST /api/words</code> — 단어 추가</li>
        <li><code>PATCH /api/words/:id</code> — 단어 수정</li>
        <li><code>DELETE /api/words/:id</code> — 단어 삭제</li>
      </ul>
    </div>
  );
}
