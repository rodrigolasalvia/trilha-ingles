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

// Contagem barata (sem copiar o estado): respostas detalhadas + resumo diário do arquivo.
export const answerCount = s => {
  try {
    if (!s || !Array.isArray(s.sessions)) return 0;
    let n = 0;
    for (const x of s.sessions) if (x && Array.isArray(x.answers)) n += x.answers.length;
    const days = s.archive && s.archive.days;
    if (days && typeof days === 'object') for (const v of Object.values(days)) if (Array.isArray(v)) n += Number(v[0]) || 0;
    return n;
  } catch { return 0; }
};
// Acima deste tamanho a cópia anterior não é duplicada no localStorage (as cópias ficam no IndexedDB),
// para nunca encostar no limite de ~5 MB do navegador.
const PREV_MAX_CHARS = 1_500_000;
let lastSize = 0;
let lastCount = null;
export const savedSize = () => lastSize;

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
  // Carimbo de gravação: na abertura, vence a cópia gravada por último (localStorage ou IndexedDB).
  state.savedAt = Math.max(Date.now(), (state.savedAt || 0) + 1);
  try {
    const current = localStorage.getItem(KEY);
    if (current) {
      if (current.length <= PREV_MAX_CHARS) localStorage.setItem(BACKUP_KEY, current);
      else localStorage.removeItem(BACKUP_KEY);
      // Estado novo com menos respostas que o gravado só acontece ao zerar, importar ou restaurar: guarda o antigo antes.
      // (A contagem da última gravação fica em memória, para não reler o estado inteiro a cada resposta.)
      const nowCount = answerCount(state);
      if (lastCount == null || nowCount < lastCount) {
        let prev = null;
        try { prev = JSON.parse(current); } catch { /* ilegível */ }
        if (prev && answerCount(prev) > nowCount) snapshot(migrateState(prev), reason || 'antes de uma redução');
      }
      lastCount = nowCount;
    }
    const json = JSON.stringify(state);
    lastSize = json.length;
    localStorage.setItem(KEY, json);
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

// Na abertura: se o espelho do IndexedDB foi gravado depois do localStorage (ex.: o localStorage encheu ou falhou),
// usa o espelho. Zerar e restaurar gravam carimbo novo, então nunca são desfeitos por isto.
export async function recoverNewer(state) {
  try {
    const all = await listRaw();
    const cur = all.find(r => r.key === 'current');
    if (!cur) return null;
    const st = migrateState(JSON.parse(cur.state));
    if ((st.savedAt || 0) > (state.savedAt || 0) && answerCount(st) >= answerCount(state)) return st;
  } catch (e) { console.warn('Comparação com o IndexedDB indisponível.', e); }
  return null;
}

export async function storageInfo() {
  const info = { stateKB: Math.round(lastSize / 1024), usedMB: null, quotaMB: null, persisted: null };
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      info.usedMB = e.usage != null ? +(e.usage / 1048576).toFixed(1) : null;
      info.quotaMB = e.quota != null ? Math.round(e.quota / 1048576) : null;
    }
    if (navigator.storage && navigator.storage.persisted) info.persisted = await navigator.storage.persisted();
  } catch { /* ignore */ }
  return info;
}
