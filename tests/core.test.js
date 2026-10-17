import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import * as C from '../js/core.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const topics = JSON.parse(read('data/topics.json'));
const topicIds = topics.groups.flatMap(g => g.topics.map(t => t.id));
const items = topicIds.flatMap(id => JSON.parse(read(`data/${id}.json`)).items);
const gates = topics.groups.filter(g => g.locked).map(g => g.id);
const openTopics = new Set(topics.groups.filter(g => !g.locked).flatMap(g => g.topics.map(t => t.id)));
const openItems = items.filter(i => openTopics.has(i.topic));
const DAY = C.DAY;
const NOW = Date.UTC(2026, 9, 17, 15);

// Simula prática: `days` dias (dos últimos `span`), `perDay` respostas por dia, com acerto `acc`, cobrindo `pool` em ordem.
function simulate(pool, { days = 14, span = 14, perDay = 15, acc = 0.85, now = NOW, from = null } = {}) {
  const st = C.emptyState(now - 60 * DAY);
  let k = 0;
  const step = span / days;
  for (let d = 0; d < days; d++) {
    const dayTs = (from ?? now) - Math.round((span - 1 - d * step) * DAY) - 3 * 3600e3;
    const rec = { id: `s${d}`, ts: dayTs, mode: 'topic', topic: null, level: null, label: '', answers: [] };
    st.sessions.push(rec);
    for (let j = 0; j < perDay; j++, k++) {
      const it = pool[k % pool.length];
      const ok = (k % 100) < acc * 100;
      const t = dayTs + j * 60e3;
      rec.answers.push({ id: it.id, ok, t, topic: it.topic, level: it.level, skill: it.skill });
      const r = st.items[it.id] || { box: 0, due: 0, seen: 0, correct: 0, wrong: 0, last: 0 };
      r.seen++; ok ? r.correct++ : r.wrong++; r.last = t;
      st.items[it.id] = r;
    }
  }
  return st;
}
// Ordem que intercala temas, para a cobertura crescer de forma realista.
const spread = list => { const by = {}; list.forEach(i => (by[i.topic] ||= []).push(i)); const qs = Object.values(by); const out = []; for (let i = 0; out.length < list.length; i++) for (const q of qs) if (q[i]) out.push(q[i]); return out; };

/* ---------- Banco de exercícios ---------- */

test('banco: todos os itens são válidos e os ids são únicos', () => {
  assert.deepEqual(C.validateBank(items), []);
});

test('banco: cada tema tem itens nos três níveis', () => {
  for (const id of topicIds) {
    for (const lv of C.LEVELS) {
      const n = items.filter(i => i.topic === id && i.level === lv).length;
      assert.ok(n >= 15, `${id} nível ${lv} tem só ${n} itens`);
    }
  }
});

test('banco: o gabarito de cada item é aceito pela própria correção', () => {
  for (const it of items) {
    let resp;
    if (it.type === 'gap') resp = it.answer[0];
    else if (it.type === 'order') resp = C.orderTokens(it).words;
    else resp = it.answer;
    assert.equal(C.checkAnswer(it, resp), true, `gabarito recusado: ${it.id}`);
  }
});

test('banco: nenhuma opção errada é aceita como correta', () => {
  for (const it of items.filter(i => i.type === 'mcq' || i.type === 'fix')) {
    for (const o of it.options.filter(o => o !== it.answer)) {
      assert.equal(C.checkAnswer(it, o), false, `${it.id}: "${o}" aceito`);
    }
  }
});

test('banco: lacunas trazem dica entre parênteses ou contexto', () => {
  for (const it of items.filter(i => i.type === 'gap')) {
    assert.match(it.prompt, /\(.+\)/, `${it.id} sem dica`);
  }
});

test('banco: itens de tema não declarado não existem', () => {
  for (const it of items) assert.ok(topicIds.includes(it.topic), it.id);
});

test('banco: todo item aponta para um padrão descrito e todo padrão tem exercícios', () => {
  const topicMeta = Object.fromEntries(topics.groups.flatMap(g => g.topics).map(t => [t.id, t]));
  for (const it of items) {
    const t = topicMeta[it.topic];
    assert.ok(t.skills.some(s => s.id === it.skill), `${it.id}: padrão ${it.skill} sem descrição`);
    assert.equal(it.cefr, t.cefr[it.level - 1], `${it.id}: cefr divergente`);
  }
  for (const t of Object.values(topicMeta)) {
    assert.ok(t.intro && t.intro.length > 20, `${t.id} sem explicação`);
    for (const sk of t.skills) {
      assert.ok(sk.tip && sk.ex, `${t.id}:${sk.id} sem dica ou exemplo`);
      const n = items.filter(i => i.topic === t.id && i.skill === sk.id).length;
      assert.ok(n >= 2, `${t.id}:${sk.id} tem só ${n} exercícios`);
    }
  }
});

test('banco: há conteúdo em A1, A2, B1 e B2', () => {
  for (const band of ['A1', 'A2', 'B1', 'B2']) assert.ok(items.some(i => i.cefr === band), band);
});

/* ---------- Correção ---------- */

test('normalize: caixa, espaços, apóstrofos curvos e pontuação final', () => {
  assert.equal(C.normalize('  To   Send. '), 'to send');
  assert.equal(C.normalize('I’m here!'), "i'm here");
  assert.equal(C.normalize(null), '');
});

test('checkAnswer: lacuna aceita variações e recusa vazio', () => {
  const it = { type: 'gap', answer: ['to get', 'in order to get'] };
  assert.equal(C.checkAnswer(it, 'To get'), true);
  assert.equal(C.checkAnswer(it, ' in  order to get '), true);
  assert.equal(C.checkAnswer(it, 'getting'), false);
  assert.equal(C.checkAnswer(it, '   '), false);
});

test('checkAnswer: ordenação compara a frase sem a pontuação final', () => {
  const it = { type: 'order', answer: 'Let me explain what happened.' };
  const { words, punct } = C.orderTokens(it);
  assert.deepEqual(words, ['Let', 'me', 'explain', 'what', 'happened']);
  assert.equal(punct, '.');
  assert.equal(C.checkAnswer(it, words), true);
  assert.equal(C.checkAnswer(it, ['me', 'Let', 'explain', 'what', 'happened']), false);
  assert.equal(C.checkAnswer(it, 'texto'), false);
});

test('checkAnswer: tipo desconhecido nunca é aceito', () => {
  assert.equal(C.checkAnswer({ type: 'xyz', answer: 'a' }, 'a'), false);
});

/* ---------- Repetição espaçada ---------- */

test('srsUpdate: acerto sobe de caixa, erro volta para zero e fica pendente', () => {
  const now = 1_000_000;
  let r = C.srsUpdate(undefined, true, now);
  assert.equal(r.box, 1); assert.equal(r.due, now + C.DAY);
  r = C.srsUpdate(r, true, now);
  assert.equal(r.box, 2); assert.equal(r.due, now + 3 * C.DAY);
  r = C.srsUpdate(r, false, now);
  assert.equal(r.box, 0); assert.equal(r.due, now);
  assert.equal(r.seen, 3); assert.equal(r.correct, 2); assert.equal(r.wrong, 1);
  for (let k = 0; k < 10; k++) r = C.srsUpdate(r, true, now);
  assert.equal(r.box, C.BOX_DAYS.length - 1);
});

/* ---------- Sessões ---------- */

const seq = () => { let x = 42; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

test('buildSession: respeita tema e tamanho, sem repetir itens e sempre misturando os níveis', () => {
  for (const id of topicIds) {
    const s = C.buildSession(items, C.emptyState(), { topic: id, size: 10, rng: seq() });
    assert.equal(s.length, 10);
    assert.equal(new Set(s.map(i => i.id)).size, 10);
    assert.ok(s.every(i => i.topic === id));
    for (const lv of C.LEVELS) assert.ok(s.filter(i => i.level === lv).length >= 3, `${id}: nível ${lv} sub-representado`);
  }
});

test('buildSession: prioriza itens errados e pendentes', () => {
  const now = Date.now();
  const st = C.emptyState();
  const pool = items.filter(i => i.topic === 't02');
  const missed = pool.slice(0, 3);
  for (const it of missed) st.items[it.id] = C.srsUpdate(undefined, false, now - 1000);
  const s = C.buildSession(items, st, { topic: 't02', size: 10, now, rng: seq() });
  for (const it of missed) assert.ok(s.includes(it), `pendente ${it.id} ficou de fora`);
});

test('buildSession: revisão traz apenas itens vencidos', () => {
  const now = Date.now();
  const st = C.emptyState();
  const [a, b, c] = items;
  st.items[a.id] = C.srsUpdate(undefined, false, now - 10);
  st.items[b.id] = C.srsUpdate(undefined, true, now);
  const s = C.buildSession(items, st, { mode: 'review', now });
  assert.deepEqual(s.map(i => i.id), [a.id]);
  assert.equal(C.dueCount(items, st, now), 1);
  assert.ok(!s.includes(c));
});

test('buildSession: refazer erros usa só os ids informados', () => {
  const ids = [items[5].id, items[9].id];
  const s = C.buildSession(items, C.emptyState(), { ids, rng: seq() });
  assert.deepEqual(s.map(i => i.id).sort(), ids.slice().sort());
});

test('buildSession: tema sem itens devolve lista vazia', () => {
  assert.deepEqual(C.buildSession(items, C.emptyState(), { topic: 'inexistente' }), []);
});

/* ---------- Estado, histórico e backup ---------- */

test('recordAnswer: grava no item e na sessão, sem duplicar a sessão', () => {
  const st = C.emptyState();
  const session = { id: 's1', ts: 1, mode: 'topic', topic: 't01', level: 1, answers: [] };
  C.recordAnswer(st, session, items[0], true, 100);
  C.recordAnswer(st, session, items[1], false, 200);
  assert.equal(st.sessions.length, 1);
  assert.equal(st.sessions[0].answers.length, 2);
  assert.equal(st.items[items[0].id].correct, 1);
  assert.equal(st.items[items[1].id].wrong, 1);
});

test('estatísticas: acerto recente, sequência de dias e série diária', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  const st = C.emptyState();
  const s = { id: 's', ts: now, mode: 'topic', topic: 't01', level: 1, answers: [] };
  const it = items.find(i => i.topic === 't01' && i.level === 1);
  for (let d = 0; d < 3; d++) {
    C.recordAnswer(st, s, it, true, now - d * C.DAY);
    C.recordAnswer(st, s, it, false, now - d * C.DAY);
  }
  const stat = C.topicLevelStats(st, 't01', 1);
  assert.equal(stat.recent, 6); assert.equal(stat.correct, 3); assert.equal(stat.acc, 0.5);
  assert.equal(C.streak(st, now), 3);
  assert.equal(C.streak(st, now + C.DAY), 3, 'sequência mantida no dia seguinte antes de estudar');
  assert.equal(C.streak(st, now + 2 * C.DAY), 0);
  const series = C.dailySeries(st, 7, now);
  assert.equal(series.length, 7);
  assert.equal(series[6].total, 2);
});

test('migrateState: entradas corrompidas viram estado válido', () => {
  for (const bad of [null, 'x', 42, [], { items: 'x', sessions: 'y' }]) {
    const s = C.migrateState(bad);
    assert.equal(s.version, C.STATE_VERSION);
    assert.deepEqual(s.items, {});
    assert.deepEqual(s.sessions, []);
  }
  const s = C.migrateState({ items: { a: { box: 99, due: 'x' }, b: null }, sessions: [{ id: 1, answers: [{ id: 'a', ok: 1 }, { foo: 1 }] }, { nope: true }] });
  assert.equal(s.items.a.box, C.BOX_DAYS.length - 1);
  assert.equal(s.items.a.due, 0);
  assert.ok(!('b' in s.items));
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].answers.length, 1);
});

test('backup: exporta e importa sem perda; recusa arquivos estranhos', () => {
  const st = C.emptyState(5);
  const session = { id: 's1', ts: 1, mode: 'topic', topic: 't01', level: 1, answers: [] };
  C.recordAnswer(st, session, items[0], true, 100);
  const back = C.parseBackup(C.makeBackup(st));
  assert.deepEqual(back, C.migrateState(st));
  assert.throws(() => C.parseBackup('não é json'), /JSON/);
  assert.throws(() => C.parseBackup('{"a":1}'), /backup/);
});

/* ---------- Padrões de erro, reforço e nível ---------- */

function answerMany(st, list, okFn, start = Date.now() - 1000) {
  const session = { id: 'sx', ts: start, mode: 'topic', topic: null, level: null, answers: [] };
  list.forEach((it, k) => C.recordAnswer(st, session, it, okFn(it, k), start + k));
  return st;
}

test('weakSkills: identifica o padrão com mais erros', () => {
  const st = C.emptyState();
  const bad = items.filter(i => i.topic === 't01' && i.skill === 'prep_ing');
  const good = items.filter(i => i.topic === 't01' && i.skill === 'ing_verbs').slice(0, 8);
  answerMany(st, [...bad, ...good], it => it.skill !== 'prep_ing');
  const weak = C.weakSkills(items, st);
  assert.equal(weak[0].key, 't01:prep_ing');
  assert.equal(weak[0].acc, 0);
  assert.ok(!weak.some(w => w.key === 't01:ing_verbs'), 'padrão com 100% não é ponto fraco');
});

test('buildReinforce: concentra a sessão nos padrões fracos', () => {
  const st = C.emptyState();
  const weakA = items.filter(i => i.topic === 't06' && i.skill === 'makedo').slice(0, 5);
  const weakB = items.filter(i => i.topic === 'r02' && i.skill === 'pp').slice(0, 4);
  const fine = items.filter(i => i.topic === 'r01').slice(0, 20);
  answerMany(st, [...weakA, ...weakB, ...fine], it => it.topic === 'r01');
  const { queue, focus } = C.buildReinforce(items, st, { rng: seq() });
  assert.equal(queue.length, 10);
  assert.deepEqual(focus.map(f => f.key).sort(), ['r02:pp', 't06:makedo']);
  const onFocus = queue.filter(i => ['t06:makedo', 'r02:pp'].includes(`${i.topic}:${i.skill}`)).length;
  assert.ok(onFocus >= 8, `só ${onFocus} itens no foco`);
});

test('buildReinforce: sem dados, devolve treino geral', () => {
  const { queue, focus } = C.buildReinforce(items, C.emptyState(), { rng: seq() });
  assert.equal(focus.length, 0);
  assert.equal(queue.length, 10);
});

test('buildSession: sessão por padrão usa só itens daquele padrão', () => {
  const s = C.buildSession(items, C.emptyState(), { skills: ['t07:indirect'], rng: seq() });
  assert.ok(s.length > 0 && s.every(i => i.topic === 't07' && i.skill === 'indirect'));
});

test('levelEstimate: sem dados não estima; consolida faixa a faixa', () => {
  let est = C.levelEstimate(openItems, C.emptyState());
  assert.equal(est.estimate, null);
  assert.equal(est.bands.find(b => b.band === 'C1').status, 'sem_conteudo', 'sem lotes liberados não há C1');
  assert.equal(C.levelEstimate(items, C.emptyState()).bands.find(b => b.band === 'C1').status, 'poucos_dados');

  const st = C.emptyState();
  const a1 = items.filter(i => i.cefr === 'A1').slice(0, 20);
  const a2 = items.filter(i => i.cefr === 'A2').slice(0, 20);
  const b1 = items.filter(i => i.cefr === 'B1').slice(0, 20);
  answerMany(st, [...a1, ...a2, ...b1], (it, k) => it.cefr !== 'B1' || k % 2 === 0);
  est = C.levelEstimate(items, st);
  assert.equal(est.estimate, 'A2');
  assert.equal(est.next.band, 'B1');
  assert.equal(est.bands.find(b => b.band === 'B1').status, 'em_progresso');
});

test('levelEstimate: base fraca impede estimar acima dela', () => {
  const st = C.emptyState();
  const a1 = items.filter(i => i.cefr === 'A1').slice(0, 20);
  const b1 = items.filter(i => i.cefr === 'B1').slice(0, 20);
  answerMany(st, [...a1, ...b1], it => it.cefr === 'B1' ? true : Math.random() < 0);
  const est = C.levelEstimate(items, st);
  assert.equal(est.bands.find(b => b.band === 'B1').status, 'consolidado');
  assert.equal(est.estimate, null, 'A1 com 0% não pode deixar estimar B1');
});

test('errorReport: lista padrões e erros reais com a resposta correta', () => {
  const st = C.emptyState();
  const bad = items.filter(i => i.topic === 't05' && i.skill === 'actually');
  answerMany(st, bad, () => false);
  const meta = (t, s) => ({ topicTitle: t, skillTitle: s });
  const txt = C.errorReport(items, st, meta);
  assert.match(txt, /t05 › actually: 0% de acerto/);
  assert.match(txt, /correto:/);
});

test('migração: estado da v1.0 (sem skill nas respostas) continua funcionando', () => {
  const v1 = { version: 1, createdAt: 1, items: { 't01-1-001': { box: 2, due: 5, seen: 3, correct: 2, wrong: 1, last: 4 } },
    sessions: [{ id: 's1', ts: 1, mode: 'topic', topic: 't01', level: 1, answers: [{ id: 't01-1-006', ok: false, t: 2, topic: 't01', level: 1 }, { id: 't01-1-017', ok: false, t: 3, topic: 't01', level: 1 }, { id: 't01-2-005', ok: false, t: 4, topic: 't01', level: 2 }] }] };
  const st = C.migrateState(JSON.parse(JSON.stringify(v1)));
  assert.equal(st.items['t01-1-001'].box, 2);
  const weak = C.weakSkills(items, st);
  assert.equal(weak[0].key, 't01:prep_ing', 'padrão deduzido pelo id do item');
});

/* ---------- PWA ---------- */

test('service worker: versão igual à do app e todos os arquivos listados existem', () => {
  const sw = read('sw.js');
  const version = sw.match(/CACHE_VERSION = '([^']+)'/)[1];
  assert.equal(version, C.APP_VERSION);
  const assets = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map(m => m[1]).filter(a => a !== './');
  for (const a of assets) assert.ok(existsSync(new URL(a, root)), `arquivo ausente: ${a}`);
  for (const id of topicIds) assert.ok(assets.includes(`data/${id}.json`), `data/${id}.json fora do cache`);
  for (const f of readdirSync(new URL('js/', root))) assert.ok(assets.includes(`js/${f}`), `js/${f} fora do cache`);
});

test('manifest: campos essenciais da PWA', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(new URL(i.src, root)), i.src);
});

/* ---------- Liberação silenciosa de lotes ---------- */

test('topics.json: lotes 3, 4 e 5 existem, fechados, na ordem de liberação', () => {
  assert.deepEqual(gates, ['lote3', 'lote4', 'lote5']);
  for (const g of topics.groups.filter(x => x.locked)) assert.ok(g.topics.length >= 5, g.id);
});

test('banco: lote 5 traz conteúdo C1 em todos os temas', () => {
  for (const id of ['t24', 't25', 't26', 't27', 't28']) assert.ok(items.some(i => i.topic === id && i.cefr === 'C1'), id);
});

test('unlockCheck: sem dados ou com pouca prática, nada é liberado', () => {
  assert.equal(C.unlockCheck(openItems, C.emptyState(), gates, NOW), null);
  // muito acerto, mas em poucos dias (pico, não constância)
  assert.equal(C.unlockCheck(openItems, simulate(spread(openItems), { days: 4, perDay: 90, acc: 0.95 }), gates, NOW), null);
});

test('unlockCheck: prática constante e boa libera o próximo lote', () => {
  const st = simulate(spread(openItems), { days: 12, perDay: 30, acc: 0.85 });
  assert.equal(C.unlockCheck(openItems, st, gates, NOW), 'lote3');
});

test('unlockCheck: acerto baixo, cobertura baixa ou tema muito fraco bloqueiam', () => {
  const pool = spread(openItems);
  assert.equal(C.unlockCheck(openItems, simulate(pool, { days: 12, perDay: 30, acc: 0.65 }), gates, NOW), null, 'acerto');
  assert.equal(C.unlockCheck(openItems, simulate(pool.slice(0, 120), { days: 12, perDay: 30, acc: 0.9 }), gates, NOW), null, 'cobertura');
  // tudo bom, exceto um tema com muitos erros
  const st = simulate(pool, { days: 12, perDay: 30, acc: 0.88 });
  const t = 't01';
  for (const s of st.sessions) for (const a of s.answers) if (a.topic === t) a.ok = false;
  assert.equal(C.unlockCheck(openItems, st, gates, NOW), null, 'tema fraco');
});

test('unlockCheck: um lote por vez, com intervalo mínimo entre liberações', () => {
  const st = simulate(spread(openItems), { days: 12, perDay: 30, acc: 0.85 });
  st.unlocked.lote3 = NOW - 3 * DAY;
  const open3 = items.filter(i => openTopics.has(i.topic) || ['t08','t09','t10','t11','t12','t13','t14','t15','t16'].includes(i.topic));
  assert.equal(C.unlockCheck(open3, st, gates, NOW), null, 'liberou cedo demais');
  const later = NOW + 20 * DAY;
  const st2 = simulate(spread(open3), { days: 12, perDay: 50, acc: 0.85, now: later });
  st2.unlocked.lote3 = NOW - 3 * DAY;
  assert.equal(C.unlockCheck(open3, st2, gates, later), 'lote4');
  st2.unlocked.lote4 = later; st2.unlocked.lote5 = later;
  assert.equal(C.unlockCheck(open3, st2, gates, later + 30 * DAY), null, 'nada mais a liberar');
});

test('migração e backup preservam lotes liberados e avisos vistos', () => {
  const st = C.emptyState(); st.unlocked = { lote3: 123456 }; st.announced = ['lote3'];
  const back = C.parseBackup(C.makeBackup(st));
  assert.deepEqual(back.unlocked, { lote3: 123456 });
  assert.deepEqual(back.announced, ['lote3']);
  const old = C.migrateState({ items: {}, sessions: [] });
  assert.deepEqual(old.unlocked, {});
  assert.deepEqual(old.announced, []);
  assert.deepEqual(C.migrateState({ unlocked: { lote3: 'x', lote4: -1 }, announced: [1, 'lote3'] }).unlocked, {});
});
