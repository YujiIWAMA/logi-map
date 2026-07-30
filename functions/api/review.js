// functions/api/review.js
// 関連図ワークベンチ — 作図プロセスのふりかえり分析API
// クライアントから操作ログ(interactionLog)を受け取り、作り方の傾向を記述したHTMLを返す。
// 分類ロジック（収集先行型 / トップダウン型 など）とその判定閾値は、
// このファイル内に閉じており、ブラウザには送られない。

function esc(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function buildReview(interactionLog){
  const L = Array.isArray(interactionLog) ? interactionLog : [];
  const adds     = L.filter(e => e.action === 'add_node');
  const edges    = L.filter(e => e.action === 'add_edge');
  const blocks   = L.filter(e => e.action === 'blocked_edge');
  const dels     = L.filter(e => e.action === 'delete_edge' || e.action === 'delete_node');
  const toggles  = L.filter(e => e.action === 'toggle_edge');
  const reorders = L.filter(e => e.action === 'reorder_diagnosis');

  if (adds.length === 0 && edges.length === 0)
    return '<h2>作図のふりかえり</h2><div class="rlead">まだ十分な操作が記録されていません。情報を置いて繋いでから、もう一度お試しください。</div>';

  const cards = [];

  // 1 作図スタイル（線を引く前にどれだけ情報を置いたか）
  const firstEdgeT = edges.length ? edges[0].t : Infinity;
  const before = adds.filter(a => a.t < firstEdgeT).length;
  const ratio = adds.length ? before / adds.length : 0;
  let s1, d1;
  if (edges.length === 0)   { s1 = '情報収集の段階'; d1 = 'まだ線を引く前の、情報を集めて並べている状態です。'; }
  else if (ratio >= 0.7)    { s1 = '収集先行型'; d1 = '多くの情報を先に置いてから、まとめて関連づけていく進め方でした。全体を見渡してから構造化するタイプです。'; }
  else if (ratio <= 0.35)   { s1 = '随時関連型'; d1 = '情報を置きながら、その都度つないでいく進め方でした。部分ごとに関係を確かめながら積み上げるタイプです。'; }
  else                      { s1 = '折衷型'; d1 = '情報を集める段階と関連づける段階を、行き来しながら進めていました。'; }
  cards.push({ cls:'style', k:'作図のスタイル', v:s1, d:d1 });

  // 2 推論の方向（看護診断をどのタイミングで置いたか）
  const firstDiag = adds.find(a => a.type === 'diagnosis');
  let s2, d2;
  if (!firstDiag) { s2 = '診断は未配置'; d2 = '看護診断（P）がまだ置かれていません。情報から結論へ向かう途中の状態です。'; }
  else {
    const pos = adds.indexOf(firstDiag) / Math.max(1, adds.length - 1);
    if (pos <= 0.34)      { s2 = 'トップダウン型'; d2 = '早い段階で看護診断（P）を置き、そこから根拠となる情報へ遡って組み立てていました。仮説を先に立てるタイプです。'; }
    else if (pos >= 0.66) { s2 = 'ボトムアップ型'; d2 = '情報を十分に集めたあとで看護診断（P）に至っていました。事実から結論を積み上げるタイプです。'; }
    else                  { s2 = '並行型'; d2 = '情報の収集と看護診断の設定を、並行して進めていました。'; }
  }
  cards.push({ cls:'dir', k:'推論の方向', v:s2, d:d2 });

  // 3 作法のつまずき（PESの向きに反する操作の回数）
  let s3, d3;
  if (blocks.length === 0) { s3 = 'つまずきなし'; d3 = 'PESの向き（E→S→P、患者情報は起点）の作法に反する操作はありませんでした。'; }
  else {
    const bySrc = blocks.filter(b => b.reason === 'source_is_diagnosis').length;
    const byTgt = blocks.filter(b => b.reason === 'target_is_patient').length;
    const parts = [];
    if (bySrc) parts.push(`看護診断から矢印を出そうとした操作が${bySrc}回`);
    if (byTgt) parts.push(`患者情報へ矢印を入れようとした操作が${byTgt}回`);
    s3 = `気づきの機会 ${blocks.length}回`;
    d3 = parts.join('、') + 'ありました。作法の通知を受けて向きを見直せていれば、それ自体がPES構造の学びになっています。';
  }
  cards.push({ cls:'stumble', k:'作法のつまずき', v:s3, d:d3 });

  // 4 試行錯誤（削除・線種切替・並べ替えの割合）
  const rev = dels.length + toggles.length + reorders.length;
  const denom = Math.max(1, edges.length + adds.length);
  let s4, d4;
  if (rev === 0)              { s4 = '一筆書き型'; d4 = '一度置いた情報や線をほとんど直さず、まっすぐ描き上げていました。'; }
  else if (rev / denom >= 0.4){ s4 = '推敲型'; d4 = `削除・実線点線の切替・並べ替えなど、作り直しが${rev}回ありました。試しては見直す、練り上げるタイプです。`; }
  else                        { s4 = '適度な見直し型'; d4 = `要所で${rev}回の修正を入れながら進めていました。`; }
  cards.push({ cls:'trial', k:'試行錯誤', v:s4, d:d4 });

  // 5 概要
  const dur = L.length > 1 ? Math.round((L[L.length - 1].t - L[0].t) / 1000) : 0;
  cards.push({ cls:'result', k:'作図の概要', v:`情報 ${adds.length} ・ 線 ${edges.length}`,
    d:`所要 約${Math.floor(dur / 60)}分${dur % 60}秒。削除${dels.length}・線種切替${toggles.length}・並べ替え${reorders.length}回。` });

  return '<h2>作図のふりかえり</h2>' +
    '<div class="rlead">あなたの作り方の傾向を、操作の記録から振り返ります。傾向に良し悪しはありません。自分の進め方を知る手がかりとして眺めてください。</div>' +
    cards.map(c => `<div class="rcard ${c.cls}"><div class="rk">${esc(c.k)}</div><div class="rv">${esc(c.v)}</div><div class="rd">${esc(c.d)}</div></div>`).join('') +
    '<div class="rnote">※ この振り返りは、図が「正しいか」ではなく「どう作られたか」を映すものです。作法の達成度は左のゲージで確認できます。</div>';
}

export async function onRequestPost(context){
  let payload;
  try { payload = await context.request.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  return new Response(JSON.stringify({ html: buildReview(payload && payload.interactionLog) }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ローカルテスト用（Cloudflare実行時には使われない）
export { buildReview };
