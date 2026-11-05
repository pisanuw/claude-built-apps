// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { appsOnPage, appFromMarks, identifyApp } from '../src/engine/apps';
import { closeControls, fakeButtons, staticChecks } from '../src/engine/checks';
import { backgroundBehind, blend, contrastProblems, luminance, parseColor, ratio } from '../src/engine/contrast';
import { classify, findOverlays } from '../src/engine/detect';
import {
  allElements,
  browserEnv,
  deepActiveElement,
  deepContains,
  describe as describeEl,
  isFocusable,
  isHidden,
  isHiddenFromReaders,
  isNativeModal,
  isPanel,
  isTabbable,
  PANEL_HOST_ID,
  parentOf,
  shortText,
  tabbables,
} from '../src/engine/dom';
import { accessibleName, isSymbolOnlyName, textAlternative } from '../src/engine/name';
import type { Finding } from '../src/engine/types';
import { html, testEnv } from './helpers';

const BACKDROP = 'position:fixed;inset:0;background:rgba(0,0,0,.5)';
const find = (list: Finding[], check: string): Finding | undefined => list.find((f) => f.check === check);

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = 'Shop';
});

describe('dom helpers', () => {
  it('walks into open shadow roots and finds focus inside them', () => {
    html('<div id="host"></div><p>after</p>');
    const host = document.getElementById('host')!;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<button id="inner">Hi</button>';
    const inner = sr.getElementById('inner')!;
    expect(allElements(document.body).map((e) => e.id || e.tagName)).toEqual(['host', 'inner', 'P']);
    expect(parentOf(inner)).toBe(host);
    expect(parentOf(document.documentElement)).toBeNull();
    expect(deepContains(host, inner)).toBe(true);
    expect(deepContains(inner, host)).toBe(false);
    expect(deepContains(host, sr.firstChild!.firstChild)).toBe(true);
    inner.focus();
    expect(deepActiveElement(document)).toBe(inner);
  });

  it('tells hidden, inert and focusable elements apart', () => {
    html(`<div style="display:none"><button id="a">A</button></div>
      <div hidden><button id="b">B</button></div>
      <button id="c" disabled>C</button>
      <input id="d" type="hidden"><input id="e">
      <div inert><button id="f">F</button></div>
      <span id="g" tabindex="-1">G</span><span id="h" tabindex="2">H</span>
      <div aria-hidden="true"><span id="i">I</span></div>
      <p id="j" style="visibility:hidden">J</p><p id="k" style="opacity:0">K</p>
      <dialog id="dl"><button id="m">M</button></dialog><dialog id="dl2" open hidden>x</dialog>`);
    const $ = (id: string) => document.getElementById(id)!;
    expect(isHidden($('a'))).toBe(true);
    expect(isHidden($('b'))).toBe(true);
    expect(isHidden($('j'))).toBe(true);
    expect(isHidden($('k'))).toBe(true);
    expect(isHidden($('m'))).toBe(true);
    expect(isHidden($('dl2'))).toBe(true);
    expect(isFocusable($('c'))).toBe(false);
    expect(isFocusable($('d'))).toBe(false);
    expect(isFocusable($('e'))).toBe(true);
    expect(isFocusable($('f'))).toBe(false);
    expect(isFocusable($('g'))).toBe(true);
    expect(isTabbable($('g'))).toBe(false);
    expect(isHiddenFromReaders($('i'))).toBe(true);
    expect(isHiddenFromReaders($('f'))).toBe(true);
    expect(isHiddenFromReaders($('e'))).toBe(false);
    expect(isFocusable(document.createTextNode('x') as unknown as Element)).toBe(false);
    const order = tabbables(testEnv(), document.body).map((e) => e.id);
    expect(order).toEqual(['h', 'e']);
    expect(isNativeModal($('dl'))).toBe(false);
    expect(isNativeModal($('e'))).toBe(false);
  });

  it('describes elements and shortens text', () => {
    html('<p id="x">a</p><p class="  one two">b</p><p>c</p>');
    const ps = document.querySelectorAll('p');
    expect(describeEl(ps[0])).toBe('p#x');
    expect(describeEl(ps[1])).toBe('p.one');
    expect(describeEl(ps[2])).toBe('p');
    const long = document.createElement('p');
    long.textContent = 'word '.repeat(40);
    expect(shortText(long, 20)).toHaveLength(20);
    expect(shortText(long, 20).endsWith('…')).toBe(true);
  });

  it('recognises the panel through its shadow root and builds a browser env', async () => {
    html(`<div id="${PANEL_HOST_ID}"></div><p id="p">x</p>`);
    const host = document.getElementById(PANEL_HOST_ID)!;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<section><button>b</button></section>';
    expect(isPanel(sr.querySelector('button')!)).toBe(true);
    expect(isPanel(document.getElementById('p')!)).toBe(false);
    const env = browserEnv(document);
    expect(env.rect(document.getElementById('p')!)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(env.viewport().width).toBeGreaterThan(0);
    expect(env.ignore(sr.querySelector('button')!)).toBe(true);
    await env.wait(1);
  });
});

describe('accessible names', () => {
  it('follows labelledby, label, title, placeholder and content', () => {
    html(`<h2 id="t">Join <span aria-hidden="true">!</span>us</h2>
      <div id="d" role="dialog" aria-labelledby="t"><p>content</p></div>
      <label for="e1">Email address</label><input id="e1">
      <label>Phone <input id="e2"></label>
      <input id="e3" title="Zip"><input id="e4" placeholder="Email"><input id="e5">
      <input id="b1" type="submit"><input id="b2" type="button" value="Go"><input id="b3" type="reset"><input id="b6" type="button">
      <input id="img" type="image" alt="Send">
      <button id="b4"><img src="x.png" alt="Close"></button>
      <button id="b5"><svg><title>Shut</title></svg></button>
      <button id="b7" aria-label="  Dismiss  ">×</button>
      <a id="l1" href="#" title="Home"></a>
      <img id="i1" src="a.png"><img id="i2" src="a.png" alt="">
      <iframe id="f1" title="Chat"></iframe><iframe id="f2"></iframe>
      <select id="s1"></select><textarea id="t1" aria-label="Note"></textarea>
      <div id="blk"><div style="display:block">one</div><div style="display:block">two</div></div>`);
    const n = (id: string) => accessibleName(document.getElementById(id)!);
    expect(n('d')).toEqual({ name: 'Join us', source: 'aria-labelledby' });
    expect(n('e1')).toEqual({ name: 'Email address', source: 'label' });
    expect(n('e2').name).toBe('Phone');
    expect(n('e3')).toEqual({ name: 'Zip', source: 'title' });
    expect(n('e4')).toEqual({ name: 'Email', source: 'placeholder' });
    expect(n('e5')).toEqual({ name: '', source: 'none' });
    expect(n('b1').name).toBe('Submit');
    expect(n('b2')).toEqual({ name: 'Go', source: 'value' });
    expect(n('b3').name).toBe('Reset');
    expect(n('b6').source).toBe('none');
    expect(n('img')).toEqual({ name: 'Send', source: 'alt' });
    expect(n('b4').name).toBe('Close');
    expect(n('b5').name).toBe('Shut');
    expect(n('b7')).toEqual({ name: 'Dismiss', source: 'aria-label' });
    expect(n('l1')).toEqual({ name: 'Home', source: 'title' });
    expect(n('i1').source).toBe('none');
    expect(n('i2')).toEqual({ name: '', source: 'alt' });
    expect(n('f1').name).toBe('Chat');
    expect(n('f2').name).toBe('');
    expect(n('s1').source).toBe('none');
    expect(n('t1').name).toBe('Note');
    expect(textAlternative(document.getElementById('blk')!)).toBe('one two');
  });

  it('spots names that are only a symbol', () => {
    expect(isSymbolOnlyName('×')).toBe(true);
    expect(isSymbolOnlyName(' X ')).toBe(true);
    expect(isSymbolOnlyName('times')).toBe(true);
    expect(isSymbolOnlyName('Close')).toBe(false);
  });
});

describe('contrast', () => {
  it('parses colours', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#00000080')![3]).toBeCloseTo(0.5, 2);
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5]);
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 0.5]);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(parseColor('white')).toEqual([255, 255, 255, 1]);
    expect(parseColor('oklch(0.5 0.1 20)')).toBeNull();
  });

  it('computes ratios and blends', () => {
    expect(ratio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(luminance([255, 255, 255, 1])).toBeCloseTo(1, 5);
    expect(blend([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([128, 128, 128, 1]);
  });

  it('finds faint text, honours large text and skips pictures', () => {
    html(`<div id="r" style="background:#ffffff">
        <p style="color:#b5b5b5">faint</p>
        <p style="color:#767676;font-size:24px">large ok</p>
        <p style="color:#949494;font-size:19px;font-weight:700">bold large ok</p>
        <p style="color:rgba(0,0,0,0.2)">see-through</p>
        <p style="color:#000000">fine</p>
        <div style="background-image:url(x.png)"><span style="color:#fff">on picture</span></div>
        <div style="background-color:rgba(0,0,0,0.5)"><span style="color:#fff">on half black</span></div>
        <p style="display:none;color:#eee">hidden</p>
      </div>`);
    const r = contrastProblems(document.getElementById('r')!);
    expect(r.problems.map((p) => p.text)).toEqual(['faint', 'see-through', 'on half black']);
    expect(r.skipped).toBe(1);
    expect(r.checked).toBe(6);
    expect(r.problems[0].needed).toBe(4.5);
    expect(backgroundBehind(document.body)).toEqual([255, 255, 255, 1]);
  });
});

describe('apps', () => {
  it('recognises apps by their marks', () => {
    html('<div id="onetrust-banner-sdk"><p>We use cookies</p></div><div class="x"><span class="tidio-x"></span></div><script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>');
    expect(identifyApp(document.getElementById('onetrust-banner-sdk')!)?.name).toBe('OneTrust');
    expect(identifyApp(document.querySelector('.x')!)?.name).toBe('Tidio');
    expect(appFromMarks('nothing here')).toBeUndefined();
    expect(appsOnPage(document)).toEqual(['Klaviyo', 'OneTrust', 'Tidio']);
  });
});

describe('finding overlays', () => {
  it('classifies text', () => {
    expect(classify('Are you 21 or older?')).toBe('age');
    expect(classify('We use cookies')).toBe('cookie');
    expect(classify('Get 10% off your first order')).toBe('email');
    expect(classify('Chat with us')).toBe('chat');
    expect(classify('Hello')).toBeUndefined();
  });

  it('finds popups, banners, chat buttons and skips headers and hidden drawers', () => {
    html(`<header style="position:fixed;top:0px;left:0px;right:0px;height:60px"><nav><a href="/">Home</a></nav></header>
      <div id="bar" style="position:fixed;top:0px;left:0px;right:0px;height:40px">Free shipping over $50</div>
      <div id="drawer" style="position:fixed;left:1200px;top:0px;width:300px;height:800px">Your cart</div>
      <div id="hidden" style="position:fixed;inset:0;display:none">Subscribe</div>
      <div id="pop" style="${BACKDROP}"><div role="dialog" aria-modal="true" aria-label="Offer"><p>Get 10% off</p><button>Close</button></div></div>
      <div id="cookies" style="position:fixed;left:0px;right:0px;bottom:0px;height:100px"><p>We use cookies</p><button>OK</button></div>
      <button id="chat" style="position:fixed;right:20px;bottom:20px;width:56px;height:56px"></button>
      <div id="tiny" style="position:fixed;left:10px;top:300px;width:50px;height:50px">?</div>
      <div id="big" style="${BACKDROP}"><p>Hello</p></div>`);
    const overlays = findOverlays(testEnv());
    const byId = Object.fromEntries(overlays.map((o) => [o.root.id, o]));
    expect(Object.keys(byId).sort()).toEqual(['big', 'chat', 'cookies', 'pop']);
    expect(byId.pop.kind).toBe('email');
    expect(byId.pop.modal).toBe(true);
    expect(byId.pop.dialog?.getAttribute('role')).toBe('dialog');
    expect(byId.cookies.kind).toBe('cookie');
    expect(byId.cookies.modal).toBe(false);
    expect(byId.chat.kind).toBe('chat');
    expect(byId.chat.modal).toBe(false);
    expect(byId.big.kind).toBe('other');
    expect(byId.big.modal).toBe(true);
  });

  it('notes frames from other sites, known apps and native dialogs', () => {
    html(`<div id="w" class="tidio-chat" style="position:fixed;right:10px;bottom:10px;width:80px;height:80px"><iframe src="https://example.com/chat" title="Chat"></iframe></div>
      <dialog id="dg" open><p>Age verification: are you over 18?</p></dialog>`);
    const iframe = document.querySelector('iframe')!;
    Object.defineProperty(iframe, 'contentDocument', { get: () => null });
    const overlays = findOverlays(testEnv());
    const w = overlays.find((o) => o.root.id === 'w')!;
    expect(w.framed).toBe(true);
    expect(w.app?.name).toBe('Tidio');
    expect(w.kind).toBe('chat');
    const dg = overlays.find((o) => o.root.id === 'dg')!;
    expect(dg.kind).toBe('age');
    expect(dg.modal).toBe(true);
  });
});

describe('static checks', () => {
  it('flags a badly built popup', () => {
    html(`<a href="/">Home</a>
      <div id="pop" style="${BACKDROP}"><div class="box" style="background:#ffffff">
        <span class="x" style="cursor:pointer;width:12px;height:16px">×</span>
        <img src="https://cdn.example.com/banner.png?v=2"><img src="data:image/png;base64,AAAA">
        <div style="font-size:24px">Get 15% off</div>
        <input type="email" placeholder="Email"><input type="text">
        <div class="btn" style="cursor:pointer">Get my code</div>
        <a href="/x"><svg></svg></a>
        <p style="color:#b5b5b5">No spam.</p>
      </div></div>`);
    const env = testEnv();
    const [o] = findOverlays(env);
    const f = staticChecks(env, o);
    expect(find(f, 'dialog-role')?.status).toBe('fail');
    expect(find(f, 'dialog-name')?.status).toBe('na');
    expect(find(f, 'background')?.status).toBe('fail');
    expect(find(f, 'close-name')?.status).toBe('fail');
    expect(find(f, 'close-name')?.detail).toMatch(/cannot be reached/);
    expect(find(f, 'close-size')?.status).toBe('warn');
    expect(find(f, 'field-labels')?.status).toBe('fail');
    expect(find(f, 'button-names')?.status).toBe('fail');
    expect(find(f, 'image-alt')?.examples).toEqual(['banner.png', 'an embedded image']);
    expect(find(f, 'contrast')?.status).toBe('fail');
    expect(find(f, 'fake-buttons')?.examples).toHaveLength(2);
  });

  it('passes a well built popup and reports placeholder-only fields', () => {
    html(`<main aria-hidden="true"><a href="/">Home</a></main>
      <div id="pop" style="${BACKDROP}"><div role="dialog" style="background:#ffffff">
        <button aria-label="Close" style="width:32px;height:32px">×</button>
        <img src="a.png" alt="">
        <input placeholder="Email">
        <button style="width:120px;height:40px">Join</button>
      </div></div>`);
    const env = testEnv();
    const [o] = findOverlays(env);
    const f = staticChecks(env, o);
    expect(find(f, 'dialog-role')?.status).toBe('pass');
    expect(find(f, 'dialog-name')?.status).toBe('warn');
    expect(find(f, 'background')?.status).toBe('pass');
    expect(find(f, 'background')?.detail).toMatch(/hidden from screen readers/);
    expect(find(f, 'close-name')?.status).toBe('pass');
    expect(find(f, 'close-size')?.status).toBe('pass');
    expect(find(f, 'field-labels')?.status).toBe('warn');
    expect(find(f, 'button-names')?.status).toBe('pass');
    expect(find(f, 'image-alt')?.status).toBe('pass');
    expect(find(f, 'fake-buttons')?.status).toBe('pass');
  });

  it('handles age gates, missing close buttons, mixed close buttons and non-modal banners', () => {
    html(`<div id="age" style="${BACKDROP}"><div role="dialog" aria-modal="true" aria-label="Age"><p>Are you 21 or older?</p><button>Yes</button><button>No</button></div></div>`);
    let env = testEnv();
    let f = staticChecks(env, findOverlays(env)[0]);
    expect(find(f, 'close-name')?.status).toBe('na');
    expect(find(f, 'background')?.detail).toMatch(/aria-modal/);

    html(`<div style="${BACKDROP}"><div role="dialog" aria-modal="true"><p>Subscribe</p><label>Email <input></label></div></div>`);
    env = testEnv();
    f = staticChecks(env, findOverlays(env)[0]);
    expect(find(f, 'close-name')?.status).toBe('fail');
    expect(find(f, 'field-labels')?.status).toBe('pass');

    html(`<div style="${BACKDROP}"><div role="dialog" aria-modal="true"><p>Subscribe</p><button>×</button><button>No thanks</button></div></div>`);
    env = testEnv();
    f = staticChecks(env, findOverlays(env)[0]);
    expect(find(f, 'close-name')?.status).toBe('warn');
    expect(find(f, 'close-name')?.detail).toMatch(/Some close controls/);

    html(`<div style="${BACKDROP}"><div role="dialog" aria-modal="true"><p>Subscribe</p><span class="close" style="cursor:pointer">Close</span><button>No thanks</button></div></div>`);
    env = testEnv();
    f = staticChecks(env, findOverlays(env)[0]);
    expect(find(f, 'close-name')?.detail).toMatch(/A close control cannot be reached/);

    html('<div style="position:fixed;left:0px;right:0px;bottom:0px;height:90px"><p>We use cookies</p><span style="cursor:pointer">OK</span></div>');
    env = testEnv();
    f = staticChecks(env, findOverlays(env)[0]);
    expect(find(f, 'keyboard-reach')?.status).toBe('fail');
    expect(find(f, 'dialog-role')).toBeUndefined();
    expect(find(f, 'close-name')).toBeUndefined();
  });

  it('reports frames, small chat buttons and unmeasurable contrast', () => {
    html(`<div id="w" style="position:fixed;right:10px;bottom:10px;width:60px;height:60px"><iframe></iframe></div>
      <button id="c" style="position:fixed;right:200px;bottom:10px;width:20px;height:20px" aria-label="Chat"></button>
      <div id="p" style="${BACKDROP}"><div role="dialog" aria-modal="true" aria-label="Offer" style="background-image:url(x.png)"><p style="color:#fff">Subscribe now</p><button aria-label="Close">x</button></div></div>`);
    Object.defineProperty(document.querySelector('iframe')!, 'contentDocument', { get: () => null });
    const env = testEnv();
    const overlays = findOverlays(env);
    const w = overlays.find((o) => o.root.id === 'w')!;
    const fw = staticChecks(env, w);
    expect(find(fw, 'frame')?.status).toBe('fail');
    expect(find(fw, 'keyboard-reach')?.status).toBe('pass');
    const c = overlays.find((o) => o.root.id === 'c')!;
    expect(find(staticChecks(env, c), 'close-size')?.status).toBe('warn');
    const p = overlays.find((o) => o.root.id === 'p')!;
    const fp = staticChecks(env, p);
    expect(find(fp, 'contrast')?.status).toBe('manual');

    document.querySelector('iframe')!.setAttribute('title', 'Chat window');
    expect(find(staticChecks(env, w), 'frame')?.status).toBe('manual');
  });

  it('notes frames with no own controls as needing a hand check', () => {
    html('<div id="w" style="position:fixed;right:10px;bottom:10px;width:60px;height:60px"><iframe tabindex="-1" title="Chat"></iframe></div>');
    Object.defineProperty(document.querySelector('iframe')!, 'contentDocument', { get: () => null });
    const env = testEnv();
    const f = staticChecks(env, findOverlays(env)[0]);
    expect(find(f, 'keyboard-reach')?.detail).toMatch(/hand check/);
  });

  it('finds close controls and fake buttons only once each', () => {
    html('<div id="r"><div class="close" style="cursor:pointer"><span style="cursor:pointer"><em style="cursor:pointer">×</em></span></div><button><span style="cursor:pointer">Ok</span></button><div onclick="x()">Go</div><div role="button" tabindex="0">Fine</div></div>');
    const env = testEnv();
    const r = document.getElementById('r')!;
    expect(closeControls(env, r)).toHaveLength(1);
    expect(fakeButtons(env, r).map((e) => e.textContent)).toEqual(['×', 'Go']);
  });
});
