# Trilha de Inglês

PWA pessoal de exercícios de inglês por tema (B1 → C1), com repetição espaçada, histórico de evolução e funcionamento offline.

- Sem servidor, sem login, sem dependências: só arquivos estáticos.
- O progresso fica no aparelho (localStorage), com cópia de segurança automática da gravação anterior e exportação/importação de backup em Ajustes.
- Versão 1.4.0: 41 temas e 3.003 exercícios, mais 536 variantes 'Certo ou errado?'. Os temas t29–t41 (Aprofundamento I e II) cobrem as lacunas do mapa das 145 unidades do livro de referência (docs/mapa-livro.md); ficam abertos e não entram na régua de liberação dos lotes fechados.
- Domínio e teste do tema (v1.5): domínio = exercícios retidos (acertados em intervalos crescentes, caixa ≥ 3). Com 100% vistos, libera um teste de 20 questões (todos os padrões, níveis misturados, sem dicas nem correção durante a prova); aprovado com 80%, domínio com 90%; nova tentativa após 24 h.
- Critério de desempenho (v1.4.2): a mesma questão só volta a contar para nível, acerto, padrões fracos e liberação depois de 20 horas; repetir na hora é treino, não medida. Respostas com mais de 90 dias viram resumo diário (total e acertos), e o estado fica pequeno mesmo com anos de uso.
- Gravação: carimbo `savedAt`; na abertura vence a cópia gravada por último (localStorage ou espelho no IndexedDB).
- Publicação: o workflow só publica no Pages se os testes passarem (fonte do Pages = GitHub Actions).
- Plano diário: meta de respostas (30/50/75), revisão limitada à metade da meta e exercícios novos a cerca de um terço; vencimentos à meia-noite, erro volta no dia seguinte.
- Versão 1.3.0: 28 temas e 2.418 exercícios (Revisão de base A1–B1 e Lotes 1 a 5, até C1), mais 385 variantes 'Certo ou errado?' derivadas automaticamente. Cada exercício traz o tema e uma dica de uso no dia a dia.
- Proteção do histórico: localStorage + cópia anterior + espelho e cópias diárias em IndexedDB (restauráveis em Ajustes); zerar, importar e restaurar guardam uma cópia antes. `tests/ids.lock.json` impede que um id publicado mude de enunciado ou suma.
- Lotes 3, 4 e 5 vêm fechados (`"locked": true` em `data/topics.json`) e são liberados um por vez, em silêncio, conforme a evolução registrada. A regra fica em `UNLOCK_RULES` / `unlockCheck` (`js/core.js`); a interface nunca mostra critério nem progresso até a liberação.

## Estrutura

```
index.html            página única
css/styles.css        estilos (claro e escuro)
js/core.js            lógica pura: correção, repetição espaçada, sessões, estatísticas
js/storage.js         gravação local com cópia de segurança
js/app.js             interface
data/topics.json      temas e regras-chave
data/tNN.json         exercícios de cada tema (gerados)
tools/bank_*.py       fonte dos exercícios (último campo "@skill" = padrão)
tools/build_bank.py   gera data/tNN.json
tools/bank_extra_*.py exercícios acrescentados na v1.3 (fim de cada nível)
tools/uses.py         dicas 'No dia a dia' por padrão (aplicadas pelo build)
tools/lock_ids.py     trava os ids novos em tests/ids.lock.json
tools/meta_prof.py    metadados dos módulos de aprofundamento (aplicados por tools/apply_prof.py)
tools/bank_prof_*.py  exercícios dos módulos de aprofundamento
tools/apply_meta.py   aplica os metadados dos Lotes 3–5 (tools/meta_lotes345.py) em topics.json
sw.js                 service worker (offline e atualização)
tests/                testes automatizados
```

## Testes

```
npm test                 # banco de exercícios + lógica (node 18+)
python3 tests/e2e.py     # ponta a ponta em viewport de celular (requer playwright)
```

## Publicar uma nova versão

1. Editar ou adicionar exercícios em `tools/bank_*.py`, rodar `python3 tools/build_bank.py` e depois `python3 tools/lock_ids.py`.
2. Novos temas: incluir em `data/topics.json` e em `ASSETS` no `sw.js`.
3. Aumentar a versão em `js/core.js` (`APP_VERSION`) e em `sw.js` (`CACHE_VERSION`), com o mesmo valor.
4. Rodar os testes e enviar os arquivos ao repositório. O app mostra "Nova versão disponível" na próxima abertura.

Os ids dos exercícios (`t01-2-005`) ligam o histórico ao item: não renumere itens existentes; acrescente no fim de cada nível.

Fontes: Atkinson Hyperlegible e Bricolage Grotesque, licença SIL Open Font License 1.1.
