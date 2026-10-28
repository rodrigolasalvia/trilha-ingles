"""Registra a 'impressão digital' de cada exercício publicado em tests/ids.lock.json.
O histórico do usuário fica ligado ao id; o teste falha se um id publicado sumir ou mudar de sentido.
Uso: python3 tools/lock_ids.py  (só acrescenta ids novos; nunca altera os já travados)"""
import json, os, glob, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(ROOT, "tests", "ids.lock.json")

def fingerprint(it):
    # tipo + enunciado (ou, na ordenação, a frase): corrigir gabarito ou explicação continua permitido
    key = it["answer"] if it["type"] == "order" else it["prompt"]
    raw = f'{it["type"]}\x1f{key}'
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]

lock = json.load(open(LOCK)) if os.path.exists(LOCK) else {}
added = 0
for f in sorted(glob.glob(os.path.join(ROOT, "data", "[rt][0-9]*.json"))):
    for it in json.load(open(f, encoding="utf-8"))["items"]:
        if not it.get("variant") and it["id"] not in lock:
            lock[it["id"]] = fingerprint(it); added += 1
json.dump(dict(sorted(lock.items())), open(LOCK, "w"), indent=0)
print(f"travados: {len(lock)} (novos: {added})")
