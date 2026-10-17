"""Teste ponta a ponta em viewport de celular. Uso: python3 tests/e2e.py (sobe um servidor local)."""
import json, os, re, subprocess, sys, time, glob
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get('SHOTS', os.path.join(ROOT, '..', 'shots'))
os.makedirs(SHOTS, exist_ok=True)
PORT = 8765
URL = f'http://localhost:{PORT}/'

items = []
for f in sorted(glob.glob(os.path.join(ROOT, 'data', 't[0-9]*.json'))):
    items += json.load(open(f, encoding='utf-8'))['items']
norm = lambda s: re.sub(r'\s+', ' ', s).strip()

def find_item(page):
    t = page.locator('.q-type').inner_text().strip().lower()
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
        cands = [i for i in items if i['type'] == 'mcq' and norm(i['prompt']) == txt]
    assert cands, f'item não encontrado ({t})'
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

def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
            navs = []
            page.on('framenavigated', lambda f: f == page.main_frame and navs.append(f.url))
            page.goto(URL); page.wait_for_selector('.topic')
            # Regressão: a instalação do service worker não pode recarregar a página sozinha
            page.click('a[href="#/topic/t03"]'); page.click('[data-level="1"]'); page.wait_for_selector('.q')
            page.wait_for_timeout(2500)
            assert page.locator('.q').count() == 1, 'sessão perdida após instalar o service worker'
            assert len([u for u in navs if '#' not in u]) == 1, f'recarregou sozinho: {navs}'
            page.goto(URL); page.wait_for_selector('.topic')
            assert page.locator('.topic').count() == 4
            page.screenshot(path=f'{SHOTS}/01-inicio.png', full_page=True)

            # Tema e sessão: 7 acertos, 3 erros, cobrindo todos os tipos ao longo do nível misto
            page.click('a[href="#/topic/t01"]'); page.wait_for_selector('.level-btn')
            page.screenshot(path=f'{SHOTS}/02-tema.png', full_page=True)
            seen_types = set()
            for lv_sel in ['[data-level="1"]', '[data-level="2"]', '[data-level="3"]']:
                page.goto(URL + '#/topic/t01'); page.wait_for_selector(lv_sel)
                page.click(lv_sel); page.wait_for_selector('.q')
                for k in range(10):
                    it = find_item(page); seen_types.add(it['type'])
                    answer(page, it, correct=(k % 4 != 3))
                    if k == 1 and lv_sel.endswith('"2"]'): page.screenshot(path=f'{SHOTS}/03-feedback.png', full_page=True)
                    if it['type'] == 'order' and 'order' not in [s for s in os.listdir(SHOTS) if 'ordem' in s]:
                        page.screenshot(path=f'{SHOTS}/04-ordem.png', full_page=True)
                    page.click('#check')
                page.wait_for_selector('.score')
                assert page.locator('.score').inner_text().startswith('8') or page.locator('.score').inner_text().startswith('7'), page.locator('.score').inner_text()
            assert seen_types == {'mcq', 'fix', 'gap', 'order'}, seen_types
            page.screenshot(path=f'{SHOTS}/05-resumo.png', full_page=True)

            # Refazer erros
            page.click('#retry'); page.wait_for_selector('.q')
            n = int(page.locator('.count').inner_text().split('/')[1])
            assert n == 2 or n == 3, n
            page.click('#quit'); page.wait_for_selector('.level-btn')

            # Persistência após recarregar
            page.reload(); page.wait_for_selector('.level-btn')
            page.goto(URL + '#/history'); page.wait_for_selector('.chart')
            total = int(page.locator('.stat-n').first.inner_text())
            assert total >= 30, total
            page.screenshot(path=f'{SHOTS}/06-evolucao.png', full_page=True)

            # Revisão do dia: erros ficam pendentes
            page.goto(URL + '#/'); page.wait_for_selector('#review-btn')
            assert not page.locator('#review-btn').is_disabled()
            assert 'pendente' in page.locator('#review-btn').inner_text()

            # Backup: exportar e importar
            page.goto(URL + '#/settings'); page.wait_for_selector('#export')
            with page.expect_download() as dl:
                page.evaluate("navigator.canShare = undefined")
                page.click('#export')
            path = dl.value.path()
            data = json.load(open(path))
            assert data['app'] == 'trilha-ingles' and len(data['state']['sessions']) >= 3
            page.screenshot(path=f'{SHOTS}/07-ajustes.png', full_page=True)
            page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_selector('#import-file', state='attached')
            page.once('dialog', lambda d: d.accept())
            page.set_input_files('#import-file', path)
            page.wait_for_timeout(500)
            page.goto(URL + '#/history'); page.wait_for_selector('.chart')
            assert int(page.locator('.stat-n').first.inner_text()) == total, 'backup não restaurou'

            # Estado corrompido não derruba o app
            page.evaluate("localStorage.setItem('trilha-ingles:state', '{corrompido')")
            page.reload(); page.wait_for_selector('.stats')

            # Offline: service worker serve o app sem rede
            page.goto(URL); page.wait_for_selector('.topic')
            page.evaluate("navigator.serviceWorker.ready.then(()=>true)")
            page.wait_for_timeout(1500)
            page.reload(); page.wait_for_selector('.topic')
            ctx.set_offline(True)
            page.reload(); page.wait_for_selector('.topic', timeout=5000)
            page.click('a[href="#/topic/t02"]'); page.click('[data-level="1"]'); page.wait_for_selector('.q')
            ctx.set_offline(False)

            # Modo escuro
            dark = b.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', device_scale_factor=2)
            dp = dark.new_page(); dp.goto(URL); dp.wait_for_selector('.topic')
            dp.screenshot(path=f'{SHOTS}/08-escuro.png', full_page=True)
            b.close()
    finally:
        srv.terminate()
    if errors:
        print('ERROS NO CONSOLE:', *errors, sep='\n  '); sys.exit(1)
    print('e2e ok')

if __name__ == '__main__':
    main()
