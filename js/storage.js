import { migrateState, emptyState, dayKey } from './core.js';

// Três camadas de proteção do progresso, todas no próprio aparelho:
// 1. localStorage (principal) + cópia da gravação anterior;
// 2. IndexedDB: espelho do estado atual, independente do localStorage;
// 3. IndexedDB: uma cópia por dia (últimos SNAP_KEEP dias) e cópias marcadas antes de zerar, importar ou restaurar.
// Nenhuma gravação apaga uma versão mais rica sem antes guardá-la como cópia.

const KEY = 'trilha-ingles:state';
const BACKUP_KEY = 'trilha-ingles:state:prev';
const DB_NAME = 'trilha-ingles';
const STORE = 'snapshots';
const SNAP_KEEP = 14;

export const answerCount = s => (s && Array.isArray(s.sessions) ? s.sessions.reduce((n, x) => n + (Array.isArray(x.answers) ? x.answers.length : 0), 0) : 0);

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? migrateState(JSON.parse(raw)) : null;
  } catch (e) {
    console.warn('Gravação local ilegível:', key, e);
    return null;
  }
}

// Escolhe, entre as cópias disponíveis, a que tem mais respostas registradas.
export function richest(...states) {
  return states.filter(Boolean).reduce((best, s) => (!best || answerCount(s) > answerCount(best) ? s : best), null);
}

export function loadState() {
  return richest(readLocal(KEY), readLocal(BACKUP_KEY)) || emptyState();
}

// A gravação principal está legível? Se não estiver (apagada pelo sistema ou corrompida), a abertura
// compara a cópia anterior com o IndexedDB e fica com a mais rica. Zerar grava um estado válido, então não dispara isto.
export function hasLocal() {
  return !!readLocal(KEY);
}

// Grava primeiro uma cópia do estado anterior: se a gravação nova falhar no meio, nada se perde.
export function saveState(state, { reason = null } = {}) {
  let ok = true;
  try {
    const current = localStorage.getItem(KEY);
    if (current) {
      localStorage.setItem(BACKUP_KEY, current);
      // Estado novo com menos respostas que o gravado só acontece ao zerar, importar ou restaurar: guarda o antigo antes.
      let prev = null;
      try { prev = JSON.parse(current); } catch { /* ilegível */ }
      if (prev && answerCount(prev) > answerCount(state)) snapshot(migrateState(prev), reason || 'antes de uma redução');
    }
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Falha ao salvar o progresso no localStorage.', e);
    ok = false;
  }
  mirror(state);
  return ok;
}

export function clearState() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(BACKUP_KEY); } catch { /* ignore */ }
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

/* ---------- IndexedDB ---------- */

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(e => { dbPromise = null; throw e; });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const record = (key, state, label) => ({ key, ts: Date.now(), label, answers: answerCount(state), state: JSON.stringify(state) });

// Espelho do estado atual + cópia do dia. Silencioso: falhas aqui nunca atrapalham a prática.
let mirrorTimer = null;
function mirror(state) {
  clearTimeout(mirrorTimer);
  const json = JSON.stringify(state);
  mirrorTimer = setTimeout(async () => {
    try {
      const s = JSON.parse(json);
      await tx('readwrite', st => {
        st.put(record('current', s, 'atual'));
        st.put(record(`day:${dayKey(Date.now())}`, s, 'cópia do dia'));
      });
      await prune();
    } catch (e) { console.warn('Espelho em IndexedDB indisponível.', e); }
  }, 400);
}

export async function snapshot(state, label) {
  try {
    await tx('readwrite', st => st.put(record(`mark:${Date.now()}`, state, label)));
    await prune();
  } catch (e) { console.warn('Não foi possível guardar a cópia.', e); }
}

async function prune() {
  const all = await listRaw();
  const days = all.filter(r => r.key.startsWith('day:')).sort((a, b) => b.key.localeCompare(a.key));
  const marks = all.filter(r => r.key.startsWith('mark:')).sort((a, b) => b.ts - a.ts);
  const drop = [...days.slice(SNAP_KEEP), ...marks.slice(10)].map(r => r.key);
  if (drop.length) await tx('readwrite', st => drop.forEach(k => st.delete(k)));
}

async function listRaw() {
  return (await tx('readonly', st => st.getAll())) || [];
}

// Cópias automáticas, da mais recente para a mais antiga (sem o espelho 'current').
export async function listSnapshots() {
  try {
    return (await listRaw()).filter(r => r.key !== 'current')
      .sort((a, b) => b.ts - a.ts)
      .map(({ key, ts, label, answers }) => ({ key, ts, label, answers }));
  } catch { return []; }
}

export async function readSnapshot(key) {
  const all = await listRaw();
  const r = all.find(x => x.key === key);
  return r ? migrateState(JSON.parse(r.state)) : null;
}

// Na abertura, quando o localStorage está vazio ou ilegível: recupera a cópia mais rica do IndexedDB.
export async function recoverRicher(state) {
  try {
    const all = await listRaw();
    let best = null;
    for (const r of all) {
      if (!best || r.answers > best.answers) best = r;
    }
    if (best && best.answers > answerCount(state)) return migrateState(JSON.parse(best.state));
  } catch (e) { console.warn('Recuperação via IndexedDB indisponível.', e); }
  return null;
}
