import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import * as C from '../js/core.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const topics = JSON.parse(read('data/topics.json'));
const topicIds = topics.groups.flatMap(g => g.topics.map(t => t.id));
const items = topicIds.flatMap(id => JSON.parse(read(`data/${id}.json`)).items);

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

test('buildSession: respeita tema, nível e tamanho, sem repetir itens', () => {
  const s = C.buildSession(items, C.emptyState(), { topic: 't01', level: 2, size: 10, rng: seq() });
  assert.equal(s.length, 10);
  assert.equal(new Set(s.map(i => i.id)).size, 10);
  assert.ok(s.every(i => i.topic === 't01' && i.level === 2));
});

test('buildSession: prioriza itens errados e pendentes', () => {
  const now = Date.now();
  const st = C.emptyState();
  const pool = items.filter(i => i.topic === 't02' && i.level === 1);
  const missed = pool.slice(0, 3);
  for (const it of missed) st.items[it.id] = C.srsUpdate(undefined, false, now - 1000);
  const s = C.buildSession(items, st, { topic: 't02', level: 1, size: 10, now, rng: seq() });
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
  assert.equal(C.suggestedLevel(st, 't01'), 1);
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
