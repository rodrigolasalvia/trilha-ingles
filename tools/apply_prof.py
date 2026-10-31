"""Insere os módulos de aprofundamento (tools/meta_prof.py) em data/topics.json, logo depois do Lote 2.
Idempotente. Ficam abertos desde o início ('extra': não contam na régua de liberação dos lotes fechados)."""
import json, os, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("meta", os.path.join(ROOT, "tools", "meta_prof.py"))
meta = importlib.util.module_from_spec(spec); spec.loader.exec_module(meta)

GROUPS = [
    {"id": "prof1", "title": "Aprofundamento I · Gramática essencial", "level": "B1–B2", "color": "#8A3B12", "extra": True, "topics": meta.PROF1},
    {"id": "prof2", "title": "Aprofundamento II · Estrutura e precisão", "level": "B1–B2", "color": "#2F5D50", "extra": True, "topics": meta.PROF2},
]
path = os.path.join(ROOT, "data", "topics.json")
data = json.load(open(path, encoding="utf-8"))
data["groups"] = [g for g in data["groups"] if g["id"] not in ("prof1", "prof2")]
at = next(i for i, g in enumerate(data["groups"]) if g["id"] == "lote2") + 1
data["groups"][at:at] = GROUPS
data["version"] = 4
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2); f.write("\n")
print([g["id"] for g in data["groups"]])
