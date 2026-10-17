// Núcleo lógico puro: sem DOM, sem armazenamento. Testado em tests/core.test.js.

export const APP_VERSION = '1.2.0';
export const STATE_VERSION = 1;
export const DAY = 24 * 60 * 60 * 1000;
// Intervalos da repetição espaçada (em dias) por caixa 0..5.
export const BOX_DAYS = [0, 1, 3, 7, 14, 30];
export const TYPES = ['mcq', 'fix', 'gap', 'order'];
export const LEVELS = [1, 2, 3];
export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1'];
// Critérios da estimativa de nível (ver levelEstimate).
export const LEVEL_RULES = { lastN: 40, minData: 12, minSolid: 15, solidAcc: 0.8, weakAcc: 0.6 };

/* ---------- Texto e correção ---------- */

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:]+$/, '')
    .trim();
}

// Separa a pontuação final para que ela não "entregue" a última palavra.
export function orderTokens(item) {
  const m = String(item.answer).trim().match(/^(.*?)([.!?]?)$/);
  return { words: m[1].split(/\s+/).filter(Boolean), punct: m[2] || '' };
}

export function checkAnswer(item, response) {
  switch (item.type) {
    case 'mcq':
    case 'fix':
      return response === item.answer;
    case 'gap': {
      const accepted = Array.isArray(item.answer) ? item.answer : [item.answer];
      const r = normalize(response);
      return r.length > 0 && accepted.some(a => normalize(a) === r);
    }
    case 'order': {
      if (!Array.isArray(response)) return false;
      const r = normalize(response.join(' '));
      return [item.answer, ...(item.alt || [])].some(a => normalize(a) === r);
    }
    default:
      return false;
  }
}

export function correctAnswerText(item) {
  if (item.type === 'gap') return (Array.isArray(item.answer) ? item.answer : [item.answer]).join(' / ');
  return String(item.answer);
}

/* ---------- Validação do banco ---------- */

export function validateItem(item) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  need(item && typeof item === 'object', 'item não é objeto');
  if (errs.length) return errs;
  need(typeof item.id === 'string' && item.id.length > 0, 'id ausente');
  need(typeof item.topic === 'string' && item.topic.length > 0, 'topic ausente');
  need(LEVELS.includes(item.level), 'level inválido');
  need(TYPES.includes(item.type), 'type inválido');
  need(typeof item.skill === 'string' && item.skill.length > 0, 'padrão (skill) ausente');
  need(CEFR.includes(item.cefr), 'cefr inválido');
  need(typeof item.prompt === 'string' && item.prompt.trim().length > 0, 'prompt vazio');
  need(typeof item.explain === 'string' && item.explain.trim().length > 0, 'explicação vazia');
  if (item.type === 'mcq' || item.type === 'fix') {
    need(Array.isArray(item.options) && item.options.length >= 2, 'opções insuficientes');
    if (Array.isArray(item.options)) {
      need(new Set(item.options.map(normalize)).size === item.options.length, 'opções duplicadas');
      need(item.options.filter(o => o === item.answer).length === 1, 'resposta não está nas opções');
    }
  }
  if (item.type === 'gap') {
    need((item.prompt.match(/___/g) || []).length === 1, 'lacuna deve aparecer uma vez');
    need(Array.isArray(item.answer) && item.answer.length > 0 &&
      item.answer.every(a => typeof a === 'string' && normalize(a).length > 0), 'respostas da lacuna inválidas');
  }
  if (item.type === 'order') {
    need(typeof item.answer === 'string', 'resposta de ordenação deve ser texto');
    if (typeof item.answer === 'string') need(orderTokens(item).words.length >= 3, 'frase curta demais para ordenar');
  }
  return errs;
}

export function validateBank(items) {
  const errors = [];
  const seen = new Set();
  for (const it of items) {
    const id = it && it.id;
    for (const e of validateItem(it)) errors.push(`${id}: ${e}`);
    if (id) {
      if (seen.has(id)) errors.push(`${id}: id duplicado`);
      seen.add(id);
    }
  }
  return errors;
}

/* ---------- Estado ---------- */

export function emptyState(now = Date.now()) {
  return { version: STATE_VERSION, createdAt: now, items: {}, sessions: [], unlocked: {}, announced: [] };
}

// Aceita qualquer coisa e devolve um estado válido. Nunca lança erro.
export function migrateState(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState(now);
  const s = emptyState(raw.createdAt || now);
  if (raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items)) {
    for (const [id, r] of Object.entries(raw.items)) {
      if (!r || typeof r !== 'object') continue;
      s.items[id] = {
        box: clampInt(r.box, 0, BOX_DAYS.length - 1),
        due: num(r.due),
        seen: clampInt(r.seen, 0, 1e9),
        correct: clampInt(r.correct, 0, 1e9),
        wrong: clampInt(r.wrong, 0, 1e9),
        last: num(r.last),
      };
    }
  }
  if (raw.unlocked && typeof raw.unlocked === 'object' && !Array.isArray(raw.unlocked)) {
    for (const [g, ts] of Object.entries(raw.unlocked)) if (Number.isFinite(Number(ts)) && Number(ts) > 0) s.unlocked[g] = Number(ts);
  }
  if (Array.isArray(raw.announced)) s.announced = raw.announced.filter(g => typeof g === 'string');
  if (Array.isArray(raw.sessions)) {
    s.sessions = raw.sessions
      .filter(x => x && typeof x === 'object' && Array.isArray(x.answers))
      .map(x => ({
        id: String(x.id ?? ''),
        ts: num(x.ts),
        mode: String(x.mode ?? 'topic'),
        topic: x.topic ?? null,
        level: x.level ?? null,
        label: typeof x.label === 'string' ? x.label : '',
        answers: x.answers
          .filter(a => a && typeof a === 'object' && typeof a.id === 'string')
          .map(a => ({ id: a.id, ok: !!a.ok, t: num(a.t), topic: a.topic ?? null, level: a.level ?? null, skill: a.skill ?? null })),
      }));
  }
  return s;
}

// Valida um backup importado: lança erro com mensagem clara se não for um backup do app.
export function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('O arquivo não é um JSON válido.'); }
  if (!raw || raw.app !== 'trilha-ingles' || !raw.state) throw new Error('Este arquivo não é um backup da Trilha de Inglês.');
  return migrateState(raw.state);
}

export function makeBackup(state, now = Date.now()) {
  return JSON.stringify({ app: 'trilha-ingles', appVersion: APP_VERSION, exportedAt: new Date(now).toISOString(), state });
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function clampInt(v, lo, hi) { const n = Math.round(num(v)); return Math.min(hi, Math.max(lo, n)); }

/* ---------- Repetição espaçada ---------- */

export function srsUpdate(rec, ok, now = Date.now()) {
  const r = rec ? { ...rec } : { box: 0, due: 0, seen: 0, correct: 0, wrong: 0, last: 0 };
  r.seen += 1;
  if (ok) { r.correct += 1; r.box = Math.min(r.box + 1, BOX_DAYS.length - 1); }
  else { r.wrong += 1; r.box = 0; }
  r.due = now + BOX_DAYS[r.box] * DAY;
  r.last = now;
  return r;
}

export function recordAnswer(state, session, item, ok, now = Date.now()) {
  state.items[item.id] = srsUpdate(state.items[item.id], ok, now);
  session.answers.push({ id: item.id, ok, t: now, topic: item.topic, level: item.level, skill: item.skill ?? null });
  if (!state.sessions.includes(session)) {
    const idx = state.sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) state.sessions[idx] = session; else state.sessions.push(session);
  }
  return state;
}

/* ---------- Montagem de sessões ---------- */

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isDue(rec, now) { return !!rec && rec.seen > 0 && rec.due <= now; }

const skillKey = it => `${it.topic}:${it.skill}`;

// Intercala níveis para que toda sessão misture fácil, médio e difícil.
function interleaveLevels(list, rng) {
  const byLevel = LEVELS.map(lv => shuffle(list.filter(i => i.level === lv), rng));
  const out = [];
  for (let k = 0; out.length < list.length; k++) {
    for (const bucket of byLevel) if (bucket[k]) out.push(bucket[k]);
  }
  return out;
}

// Ordena um conjunto pela prioridade: pendentes (erros recentes primeiro), novos com níveis misturados, depois os mais antigos.
function prioritize(pool, state, now, rng) {
  const rec = id => state.items[id];
  const due = shuffle(pool.filter(i => isDue(rec(i.id), now)), rng).sort((a, b) => rec(a.id).box - rec(b.id).box);
  const unseen = interleaveLevels(pool.filter(i => !rec(i.id) || !rec(i.id).seen), rng);
  const later = pool.filter(i => rec(i.id) && rec(i.id).seen && !isDue(rec(i.id), now))
    .sort((a, b) => rec(a.id).due - rec(b.id).due);
  return { due, unseen, later };
}

export function buildSession(items, state, { topic = null, skills = null, mode = 'topic', size = 10, ids = null, now = Date.now(), rng = Math.random } = {}) {
  if (ids) {
    const byId = new Map(items.map(i => [i.id, i]));
    return shuffle(ids.map(id => byId.get(id)).filter(Boolean), rng).slice(0, size);
  }
  let pool = items;
  if (topic) pool = pool.filter(i => i.topic === topic);
  if (skills) { const set = new Set(skills); pool = pool.filter(i => set.has(skillKey(i))); }

  const rec = id => state.items[id];
  if (mode === 'review') {
    return pool.filter(i => isDue(rec(i.id), now))
      .sort((a, b) => rec(a.id).box - rec(b.id).box || rec(a.id).due - rec(b.id).due)
      .slice(0, size);
  }

  const { due, unseen, later } = prioritize(pool, state, now, rng);
  const picked = [];
  const take = (list, n) => { for (const it of list) { if (picked.length >= size || n <= 0) break; if (!picked.includes(it)) { picked.push(it); n--; } } };
  take(due, Math.ceil(size * 0.4));
  take(unseen, size);
  take(due, size);
  take(later, size);
  return shuffle(picked, rng);
}

/* ---------- Estatísticas ---------- */

export function allAnswers(state) {
  const out = [];
  for (const s of state.sessions) for (const a of s.answers) out.push(a);
  return out.sort((a, b) => a.t - b.t);
}

export function topicLevelStats(state, topic, level = null, lastN = 20) {
  const list = allAnswers(state).filter(a => a.topic === topic && (level == null || a.level === level));
  const recent = list.slice(-lastN);
  const correct = recent.filter(a => a.ok).length;
  return { total: list.length, recent: recent.length, correct, acc: recent.length ? correct / recent.length : null };
}

export function coverage(items, state, topic, level = null) {
  const pool = items.filter(i => i.topic === topic && (level == null || i.level === level));
  const seen = pool.filter(i => state.items[i.id] && state.items[i.id].seen > 0).length;
  return { seen, total: pool.length };
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function streak(state, now = Date.now()) {
  const days = new Set(allAnswers(state).map(a => dayKey(a.t)));
  if (!days.size) return 0;
  let n = 0;
  const d = new Date(now);
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function dailySeries(state, days = 30, now = Date.now()) {
  const map = new Map();
  for (const a of allAnswers(state)) {
    const k = dayKey(a.t);
    const v = map.get(k) || { total: 0, correct: 0 };
    v.total++; if (a.ok) v.correct++;
    map.set(k, v);
  }
  const out = [];
  const d = new Date(now);
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const k = dayKey(d.getTime());
    out.push({ day: k, ...(map.get(k) || { total: 0, correct: 0 }) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function periodAccuracy(state, days, now = Date.now()) {
  const since = now - days * DAY;
  const list = allAnswers(state).filter(a => a.t >= since);
  const correct = list.filter(a => a.ok).length;
  return { total: list.length, correct, acc: list.length ? correct / list.length : null };
}

export function dueCount(items, state, now = Date.now()) {
  return items.filter(i => isDue(state.items[i.id], now)).length;
}

/* ---------- Padrões de erro e reforço ---------- */

// Desempenho por padrão (tema + skill) nas últimas `lastN` respostas de cada padrão.
export function skillStats(items, state, lastN = 20) {
  const byId = new Map(items.map(i => [i.id, i]));
  const groups = new Map();
  for (const a of allAnswers(state)) {
    const it = byId.get(a.id);
    if (!it) continue;
    const k = skillKey(it);
    if (!groups.has(k)) groups.set(k, { key: k, topic: it.topic, skill: it.skill, list: [] });
    groups.get(k).list.push(a);
  }
  return [...groups.values()].map(g => {
    const recent = g.list.slice(-lastN);
    const correct = recent.filter(a => a.ok).length;
    const wrong = recent.length - correct;
    return {
      key: g.key, topic: g.topic, skill: g.skill, total: g.list.length, n: recent.length, correct, wrong,
      acc: recent.length ? correct / recent.length : null,
      // Taxa de erro suavizada: evita que 1 erro em 1 tentativa domine o ranking.
      score: (wrong + 1) / (recent.length + 2),
      lastWrong: g.list.filter(a => !a.ok).map(a => a.id).slice(-3),
    };
  });
}

export function weakSkills(items, state, { min = 3, limit = 6 } = {}) {
  return skillStats(items, state)
    .filter(s => s.n >= min && s.acc < 0.9)
    .sort((a, b) => b.score - a.score || a.acc - b.acc)
    .slice(0, limit);
}

export function topicRanking(items, state, topicIds, lastN = 30) {
  return topicIds.map(id => ({ topic: id, ...topicLevelStats(state, id, null, lastN), cov: coverage(items, state, id) }))
    .filter(t => t.recent > 0)
    .sort((a, b) => a.acc - b.acc);
}

// Sessão de reforço: concentra-se nos 3 padrões mais fracos (5/3/2 exercícios) e completa com pendentes.
export function buildReinforce(items, state, { size = 10, now = Date.now(), rng = Math.random } = {}) {
  const focus = weakSkills(items, state, { min: 3, limit: 3 }).filter(s => s.score > 0.25);
  if (!focus.length) return { queue: buildSession(items, state, { size, now, rng }), focus: [] };
  const quotas = focus.length === 1 ? [size] : focus.length === 2 ? [6, 4] : [5, 3, 2];
  const picked = [];
  const take = (list, n) => { for (const it of list) { if (picked.length >= size || n <= 0) break; if (!picked.includes(it)) { picked.push(it); n--; } } };
  focus.forEach((f, i) => {
    const pool = items.filter(it => skillKey(it) === f.key);
    const { due, unseen, later } = prioritize(pool, state, now, rng);
    take([...due, ...unseen, ...later], Math.round(quotas[i] * size / 10));
  });
  const focusPools = items.filter(it => focus.some(f => f.key === skillKey(it)));
  const p = prioritize(focusPools, state, now, rng);
  take([...p.due, ...p.unseen, ...p.later], size);
  const g = prioritize(items, state, now, rng);
  take([...g.due, ...g.unseen], size);
  return { queue: shuffle(picked, rng), focus };
}

/* ---------- Estimativa de nível (A1–C1) ---------- */

// Para cada faixa CEFR, considera as últimas 40 respostas de itens daquela faixa.
// Consolidado: >= 80% de acerto com pelo menos 15 respostas.
// Nível estimado: a faixa consolidada mais alta, desde que nenhuma faixa abaixo esteja com menos de 60%.
export function levelEstimate(items, state, rules = LEVEL_RULES) {
  const byId = new Map(items.map(i => [i.id, i]));
  const answers = allAnswers(state);
  const bands = CEFR.map(band => {
    const list = answers.filter(a => byId.get(a.id)?.cefr === band).slice(-rules.lastN);
    const correct = list.filter(a => a.ok).length;
    const available = items.filter(i => i.cefr === band).length;
    const acc = list.length ? correct / list.length : null;
    let status;
    if (!available) status = 'sem_conteudo';
    else if (list.length < rules.minData) status = 'poucos_dados';
    else if (list.length >= rules.minSolid && acc >= rules.solidAcc) status = 'consolidado';
    else status = 'em_progresso';
    return { band, n: list.length, correct, acc, available, status };
  });
  let estimate = null;
  bands.forEach((b, i) => {
    if (b.status !== 'consolidado') return;
    const weakBelow = bands.slice(0, i).some(x => x.status === 'em_progresso' && x.acc < rules.weakAcc);
    if (!weakBelow) estimate = b.band;
  });
  const idx = estimate ? CEFR.indexOf(estimate) : -1;
  const next = bands.slice(idx + 1).find(b => b.status !== 'consolidado') || null;
  return { bands, estimate, next, totalAnswers: answers.length };
}

/* ---------- Relatório de erros (para pedir novos exercícios) ---------- */

export function errorReport(items, state, meta, now = Date.now()) {
  const byId = new Map(items.map(i => [i.id, i]));
  const weak = weakSkills(items, state, { min: 3, limit: 5 });
  const lines = [
    'Trilha de Inglês: relatório de erros',
    `Gerado em ${new Date(now).toLocaleDateString('pt-BR')} · ${allAnswers(state).length} respostas registradas`,
    '',
    'Padrões com mais erros (últimas 20 respostas de cada um):',
  ];
  if (!weak.length) lines.push('- Ainda não há dados suficientes.');
  weak.forEach((w, i) => {
    const m = meta(w.topic, w.skill);
    lines.push(`${i + 1}. ${m.topicTitle} › ${m.skillTitle}: ${Math.round(w.acc * 100)}% de acerto (${w.correct}/${w.n})`);
    for (const id of w.lastWrong) {
      const it = byId.get(id);
      if (!it) continue;
      const q = it.type === 'order' ? '(ordenação)' : it.prompt;
      lines.push(`   - Errei: ${q} → correto: ${correctAnswerText(it)}`);
    }
  });
  lines.push('', 'Pedido: crie um lote novo de exercícios objetivos (lacuna, múltipla escolha, corrigir a frase, ordenar) focado nesses padrões, no formato do banco da Trilha de Inglês.');
  return lines.join('\n');
}

// ---------- Liberação de lotes ----------
// Avaliação silenciosa: nada disto aparece na interface. Libera no máximo um lote por vez, na ordem de `gates`.
export const UNLOCK_RULES = {
  windowDays: 14,     // janela observada
  minActiveDays: 8,   // dias com prática dentro da janela
  minAnswers: 120,    // respostas dentro da janela
  recentN: 100,       // últimas respostas...
  recentAcc: 0.75,    // ...com este acerto
  weekMin: 40,        // cada uma das duas semanas: mínimo de respostas...
  weekAcc: 0.70,      // ...e de acerto (constância, não pico)
  minCoverage: 0.6,   // fração dos exercícios disponíveis já vistos
  topicMin: 10,       // tema com ao menos tantas respostas na janela...
  topicAcc: 0.6,      // ...não pode estar abaixo disto
  minGapDays: 14,     // intervalo mínimo entre duas liberações
};

export function isUnlocked(state, groupId) { return !!(state.unlocked && state.unlocked[groupId]); }

export function unlockCheck(items, state, gates, now = Date.now(), r = UNLOCK_RULES) {
  const next = gates.find(g => !isUnlocked(state, g));
  if (!next) return null;
  const last = Math.max(0, ...Object.values(state.unlocked || {}));
  if (last && now - last < r.minGapDays * DAY) return null;

  const active = new Set(items.map(i => i.id));
  const answers = allAnswers(state).filter(a => active.has(a.id) && a.t <= now);
  const from = now - r.windowDays * DAY;
  const win = answers.filter(a => a.t > from);
  if (win.length < r.minAnswers) return null;
  if (new Set(win.map(a => dayKey(a.t))).size < r.minActiveDays) return null;

  const acc = list => list.filter(a => a.ok).length / list.length;
  const recent = answers.slice(-r.recentN);
  if (recent.length < r.recentN || acc(recent) < r.recentAcc) return null;

  const mid = now - (r.windowDays / 2) * DAY;
  for (const week of [win.filter(a => a.t <= mid), win.filter(a => a.t > mid)]) {
    if (week.length < r.weekMin || acc(week) < r.weekAcc) return null;
  }

  const seen = items.filter(i => state.items[i.id] && state.items[i.id].seen > 0).length;
  if (!items.length || seen / items.length < r.minCoverage) return null;

  const topicOf = new Map(items.map(i => [i.id, i.topic]));
  const byTopic = new Map();
  for (const a of win) {
    const t = topicOf.get(a.id);
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(a);
  }
  for (const list of byTopic.values()) if (list.length >= r.topicMin && acc(list) < r.topicAcc) return null;

  return next;
}
