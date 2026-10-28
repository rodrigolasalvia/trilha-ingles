"""Gera data/<tema>.json a partir de tools/bank_*.py. Uso: python3 tools/build_bank.py

Cada item recebe:
- skill: o padrão gramatical (último elemento "@skill" do item ou classificação automática abaixo);
- cefr: nível CEFR do item, conforme topics.json (cefr por nível de dificuldade).
"""
import json, os, re, sys, importlib.util
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = ["bank_base.py", "bank_lote1.py", "bank_lote2.py", "bank_lote3.py", "bank_lote4.py", "bank_lote5.py",
           "bank_extra_a.py", "bank_extra_b.py", "bank_extra_c.py"]

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

# Temas de registro/tom: a frase "errada" costuma ser gramatical, só inadequada. Não viram Certo/Errado.
NO_JUDGE_TOPICS = {"t24", "t26"}
# Frases "erradas" que são gramaticais fora do contexto do exercício original.
NO_JUDGE = {"t05-2-018", "t06-2-010", "t08-3-014", "t11-2-005", "t14-2-013", "t15-2-015", "t17-2-003", "t17-2-007",
            "t18-2-007", "t18-2-010", "t19-2-001", "t19-2-006", "t20-2-003", "t21-2-011", "t22-2-007", "t23-2-015",
            "t17-2-018", "t18-2-019", "t19-2-018", "t22-2-022", "t27-2-018",
            "t11-2-018", "t08-2-022", "t02-2-022", "t15-2-016", "t21-2-018", "t09-2-022"}
JUDGE_PROMPT = re.compile(r"\bcorret[oa]\b", re.I)

def derive_judges(items):
    """Variantes 'Certo ou errado?' derivadas de itens cuja correção é inequívoca:
    - fix: a frase com erro (errada) ou a versão correta, alternando;
    - mcq "Qual está correto?" com frases completas: a correta ou a primeira opção errada, alternando.
    Id = id de origem + 'v' (estável; o histórico se mantém mesmo com itens novos)."""
    out = []
    for it in items:
        if it["topic"] in NO_JUDGE_TOPICS or it["id"] in NO_JUDGE:
            continue
        if it["type"] == "fix":
            right = it["answer"]; wrong = it["prompt"]
        elif it["type"] == "mcq" and "___" not in it["prompt"] and JUDGE_PROMPT.search(it["prompt"]) \
                and all(len(o.split()) >= 3 for o in it["options"]):
            right = it["answer"]; wrong = next(o for o in it["options"] if o != it["answer"])
        else:
            continue
        n = int(it["id"].rsplit("-", 1)[1])
        show_right = n % 2 == 1
        # contexto entre parênteses no fim da frase errada (ex.: "(= atualmente)") vale para os dois lados
        m = re.search(r"\s*(\([^()]*\))\s*$", wrong)
        ctx = m.group(1) if it["type"] == "fix" and m else ""
        if ctx:
            wrong = wrong[:m.start()]
        sentence = (right if show_right else wrong) + (f" {ctx}" if ctx else "")
        explain = f"Certo. {it['explain']}" if show_right else f"Errado. Forma correta: {right} {it['explain']}"
        out.append({**{k2: it[k2] for k2 in ("topic", "level", "skill", "cefr")},
                    "id": it["id"] + "v", "type": "mcq", "variant": "judge",
                    "prompt": sentence, "options": ["Certo", "Errado"],
                    "answer": "Certo" if show_right else "Errado", "explain": explain})
    return out

def main():
    spec = importlib.util.spec_from_file_location("apply_uses", os.path.join(ROOT, "tools", "apply_uses.py"))
    au = importlib.util.module_from_spec(spec); spec.loader.exec_module(au); au.main()
    topics = json.load(open(os.path.join(ROOT, "data", "topics.json"), encoding="utf-8"))
    meta = {t["id"]: t for g in topics["groups"] for t in g["topics"]}
    rows = {}
    for src in SOURCES:
        for topic, levels in load(src).items():
            for level, lst in levels.items():
                rows.setdefault(topic, {}).setdefault(level, []).extend(lst)
    total = nvar = 0
    dups = []
    for topic, levels in rows.items():
        items = []
        for level in sorted(levels):
            for n, row in enumerate(levels[level], 1):
                items.append(to_item(topic, level, n, row, meta[topic]))
        seen = {}
        for it in items:
            key = (it["type"], it["answer"] if it["type"] == "order" else it["prompt"], tuple(it.get("options", [])))
            if key in seen:
                dups.append(f"duplicado: {it['id']} repete {seen[key]}")
            seen.setdefault(key, it["id"])
        judges = derive_judges(items)
        with open(os.path.join(ROOT, "data", f"{topic}.json"), "w", encoding="utf-8") as f:
            json.dump({"topic": topic, "items": items + judges}, f, ensure_ascii=False, indent=1)
        total += len(items); nvar += len(judges)
        dist = Counter(i["skill"] for i in items)
        print(f"{topic}: {len(items)} itens + {len(judges)} variantes · " + ", ".join(f"{k} {v}" for k, v in sorted(dist.items())))
    if dups:
        raise SystemExit("\n".join(dups))
    missing = [t for t in meta if not os.path.exists(os.path.join(ROOT, "data", f"{t}.json"))]
    if missing:
        raise SystemExit(f"temas sem banco: {missing}")
    print(f"total: {total} itens + {nvar} variantes 'Certo ou errado?'")

if __name__ == "__main__":
    sys.exit(main())
