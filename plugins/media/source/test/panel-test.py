# Opens the settings panel in headless Chromium against a pretend host, checks
# it shows only the options for each key type, and that changes are sent.
#   python test/panel-test.py      (needs: pip install playwright websockets)
import asyncio, json, pathlib, sys
import websockets
from playwright.async_api import async_playwright

PAGE = (pathlib.Path(__file__).resolve().parent.parent / 'plugin/com.clarkyau.nowplaying.sdPlugin/propertyInspector/index.html').as_uri()
OUT = pathlib.Path(__file__).resolve().parent / 'out'
failures = 0
def check(cond, msg):
    global failures
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: failures += 1

async def open_panel(action, settings, resolved, shot, steps):
    got = []
    async def handler(ws):
        async for m in ws:
            d = json.loads(m); got.append(d)
            if d['event'] == 'getSettings':
                await ws.send(json.dumps({'event': 'didReceiveSettings', 'payload': {'settings': settings}}))
                await ws.send(json.dumps({'event': 'sendToPropertyInspector', 'payload': {'type': 'state', 'resolved': resolved, 'groupSize': 2, 'stripSize': 2, 'sameKind': 4, 'globals': {'keyLayout': 'auto'}}}))
            if d['event'] == 'getGlobalSettings':
                await ws.send(json.dumps({'event': 'didReceiveGlobalSettings', 'payload': {'settings': {}}}))
    async with websockets.serve(handler, '127.0.0.1', 0) as srv:
        port = srv.sockets[0].getsockname()[1]
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={'width': 440, 'height': 640})
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(PAGE)
            info = json.dumps({'action': 'com.clarkyau.nowplaying.' + action, 'context': 'ctx', 'payload': {'settings': settings}})
            await pg.evaluate(f"connectElgatoStreamDeckSocket({port}, 'PIUUID', 'registerPropertyInspector', '{{}}', {json.dumps(info)})")
            await pg.wait_for_timeout(400)
            visible = await pg.evaluate("[...document.querySelectorAll('section')].filter(s=>!s.classList.contains('hidden')).map(s=>s.id)")
            await pg.screenshot(path=str(OUT / shot), full_page=True)
            await steps(pg, got, visible, errs)
            await b.close()

def visible_js():
    return "[...document.querySelectorAll('section')].filter(s=>!s.classList.contains('hidden')).map(s=>(s.querySelector('h3')||{}).textContent||s.dataset.for||'advanced')"

async def info_steps(pg, got, visible, errs):
    check(not errs, 'Track Info panel loads without errors')
    v = await pg.evaluate(visible_js())
    check('Button' not in v and 'Text' in v and 'This key' in v, f'Track Info panel shows only its options ({v})')
    hint = await pg.inner_text('#showHint')
    check('across 2 keys' in hint, f'panel says the key is part of a 2-key display ("{hint[:60]}...")')
    await pg.select_option('#show', 'title')
    await pg.click('.seg[data-key=size] button[data-v=large]')
    await pg.click('#applyAll')
    await pg.wait_for_timeout(300)
    saved = [d for d in got if d['event'] == 'setSettings']
    check(bool(saved) and saved[-1]['payload']['show'] == 'title' and saved[-1]['payload']['size'] == 'large', 'choices are saved on the key')
    check(any(d['event'] == 'sendToPlugin' and d['payload'].get('type') == 'applyAll' for d in got), '"Use on all keys" is sent to the plugin')

async def art_steps(pg, got, visible, errs):
    v = await pg.evaluate(visible_js())
    check(not errs and 'Text' not in v and 'Button' not in v and 'Pressing this key' in v, f'Album Art panel shows only join, pressing and same look ({v})')

async def time_steps(pg, got, visible, errs):
    v = await pg.evaluate(visible_js())
    check(not errs and await pg.is_hidden('.seg[data-key=size]') and 'Look' in v, f'Time panel shows time options, no text size ({v})')

async def button_steps(pg, got, visible, errs):
    v = await pg.evaluate(visible_js())
    check(not errs and v[0] == 'Button' and 'Text' not in v, f'button panel shows only button options ({v})')
    await pg.click('.seg[data-key=color] button[data-v=custom]')
    await pg.wait_for_timeout(200)
    check(await pg.is_visible('#customColor'), 'custom colour picker appears when chosen')
    await pg.screenshot(path=str(OUT / 'panel-button.png'), full_page=True)

async def main():
    info = {'v': 3, 'show': 'auto', 'join': True, 'size': 'medium', 'scroll': 'normal', 'titleColor': '#ffffff', 'artistColor': '#b4b4c0', 'background': 'tinted', 'press': 'playpause'}
    await open_panel('info', info, 'titleartist', 'panel-track-info.png', info_steps)
    await open_panel('art', {'v': 3, 'join': True, 'press': 'playpause'}, 'art', 'panel-album-art.png', art_steps)
    await open_panel('time', {'v': 3, 'time': 'remaining', 'titleColor': '#ffffff', 'background': 'tinted', 'press': 'playpause'}, 'time', 'panel-time.png', time_steps)
    await open_panel('playpause', {'v': 3, 'style': 'glow', 'color': 'art', 'customColor': '#7888ff'}, None, 'panel-button.png', button_steps)
    print('All panel checks passed' if not failures else f'{failures} panel check(s) FAILED')
    sys.exit(1 if failures else 0)

asyncio.run(main())
