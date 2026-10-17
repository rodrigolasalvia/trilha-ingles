"""Teste ponta a ponta em viewport de celular. Uso: python3 tests/e2e.py (sobe um servidor local)."""
import json, os, re, subprocess, sys, time, glob
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get('SHOTS', os.path.join(ROOT, '..', 'shots'))
os.makedirs(SHOTS, exist_ok=True)
PORT = 8765
URL = f'http://localhost:{PORT}/'

items = []
for f in sorted(glob.glob(os.path.join(ROOT, 'data', '[rt][0-9]*.json'))):
    items += json.load(open(f, encoding='utf-8'))['items']
norm = lambda s: re.sub(r'\s+', ' ', s).strip()

def find_item(page):
    if page.locator('#gap-input').count():
        label = norm(page.locator('.gap-line').inner_text())
        cands = [i for i in items if i['type'] == 'gap' and norm(i['prompt'].replace('___', '')) == label]
    elif page.locator('#chips').count():
        chips = sorted(c.inner_text() for c in page.locator('.chip').all())
        cands = [i for i in items if i['type'] == 'order' and sorted(re.sub(r'[.!?]$', '', i['answer']).split()) == chips]
    elif page.locator('.q-wrong').count():
        txt = norm(page.locator('.q-wrong').inner_text().replace('Frase com erro', ''))
        cands = [i for i in items if i['type'] == 'fix' and norm(i['prompt']) == txt]
    else:
        txt = norm(page.locator('.q-text').inner_text()).replace('_____', '___')
        opts = sorted(o.inner_text() for o in page.locator('.option').all())
        cands = [i for i in items if i['type'] == 'mcq' and norm(i['prompt']) == txt and sorted(i['options']) == opts]
    assert cands, 'item não encontrado'
    return cands[0]

def answer(page, item, correct):
    if item['type'] in ('mcq', 'fix'):
        target = item['answer'] if correct else next(o for o in item['options'] if o != item['answer'])
        page.locator('.option', has_text=re.compile('^' + re.escape(target) + '$')).first.click()
    elif item['type'] == 'gap':
        page.fill('#gap-input', item['answer'][0] if correct else 'xxx')
    else:
        words = re.sub(r'[.!?]$', '', item['answer']).split()
        if not correct: words = words[1:] + words[:1]
        for w in words:
            page.locator('#chips .chip', has_text=re.compile('^' + re.escape(w) + '$')).first.click()
    page.click('#check')
    fb = page.locator('.fb-title').inner_text()
    assert ('Correto' in fb) == correct, f"{item['id']}: esperado {'acerto' if correct else 'erro'}, veio '{fb}'"
    # Reforço da regra aparece só quando erra
    assert (page.locator('.reforco').count() == 1) == (not correct), item['id']

def play_session(page, wrong_rule, shot_prefix=None):
    """Responde uma sessão inteira. wrong_rule(item, k) -> True para errar."""
    levels, seen = set(), []
    n = int(page.locator('.count').inner_text().split('/')[1])
    for k in range(n):
        it = find_item(page); levels.add(it['level']); seen.append(it)
        if k == 0:
            page.click('#hint-btn'); assert page.locator('#hint-box').is_visible(), 'dica não abriu'
            if shot_prefix: page.screenshot(path=f'{SHOTS}/{shot_prefix}-dica.png', full_page=True)
        wrong = wrong_rule(it, k)
        answer(page, it, not wrong)
        if shot_prefix and wrong and not os.path.exists(f'{SHOTS}/{shot_prefix}-erro.png'):
            page.screenshot(path=f'{SHOTS}/{shot_prefix}-erro.png', full_page=True)
        page.click('#check')
    page.wait_for_selector('.score')
    return levels, seen

def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=URL.rstrip('/'))
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: m.type == 'error' and errors.append(m.text))

            # Migração: progresso salvo pela v1.0 continua valendo
            page.goto(URL); page.wait_for_selector('.topic')
            v1 = {'version': 1, 'createdAt': 1, 'items': {'t01-1-006': {'box': 0, 'due': 0, 'seen': 1, 'correct': 0, 'wrong': 1, 'last': 1}},
                  'sessions': [{'id': 's1', 'ts': int(time.time() * 1000) - 3600_000, 'mode': 'topic', 'topic': 't01', 'level': 1,
                                'answers': [{'id': 't01-1-006', 'ok': False, 't': int(time.time() * 1000) - 3600_000, 'topic': 't01', 'level': 1}]}]}
            page.evaluate("s => localStorage.setItem('trilha-ingles:state', JSON.stringify(s))", v1)
            page.reload(); page.wait_for_selector('#review-btn')
            assert 'pendente' in page.locator('#review-btn').inner_text(), 'histórico da v1 não foi lido'

            # Regressão: a instalação do service worker não pode recarregar a página sozinha
            navs = []
            page.on('framenavigated', lambda f: f == page.main_frame and navs.append(f.url))
            page.click('a[href="#/topic/t03"]'); page.click('#practice'); page.wait_for_selector('.q')
            page.wait_for_timeout(2500)
            assert page.locator('.q').count() == 1, 'sessão perdida após instalar o service worker'
            page.click('#quit')

            # Início organizado por módulos, como nos mapas
            page.goto(URL); page.wait_for_selector('.topic')
            assert page.locator('.topic').count() == 10, page.locator('.topic').count()
            assert page.locator('.group').count() == 6 and page.locator('.group-soon').count() == 3
            assert page.locator('.tabbar a').count() == 4
            assert page.locator('.unlock-card').count() == 0
            body = page.locator('main').inner_text()
            for leak in ['faltam', 'critério', 'próximas versões', 'em breve', 'Em breve']:
                assert leak not in body, f'início revela meta: {leak}'
            # Tema de lote fechado não abre nem por link direto
            page.goto(URL + '#/topic/t08'); page.wait_for_selector('.topic')
            assert page.locator('#practice').count() == 0, 'tema fechado abriu'
            page.screenshot(path=f'{SHOTS}/01-inicio.png', full_page=True)

            # Tema: explicação, padrões e prática mista (sem escolha de nível)
            page.click('a[href="#/topic/t01"]'); page.wait_for_selector('#practice')
            assert page.locator('.level-btn').count() == 0, 'ainda há escolha de nível'
            assert len(page.locator('.lead').inner_text()) > 40
            page.locator('.skill summary').first.click()
            page.screenshot(path=f'{SHOTS}/02-tema.png', full_page=True)

            # Três sessões mistas em temas diferentes, errando sempre os mesmos padrões
            weak = {('t01', 'prep_ing'), ('t01', 'to_prep'), ('t06', 'makedo'), ('t06', 'saytell'), ('r02', 'pp'), ('r02', 'past')}
            rule = lambda it, k: (it['topic'], it['skill']) in weak
            all_levels = set()
            for i, topic in enumerate(['t01', 'r01', 'r02', 't06']):
                page.goto(URL + f'#/topic/{topic}'); page.wait_for_selector('#practice')
                page.click('#practice'); page.wait_for_selector('.q')
                lv, last_seen = play_session(page, rule, shot_prefix='03' if i == 0 else None)
                all_levels |= lv
                assert len(lv) >= 2, f'{topic}: sessão sem mistura de níveis {lv}'
                if i == 0: page.screenshot(path=f'{SHOTS}/04-resumo.png', full_page=True)
            assert all_levels == {1, 2, 3}

            # Resumo: "Treinar estes pontos" usa só os padrões errados
            if page.locator('#drill').count():
                wrong_skills = {(it['topic'], it['skill']) for it in last_seen if (it['topic'], it['skill']) in weak}
                page.click('#drill'); page.wait_for_selector('.q')
                n = int(page.locator('.count').inner_text().split('/')[1])
                for k in range(n):
                    it = find_item(page)
                    assert (it['topic'], it['skill']) in wrong_skills, f"{it['id']} fora dos padrões errados"
                    answer(page, it, False); page.click('#check')
                page.wait_for_selector('.score')

            # Treino de um padrão específico pela página do tema (errando tudo, para criar um ponto fraco claro)
            for topic, idx in [('t06', 0), ('t06', 1)]:
                page.goto(URL + f'#/topic/{topic}'); page.wait_for_selector('.skill')
                page.locator('.skill summary').nth(idx).click()
                page.locator('.skill').nth(idx).locator('[data-skill]').click(); page.wait_for_selector('.q')
                n = int(page.locator('.count').inner_text().split('/')[1])
                for k in range(n):
                    it = find_item(page)
                    assert it['topic'] == topic and it['skill'] == ['makedo', 'saytell'][idx], it['id']
                    answer(page, it, False); page.click('#check')
                page.wait_for_selector('.score')

            # Reforçar: padrões fracos e sessão focada
            page.goto(URL + '#/reinforce'); page.wait_for_selector('.page-head')
            assert page.locator('#reinforce').count() == 1
            nweak = page.locator('.skill.weak').count()
            print('padrões fracos exibidos:', nweak, page.locator('.weak-title').all_inner_texts())
            assert nweak >= 2
            assert 'MAKE × DO' in page.locator('.focus-card').inner_text()
            page.screenshot(path=f'{SHOTS}/05-reforcar.png', full_page=True)
            page.click('#reinforce'); page.wait_for_selector('.q')
            focus = 0
            n = int(page.locator('.count').inner_text().split('/')[1])
            for k in range(n):
                it = find_item(page)
                focus += (it['topic'], it['skill']) in weak
                answer(page, it, True); page.click('#check')
            page.wait_for_selector('.score')
            assert focus >= 7, f'reforço com só {focus}/{n} itens nos padrões fracos'

            # Relatório de erros copiado
            page.goto(URL + '#/reinforce'); page.wait_for_selector('#report')
            page.click('#report'); page.wait_for_timeout(300)
            clip = page.evaluate('navigator.clipboard.readText()')
            assert 'relatório de erros' in clip and 'correto:' in clip, clip[:200]

            # Evolução: ranking A1–C1
            page.goto(URL + '#/history'); page.wait_for_selector('.ladder')
            assert page.locator('.rung').count() == 5
            assert 'C1' in page.locator('.st-sem_conteudo').inner_text()
            page.screenshot(path=f'{SHOTS}/06-evolucao.png', full_page=True)
            assert 'próximas versões' not in page.locator('main').inner_text()

            # Lote liberado: aparece com aviso único, sem revelar critério
            page.evaluate("() => { const s = JSON.parse(localStorage.getItem('trilha-ingles:state')); s.unlocked = { lote3: Date.now() }; localStorage.setItem('trilha-ingles:state', JSON.stringify(s)); }")
            page.goto(URL); page.reload(); page.wait_for_selector('.unlock-card')
            assert page.locator('.topic').count() == 19, page.locator('.topic').count()
            assert page.locator('.group-soon').count() == 2
            assert 'novo lote liberado' in page.locator('.unlock-card').inner_text().lower()
            page.wait_for_timeout(600); page.screenshot(path=f'{SHOTS}/07-lote-liberado.png', full_page=False)
            page.click('[data-ack]'); page.wait_for_timeout(300)
            assert page.locator('.unlock-card').count() == 0
            page.reload(); page.wait_for_selector('.topic')
            assert page.locator('.unlock-card').count() == 0, 'aviso reapareceu'
            page.goto(URL + '#/topic/t09'); page.wait_for_selector('#practice')
            page.click('#practice'); page.wait_for_selector('.q')
            assert find_item(page)['topic'] == 't09'
            page.click('#quit')
            # volta ao estado anterior para o resto do teste
            page.evaluate("() => { const s = JSON.parse(localStorage.getItem('trilha-ingles:state')); s.unlocked = {}; s.announced = []; localStorage.setItem('trilha-ingles:state', JSON.stringify(s)); }")
            page.goto(URL); page.reload(); page.wait_for_selector('.topic')
            assert page.locator('.topic').count() == 10
            page.goto(URL + '#/history'); page.wait_for_selector('.ladder')

            # Persistência e backup
            total = int(page.locator('.stat-n').first.inner_text())
            assert total >= 50, total
            page.goto(URL + '#/settings'); page.wait_for_selector('#export')
            with page.expect_download() as dl:
                page.evaluate("navigator.canShare = undefined")
                page.click('#export')
            path = dl.value.path()
            page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_selector('#import-file', state='attached')
            page.once('dialog', lambda d: d.accept())
            page.set_input_files('#import-file', path)
            page.wait_for_timeout(500)
            page.goto(URL + '#/history'); page.wait_for_selector('.ladder')
            assert int(page.locator('.stat-n').first.inner_text()) == total, 'backup não restaurou'
            labels = page.locator('.sessions b').all_inner_texts()
            assert 'Reforço' in labels, labels

            # Estado corrompido não derruba o app
            page.evaluate("localStorage.setItem('trilha-ingles:state', '{corrompido')")
            page.reload(); page.wait_for_selector('.ladder')

            # Offline
            page.goto(URL); page.wait_for_selector('.topic'); page.wait_for_timeout(1500)
            page.reload(); page.wait_for_selector('.topic')
            ctx.set_offline(True)
            page.reload(); page.wait_for_selector('.topic', timeout=5000)
            page.click('a[href="#/topic/t07"]'); page.click('#practice'); page.wait_for_selector('.q')
            ctx.set_offline(False)

            # Modo escuro
            dark = b.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', device_scale_factor=2)
            dp = dark.new_page(); dp.goto(URL); dp.wait_for_selector('.topic')
            dp.screenshot(path=f'{SHOTS}/07-escuro.png', full_page=True)
            b.close()
    finally:
        srv.terminate()
    if errors:
        print('ERROS NO CONSOLE:', *errors, sep='\n  '); sys.exit(1)
    print('e2e ok')

if __name__ == '__main__':
    main()
