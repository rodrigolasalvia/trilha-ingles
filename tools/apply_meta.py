"""Aplica os metadados dos Lotes 3, 4 e 5 (tools/meta_lotes345.py) em data/topics.json.
Idempotente. Os grupos ficam com "locked": true: o app só os mostra depois da liberação."""
import json, os, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("meta", os.path.join(ROOT, "tools", "meta_lotes345.py"))
meta = importlib.util.module_from_spec(spec); spec.loader.exec_module(meta)

path = os.path.join(ROOT, "data", "topics.json")
data = json.load(open(path, encoding="utf-8"))
for g in data["groups"]:
    src = {"lote3": meta.LOTE3, "lote4": meta.LOTE4, "lote5": meta.LOTE5}.get(g["id"])
    if src is None:
        continue
    g["topics"] = src
    g["locked"] = True
    g.pop("soon", None)
data["version"] = 3
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("ok:", [(g["id"], len(g["topics"]), g.get("locked", False)) for g in data["groups"]])
