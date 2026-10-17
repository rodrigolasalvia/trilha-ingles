// Núcleo lógico puro: sem DOM, sem armazenamento. Testado em tests/core.test.js.

export const APP_VERSION = '1.0.0';
export const STATE_VERSION = 1;
export const DAY = 24 * 60 * 60 * 1000;
// Intervalos da repetição espaçada (em dias) por caixa 0..5.
export const BOX_DAYS = [0, 1, 3, 7, 14, 30];
export const TYPES = ['mcq', 'fix', 'gap', 'order'];
export const LEVELS = [1, 2, 3];

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
  return { version: STATE_VERSION, createdAt: now, items: {}, sessions: [] };
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
  if (Array.isArray(raw.sessions)) {
    s.sessions = raw.sessions
      .filter(x => x && typeof x === 'object' && Array.isArray(x.answers))
      .map(x => ({
        id: String(x.id ?? ''),
        ts: num(x.ts),
        mode: String(x.mode ?? 'topic'),
        topic: x.topic ?? null,
        level: x.level ?? null,
        answers: x.answers
          .filter(a => a && typeof a === 'object' && typeof a.id === 'string')
          .map(a => ({ id: a.id, ok: !!a.ok, t: num(a.t), topic: a.topic ?? null, level: a.level ?? null })),
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
  session.answers.push({ id: item.id, ok, t: now, topic: item.topic, level: item.level });
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

export function buildSession(items, state, { topic = null, level = null, mode = 'topic', size = 10, ids = null, now = Date.now(), rng = Math.random } = {}) {
  if (ids) {
    const byId = new Map(items.map(i => [i.id, i]));
    return shuffle(ids.map(id => byId.get(id)).filter(Boolean), rng).slice(0, size);
  }
  let pool = items;
  if (topic) pool = pool.filter(i => i.topic === topic);
  if (level) pool = pool.filter(i => i.level === level);

  const rec = id => state.items[id];
  if (mode === 'review') {
    return pool.filter(i => isDue(rec(i.id), now))
      .sort((a, b) => rec(a.id).box - rec(b.id).box || rec(a.id).due - rec(b.id).due)
      .slice(0, size);
  }

  const due = shuffle(pool.filter(i => isDue(rec(i.id), now)), rng).sort((a, b) => rec(a.id).box - rec(b.id).box);
  const unseen = shuffle(pool.filter(i => !rec(i.id) || !rec(i.id).seen), rng);
  const later = pool.filter(i => rec(i.id) && rec(i.id).seen && !isDue(rec(i.id), now))
    .sort((a, b) => rec(a.id).due - rec(b.id).due);

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

export function topicLevelStats(state, topic, level, lastN = 20) {
  const list = allAnswers(state).filter(a => a.topic === topic && (level == null || a.level === level));
  const recent = list.slice(-lastN);
  const correct = recent.filter(a => a.ok).length;
  return { total: list.length, recent: recent.length, correct, acc: recent.length ? correct / recent.length : null };
}

export function coverage(items, state, topic, level) {
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

// Sugere o nível a praticar: o primeiro nível sem domínio (>= 80% nas últimas 20, mínimo 10 respostas).
export function suggestedLevel(state, topic) {
  for (const lv of LEVELS) {
    const st = topicLevelStats(state, topic, lv);
    if (st.recent < 10 || st.acc < 0.8) return lv;
  }
  return 3;
}
