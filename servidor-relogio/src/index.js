// Carga Relógio — ponte entre o Apple Watch (Atalhos) e o app Carga no celular.
// Cada pessoa tem um código secreto (token); cada token vive num Durable Object próprio.
//
//   PUT  /p/<token>  (celular)  envia o plano do treino em andamento   -> {ok, marks}
//   GET  /p/<token>  (celular)  lê séries marcadas pelo relógio        -> {plan, marks}
//   GET  /s/<token>  (relógio)  "série feita": marca a próxima série   -> {descanso, msg}
//   GET  /u/<token>  (relógio)  desfaz a última marcação do relógio    -> {descanso, msg}
import { DurableObject } from "cloudflare:workers";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const m = new URL(req.url).pathname.match(/^\/([psu])\/([A-Za-z0-9_-]{16,64})\/?$/);
    if (!m) return json({ ok: true, app: "Carga Relógio" });
    const stub = env.SESSION.get(env.SESSION.idFromName(m[2]));
    return stub.handle(m[1], req.method, req.method === "PUT" ? await req.text() : null);
  },
};

const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export class Session extends DurableObject {
  async handle(kind, method, body) {
    let plan = (await this.ctx.storage.get("plan")) || null;
    let marks = (await this.ctx.storage.get("marks")) || [];

    if (kind === "p" && method === "PUT") {
      let p; try { p = JSON.parse(body); } catch { return json({ ok: false, error: "json" }, 400); }
      if (p && p.active === false) { await this.ctx.storage.put({ plan: null, marks: [] }); return json({ ok: true, marks: [] }); }
      if (!p || !Array.isArray(p.items) || body.length > 200000) return json({ ok: false, error: "plano" }, 400);
      // descarta marcações de outro treino ou que o celular já incorporou
      marks = marks.filter(k => k.wid === p.id && !isDone(p, k.item, k.j));
      await this.ctx.storage.put({ plan: p, marks });
      return json({ ok: true, marks });
    }
    if (kind === "p") return json({ plan, marks });

    if (!plan) return json({ descanso: 0, msg: "Nenhum treino em andamento. Inicie o treino no celular." });

    if (kind === "u") {
      const last = marks.pop();
      if (!last) return json({ descanso: 0, msg: "Nada para desfazer." });
      await this.ctx.storage.put("marks", marks);
      const it = plan.items.find(x => x.id === last.item);
      return json({ descanso: 0, msg: `Desfeito: ${it ? it.name : "série"} ${last.j + 1}` });
    }

    // kind === "s": próxima série pendente, na ordem do treino (supersérie alterna entre os exercícios)
    const next = nextSet(plan, marks);
    if (!next) return json({ descanso: 0, msg: "Treino completo! Finalize no celular." });
    const now = Date.now();
    marks.push({ wid: plan.id, item: next.it.id, j: next.j, at: now });
    await this.ctx.storage.put("marks", marks);
    const s = next.it.sets[next.j];
    const after = nextSet(plan, marks);
    const rest = next.lastOfBlock ? (next.it.rest || 90) : 15;
    const upNext = after ? `Próxima: ${after.it.name} (${after.j + 1}/${after.it.sets.length})` : "Era a última série!";
    return json({
      descanso: after ? rest : 0,
      msg: `✓ ${next.it.name} ${next.j + 1}/${next.it.sets.length} · ${s.reps ?? "-"} × ${s.kg ?? 0} kg\n${after ? (next.lastOfBlock ? `Descanso ${fmt(rest)}` : "Troca de aparelho") + "\n" : ""}${upNext}`,
    });
  }
}

function isDone(plan, itemId, j) {
  const it = plan.items.find(x => x.id === itemId);
  return !!(it && it.sets[j] && it.sets[j].done);
}

// Ordem: blocos (exercício solo ou supersérie). Dentro da supersérie: série 1 de A, série 1 de B, série 2 de A...
function nextSet(plan, marks) {
  const marked = new Set(marks.map(k => k.item + ":" + k.j));
  const pending = (it, j) => it.sets[j] && !it.sets[j].done && !marked.has(it.id + ":" + j);
  const blocks = [];
  for (const it of plan.items) {
    const b = blocks[blocks.length - 1];
    if (it.ss && b && b.ss === it.ss) b.items.push(it); else blocks.push({ ss: it.ss || null, items: [it] });
  }
  for (const b of blocks) {
    const rounds = Math.max(...b.items.map(it => it.sets.length));
    for (let j = 0; j < rounds; j++) {
      for (let k = 0; k < b.items.length; k++) {
        const it = b.items[k];
        if (!pending(it, j)) continue;
        // último do bloco nesta rodada = nenhum exercício seguinte do bloco ainda tem a série j
        const lastOfBlock = !b.items.slice(k + 1).some(o => o.sets[j]);
        return { it, j, lastOfBlock };
      }
    }
  }
  return null;
}
