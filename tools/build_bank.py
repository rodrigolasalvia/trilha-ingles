"""Gera data/<tema>.json a partir de tools/bank_*.py. Uso: python3 tools/build_bank.py

Cada item recebe:
- skill: o padrão gramatical (último elemento "@skill" do item ou classificação automática abaixo);
- cefr: nível CEFR do item, conforme topics.json (cefr por nível de dificuldade).
"""
import json, os, re, sys, importlib.util
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = ["bank_base.py", "bank_lote1.py", "bank_lote2.py"]

# Classificação automática dos itens antigos (Lote 1), pela explicação do item. Ordem importa.
def classify(topic, explain):
    e = explain
    if topic == "t01":
        rules = [
            ("to_prep", r"TO preposição|LOOK FORWARD|USED TO|OBJECT TO|WHEN IT COMES|COMMITTED"),
            ("purpose", r"Finalidade"),
            ("prep_ing", r"preposição|Depois de FOR"),
            ("subject", r"sujeito"),
            ("bare", r"\bMAKE\b|\bLET\b"),
            ("obj_to", r"pessoa \+ TO"),
            ("to_verbs", r"\+ TO|FIRST"),
            ("ing_verbs", r"-ING"),
        ]
        for skill, pat in rules:
            if re.search(pat, e):
                return skill
    if topic == "t02":
        for skill, pat in [("goon", r"GO ON"), ("stop", r"STOP"), ("remember", r"REMEMBER"), ("forget", r"FORGET"),
                           ("try", r"TRY"), ("regret", r"REGRET"), ("mean", r"MEAN"), ("need", r"NEED")]:
            if re.search(pat, e):
                return skill
    if topic == "t03":
        if re.search(r"HARD|LATELY|NEARLY|WELL", e): return "tricky"
        if re.search(r"-EE|-ER\b|Pessoa|-IST", e): return "person"
        if re.search(r"-ING descreve|-ED\b", e): return "adj"
        if re.search(r"MIS-", e): return "noun"
        return last_class(e, {"substantivo": "noun", "adjetivo": "adj", "advérbio": "adv", "verbo": "verb", "particípio": "verb"})
    if topic == "t04":
        if re.search(r"MIS-|\bRE- |UNDER-|OVER-|PRE-", e): return "meaning"
        if re.search(r"\b(IM|IL|IR|UN|IN|DIS|NON)-", e): return "neg"
        return last_class(e, {"substantivo": "noun_suf", "pessoa": "person_suf", "adjetivo": "adj_suf", "verbo": "verb_suf"})
    return None

def last_class(text, mapping):
    low = text.lower()
    best, pos = None, -1
    for word, skill in mapping.items():
        p = low.rfind(word)
        if p > pos:
            best, pos = skill, p
    return best

def load(name):
    spec = importlib.util.spec_from_file_location(name[:-3], os.path.join(ROOT, "tools", name))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.BANK

def to_item(topic, level, n, row, meta):
    row = list(row)
    skill = None
    if isinstance(row[-1], str) and row[-1].startswith("@"):
        skill = row.pop()[1:]
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
    skill = skill or classify(topic, base["explain"])
    valid = {s["id"] for s in meta["skills"]}
    if skill not in valid:
        raise ValueError(f"{base['id']}: padrão '{skill}' inexistente em {topic} ({base['explain']})")
    base["skill"] = skill
    base["cefr"] = meta["cefr"][level - 1]
    return base

def main():
    topics = json.load(open(os.path.join(ROOT, "data", "topics.json"), encoding="utf-8"))
    meta = {t["id"]: t for g in topics["groups"] for t in g["topics"]}
    total = 0
    for src in SOURCES:
        for topic, levels in load(src).items():
            items = []
            for level in sorted(levels):
                for n, row in enumerate(levels[level], 1):
                    items.append(to_item(topic, level, n, row, meta[topic]))
            with open(os.path.join(ROOT, "data", f"{topic}.json"), "w", encoding="utf-8") as f:
                json.dump({"topic": topic, "items": items}, f, ensure_ascii=False, indent=1)
            total += len(items)
            dist = Counter(i["skill"] for i in items)
            print(f"{topic}: {len(items)} itens · " + ", ".join(f"{k} {v}" for k, v in sorted(dist.items())))
    missing = [t for t in meta if not os.path.exists(os.path.join(ROOT, "data", f"{t}.json"))]
    if missing:
        raise SystemExit(f"temas sem banco: {missing}")
    print(f"total: {total}")

if __name__ == "__main__":
    sys.exit(main())
