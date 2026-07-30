// functions/api/evaluate.js
// 関連図ワークベンチ — グラフ評価API
// クライアントから受け取ったグラフ構造を評価し、
//   ・各エッジのPES役割（E / S）
//   ・speech/dataノードの役割とケア未設定フラグ
//   ・原因（E）ごとの看護計画点検
//   ・看護診断ごとの S / E 集計
//   ・PES作法の達成度チェック
// を返す。判定基準・閾値はこのファイル内に閉じ、ブラウザには一切送られない。

function esc(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function buildGraph(payload){
  const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload && payload.edges) ? payload.edges : [];
  const byId = {}, outAdj = {}, inAdj = {};
  nodes.forEach(n => { byId[n.id] = n; outAdj[n.id] = []; inAdj[n.id] = []; });
  edges.forEach(e => {
    if (byId[e.source] && byId[e.target]) {
      outAdj[e.source].push(e.target);
      inAdj[e.target].push(e.source);
    }
  });
  return { nodes, edges, byId, outAdj, inAdj };
}
const outNodes = (id, G) => (G.outAdj[id] || []).map(t => G.byId[t]).filter(Boolean);
const inNodes  = (id, G) => (G.inAdj[id]  || []).map(s => G.byId[s]).filter(Boolean);
const degree   = (id, G) => (G.outAdj[id] || []).length + (G.inAdj[id] || []).length;

// ノードのPES役割：診断へ矢印を出す=S、症状(S)へ矢印を出す=E
function nodeRole(node, G){
  if (node.ntype !== 'speech' && node.ntype !== 'data') return null;
  const outs = outNodes(node.id, G);
  if (outs.some(t => t.ntype === 'diagnosis')) return 'S';
  if (outs.some(t => outNodes(t.id, G).some(t2 => t2.ntype === 'diagnosis'))) return 'E';
  return null;
}
// エッジのPES役割：診断へ入る矢印=S、症状へ入る矢印=E
function pesRole(edge, G){
  const tgt = G.byId[edge.target];
  if (!tgt) return null;
  if (tgt.ntype === 'diagnosis') return 'S';
  const tgtIsSymptom = outNodes(tgt.id, G).some(t => t.ntype === 'diagnosis');
  if (tgtIsSymptom) return 'E';
  return null;
}
// Eノードから出る看護ケア（OP/TP/EP）の種別配列
function careOf(node, G){
  return outNodes(node.id, G).filter(t => t.ntype === 'care').map(t => t.carekind);
}
function eNodesMissingCare(G){
  return G.nodes.filter(n =>
    (n.ntype === 'speech' || n.ntype === 'data') &&
    nodeRole(n, G) === 'E' &&
    careOf(n, G).length === 0);
}

function computeChecks(G){
  const diags   = G.nodes.filter(n => n.ntype === 'diagnosis');
  const Snodes  = G.nodes.filter(n => (n.ntype === 'speech' || n.ntype === 'data') &&
                    outNodes(n.id, G).some(t => t.ntype === 'diagnosis'));
  const Enodes  = G.nodes.filter(n => (n.ntype === 'speech' || n.ntype === 'data') && nodeRole(n, G) === 'E');
  const unlinked = G.nodes.filter(n => degree(n.id, G) === 0);
  const pNoS    = diags.filter(d => inNodes(d.id, G).length === 0);
  const sNoE    = Snodes.filter(s => inNodes(s.id, G).length === 0);
  const eNoCare = eNodesMissingCare(G);
  return [
    { label:'看護診断（P）を置いた', ok: diags.length > 0,
      detail: diags.length ? '' : '看護診断がまだありません' },
    { label:'各 P に S（症状）が接続', ok: diags.length > 0 && pNoS.length === 0,
      detail: diags.length === 0 ? 'まず P を置く'
            : pNoS.length ? 'Sのない診断：' + pNoS.map(d => d.base).join('、') : '' },
    { label:'各 S に E（原因）が接続', ok: Snodes.length > 0 && sNoE.length === 0,
      detail: Snodes.length === 0 ? 'まず S ➔ P を繋ぐ'
            : sNoE.length ? 'Eのない症状：' + sNoE.map(s => s.base).join('、') : '' },
    { label:'各 E に看護計画（OP/TP/EP）', ok: Enodes.length > 0 && eNoCare.length === 0,
      detail: Enodes.length === 0 ? 'まず E ➔ S を繋ぐ'
            : eNoCare.length ? 'ケアのない原因：' + eNoCare.map(e => e.base).join('、') : '' },
    { label:'孤立した情報がない', ok: G.nodes.length > 0 && unlinked.length === 0,
      detail: unlinked.length ? '未接続：' + unlinked.map(n => n.base).join('、') : '' }
  ];
}

function evaluate(payload){
  const G = buildGraph(payload);
  const CARE_KINDS = ['OP','TP','EP'];

  // 各エッジのPES役割
  const edges = G.edges.map(e => ({ source: e.source, target: e.target, pes: pesRole(e, G) }));

  // speech/dataノードの役割とケア未設定フラグ
  const nodesOut = G.nodes
    .filter(n => n.ntype === 'speech' || n.ntype === 'data')
    .map(n => {
      const role = nodeRole(n, G);
      return { id: n.id, role, needcare: role === 'E' && careOf(n, G).length === 0 };
    });

  // 原因（E）ごとの看護計画点検
  const Es = G.nodes.filter(n => (n.ntype === 'speech' || n.ntype === 'data') && nodeRole(n, G) === 'E');
  const items = Es.map(n => {
    const kinds = careOf(n, G);
    return { id: n.id, base: n.base, kinds, missing: kinds.length === 0 };
  });
  const care = { missingCount: items.filter(i => i.missing).length, items, kindsOrder: CARE_KINDS };

  // 看護診断ごとの S / E 集計
  const diagnoses = G.nodes.filter(n => n.ntype === 'diagnosis').map(d => {
    const Snodes = inNodes(d.id, G);
    const S = [...new Set(Snodes.map(sn => sn.base))];
    const Eset = new Set();
    Snodes.forEach(sn => inNodes(sn.id, G).forEach(en => Eset.add(en.base)));
    return { id: d.id, S, E: [...Eset] };
  });

  return { edges, nodes: nodesOut, care, diagnoses, checks: computeChecks(G) };
}

export async function onRequestPost(context){
  let payload;
  try { payload = await context.request.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'invalid json' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  return new Response(JSON.stringify(evaluate(payload)),
    { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ローカルテスト用（Cloudflare実行時には使われない）
export { evaluate };
