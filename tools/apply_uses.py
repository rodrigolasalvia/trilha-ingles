"""Aplica tools/uses.py (campo 'use' de cada padrão) em data/topics.json. Idempotente.
Falha se algum padrão ficar sem dica de uso ou se houver dica para padrão inexistente."""
import json, os, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    spec = importlib.util.spec_from_file_location("uses", os.path.join(ROOT, "tools", "uses.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    path = os.path.join(ROOT, "data", "topics.json")
    data = json.load(open(path, encoding="utf-8"))
    errs = []
    known = set()
    for g in data["groups"]:
        for t in g["topics"]:
            for s in t["skills"]:
                known.add((t["id"], s["id"]))
                use = mod.USES.get(t["id"], {}).get(s["id"])
                if not use:
                    errs.append(f"sem dica de uso: {t['id']}:{s['id']}")
                else:
                    s["use"] = use
    extra = [f"{t}:{s}" for t, d in mod.USES.items() for s in d if (t, s) not in known]
    if errs or extra:
        raise SystemExit("\n".join(errs + [f"dica para padrão inexistente: {x}" for x in extra]))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2); f.write("\n")
    print(f"dicas de uso aplicadas: {len(known)}")

if __name__ == "__main__":
    main()
