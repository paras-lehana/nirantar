#!/usr/bin/env python3
"""Sweep every route of the demo app: console errors, horizontal scroll, page errors. (QA helper)
Usage: python3 tools/appsweep.py [--base URL] [--scenarios]"""
import argparse, json
from playwright.sync_api import sync_playwright
ROUTES = ['', 'map', 'machine/VMC-204', 'triage', 'whatif/VMC-204', 'orders', 'copilot', 'oee', 'trust', 'spares', 'energy', 'brief', 'presenter', 'data', 'built', 'help', 'more', 'schedule', 'tech', 'reliability', 'compare', 'rules', 'roi', 'judges']
ap = argparse.ArgumentParser(); ap.add_argument('--base', default='http://127.0.0.1:8090/app/'); ap.add_argument('--scenarios', action='store_true'); a = ap.parse_args()
prefs = json.dumps({"welcomed": True, "playing": False, "speed": 1})
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h, schemes) in [(390, 844, ['light', 'dark']), (1440, 900, ['light', 'dark']), (820, 1180, ['light'])]:   # 820: tablet (top-bar overflow, 2026-10-06)
        for scheme in schemes:
            ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, reduced_motion='reduce')
            ctx.add_init_script(f"localStorage.setItem('nirantar-demo-v1:prefs', {json.dumps(prefs)});")
            pg = ctx.new_page(); errs = []
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
            pg.goto(a.base); pg.wait_for_timeout(1500)
            for r in ROUTES:
                errs.clear()
                pg.evaluate(f"location.hash = '#/{r}'"); pg.wait_for_timeout(900)
                sw = pg.evaluate('document.documentElement.scrollWidth')
                txt = pg.evaluate("document.querySelector('#main').innerText")
                flags = []
                if sw > w + 1: flags.append(f'hscroll {sw}')
                if errs: flags.append('errors ' + '; '.join(errs[:2]))
                if 'NaN' in txt or 'undefined' in txt: flags.append('NaN/undefined in text')
                if 'could not load' in txt or 'Something went wrong' in txt: flags.append('page failed')
                if flags: bad += 1; print(f'{w} {scheme} #/{r}: ' + ' | '.join(flags))
            ctx.close()
    if a.scenarios:
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}); ctx.add_init_script(f"localStorage.setItem('nirantar-demo-v1:prefs', {json.dumps(prefs)});")
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.goto(a.base); pg.wait_for_timeout(1200)
        for sc in ['pune-bearing', 'chennai-misalign', 'chittor-fan', 'pune-flood', 'quiet', None]:
            pg.evaluate("location.hash = '#/'"); pg.wait_for_timeout(500)
            if sc: pg.click(f'button[data-action="load-sample"][data-scenario="{sc}"] >> nth=0')
            else: pg.click('button[data-action="data-menu"]'); pg.wait_for_timeout(300); pg.click('button[data-action="clear-data"]')
            pg.wait_for_timeout(800)
            for r in ROUTES:
                errs.clear(); pg.evaluate(f"location.hash = '#/{r}'"); pg.wait_for_timeout(700)
                txt = pg.evaluate("document.querySelector('#main').innerText")
                flags = []
                if errs: flags.append('errors ' + '; '.join(errs[:2]))
                if 'NaN' in txt or 'undefined' in txt: flags.append('NaN/undefined')
                if 'could not load' in txt or 'Something went wrong' in txt: flags.append('page failed')
                if flags: bad += 1; print(f'scenario {sc} #/{r}: ' + ' | '.join(flags))
        ctx.close()
    b.close()
print('SWEEP', 'CLEAN' if not bad else f'{bad} problem(s)')
