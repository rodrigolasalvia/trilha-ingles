# Trilha de Inglês

PWA pessoal de exercícios de inglês por tema (B1 → C1), com repetição espaçada, histórico de evolução e funcionamento offline.

- Sem servidor, sem login, sem dependências: só arquivos estáticos.
- O progresso fica no aparelho (localStorage), com cópia de segurança automática da gravação anterior e exportação/importação de backup em Ajustes.
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
