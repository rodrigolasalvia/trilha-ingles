"""Gera data/<tema>.json a partir de tools/bank_*.py. Uso: python3 tools/build_bank.py"""
import json, os, sys, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = ["bank_lote1.py"]

def load(name):
    spec = importlib.util.spec_from_file_location(name[:-3], os.path.join(ROOT, "tools", name))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.BANK

def to_item(topic, level, n, row):
    kind = row[0]
    base = {"id": f"{topic}-{level}-{n:03d}", "topic": topic, "level": level, "type": kind}
    if kind in ("mcq", "fix"):
        _, prompt, options, answer, explain = row
        base.update(prompt=prompt, options=options, answer=answer, explain=explain)
    elif kind == "gap":
        _, prompt, answers, explain = row
        base.update(prompt=prompt, answer=answers, explain=explain)
    elif kind == "order":
        _, sentence, explain = row
        base.update(prompt="Ordene as palavras para formar a frase correta.", answer=sentence, explain=explain)
    else:
        raise ValueError(f"tipo desconhecido: {kind}")
    return base

def main():
    total = 0
    for src in SOURCES:
        for topic, levels in load(src).items():
            items = []
            for level in sorted(levels):
                for n, row in enumerate(levels[level], 1):
                    items.append(to_item(topic, level, n, row))
            path = os.path.join(ROOT, "data", f"{topic}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"topic": topic, "items": items}, f, ensure_ascii=False, indent=1)
            total += len(items)
            print(f"{topic}: {len(items)} itens")
    print(f"total: {total}")

if __name__ == "__main__":
    sys.exit(main())
