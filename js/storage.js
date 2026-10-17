import { migrateState, emptyState } from './core.js';

const KEY = 'trilha-ingles:state';
const BACKUP_KEY = 'trilha-ingles:state:prev';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrateState(JSON.parse(raw));
    const prev = localStorage.getItem(BACKUP_KEY);
    if (prev) return migrateState(JSON.parse(prev));
  } catch (e) {
    console.warn('Falha ao ler o progresso salvo; tentando a cópia anterior.', e);
    try {
      const prev = localStorage.getItem(BACKUP_KEY);
      if (prev) return migrateState(JSON.parse(prev));
    } catch { /* segue para estado vazio */ }
  }
  return emptyState();
}

// Grava primeiro uma cópia do estado anterior: se a gravação nova falhar no meio, nada se perde.
export function saveState(state) {
  try {
    const current = localStorage.getItem(KEY);
    if (current) localStorage.setItem(BACKUP_KEY, current);
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Falha ao salvar o progresso.', e);
    return false;
  }
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
