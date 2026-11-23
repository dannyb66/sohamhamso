import json, re, sys, collections
data = json.load(open(sys.argv[1])); OUT = sys.argv[2]
DEV = re.compile(r'[ऀ-ॿ]')
DEVDIG = str.maketrans('०१२३४५६७८९', '0123456789')
def is_dev(t): return len(DEV.findall(t)) > len(re.findall(r'[A-Za-z]', t))
ENGLISH = set('the of and to in with by is a an from for that this as be his her their it on at or not who which what'.split())
import unicodedata
IAST = re.compile(r"^[A-Za-zāīūṛṝḷḹṅñṭḍṇśṣṁṃḥĀĪŪṚṜḶṄÑṬḌṆŚṢṀṂḤ\u0300-\u036f'’\-\(\)\s\.]+$")
changes = []; flags = []; errors = []
def log(kind, ch, v, before, after): changes.append({'kind': kind, 'ch': ch, 'v': v, 'before': before, 'after': after})
for ch in data['chapters']:
    c = ch['num']
    if c == 13 and ch['colophon']:
        b = ch['colophon']['en']; a = re.sub(r'(Tripura Rahasya\.)thout resistance\."\s*$', r'\1', b)
        if a != b: log('ch13-stray-text', c, None, b, a); ch['colophon']['en'] = a
    exp = 1
    for v in ch['verses']:
        n = v['label']
        if n != exp: errors.append(('verse-sequence', c, n, f'expected {exp}'))
        exp = n + 1
        raw = [l['text'] for l in v['lines']]
        lines = []
        for t in raw:
            if '\n' in t:
                parts = [x for x in t.split('\n') if x.strip()]
                log('split-linebreak', c, n, t, ' | '.join(parts)); lines.extend(parts)
            else: lines.append(t)
        dev = [t for t in lines if is_dev(t)]
        lat = [t for t in lines if not is_dev(t)]
        # translit merged in one line?
        if len(dev) == 2 and len(lat) == 3:
            m = re.match(r'^(.*?।)\s*(\S.*)$', lat[0])
            if m and '॥' in m.group(2):
                log('split-translit', c, n, lat[0], m.group(1) + ' | ' + m.group(2))
                lat = [m.group(1), m.group(2)] + lat[1:]
        if len(dev) == 2 and len(lat) == 3 and not any(re.search(r'\s[—–-]\s', x) for x in lat):
            flags.append(('missing-word-by-word', c, n, lat[2][:60]))
            v['roles'] = {'dev': dev, 'tr': lat[:2], 'wm_pairs': None, 'tl': lat[2]}; v['ok'] = True; continue
        if len(dev) != 2 or len(lat) != 4:
            errors.append(('role-count', c, n, f'dev={len(dev)} lat={len(lat)}', lines)); v['ok'] = False; continue
        # order check: dev lines should precede latin lines in source order
        if [is_dev(t) for t in lines] != [True, True, False, False, False, False] and not any(x['kind'].startswith('split') and x['v']==n and x['ch']==c for x in changes):
            flags.append(('role-order', c, n, [t[:40] for t in lines]))
        tr1, tr2, wm, tl = lat
        # verse number markers
        dn = re.findall(r'॥\s*([०-९]+)\s*॥', dev[1]); ln = re.findall(r'॥\s*(\d+)\s*॥', tr2)
        dnum = int(dn[-1].translate(DEVDIG)) if dn else None; lnum = int(ln[-1]) if ln else None
        if dnum != n or lnum != n: flags.append(('verse-marker', c, n, f'dev={dnum} translit={lnum}'))
        # word meaning normalization
        orig = wm
        w = wm.strip()
        w2 = re.sub(r'\s+[-–]\s+', ' — ', w)
        w2 = re.sub(r'\s*—\s*', ' — ', w2)
        if w2 != w: log('dash-normalize', c, n, w, w2)
        chunks = w2.split(' — ')
        if len(chunks) < 2:
            errors.append(('wm-no-dash', c, n, w2)); v['ok'] = False; continue
        terms = [chunks[0].strip()]; means = []
        bad = False
        for k in range(1, len(chunks)):
            seg = chunks[k]
            if k == len(chunks) - 1:
                means.append(seg.strip()); break
            cut = seg.rfind(', ')
            if cut < 0:
                cut2 = seg.rfind(',')
                if cut2 < 0: errors.append(('wm-no-comma', c, n, seg)); bad = True; break
                cut = cut2; means.append(seg[:cut].strip()); terms.append(seg[cut+1:].strip())
            else:
                means.append(seg[:cut].strip()); terms.append(seg[cut+2:].strip())
        if bad: v['ok'] = False; continue
        for t in terms:
            toks = [x for x in re.split(r"[\s\-]+", t.lower()) if x]
            if not IAST.match(unicodedata.normalize('NFC',t)) or len(t.split()) > 4 or (set(toks) & (ENGLISH - {'a'})):
                flags.append(('wm-term-suspicious', c, n, t))
        for mng in means[:-1]:
            tail = mng.split(', ')[-1] if ', ' in mng else None
            if tail and re.search(r'[āīūṛṅñṭḍṇśṣṁṃḥ]', tail) and not (set(tail.lower().split()) & ENGLISH):
                flags.append(('wm-meaning-tail-looks-sanskrit', c, n, mng))
        pairs = list(zip(terms, means))
        new_text = '; '.join(f'{a} — {b}' for a, b in pairs)
        if new_text != w2: log('wm-semicolons', c, n, w2, new_text)
        v['roles'] = {'dev': dev, 'tr': [tr1, tr2], 'wm_pairs': pairs, 'tl': tl}
        v['ok'] = True
json.dump(data, open(OUT, 'w'), ensure_ascii=False)
json.dump({'changes': changes, 'flags': flags, 'errors': errors}, open(OUT.replace('.json', '_report.json'), 'w'), ensure_ascii=False, indent=1)
cnt = collections.Counter(x['kind'] for x in changes); print('changes', dict(cnt))
print('errors', len(errors)); [print('  ', e) for e in errors[:30]]
fc = collections.Counter(f[0] for f in flags); print('flags', dict(fc))
for k in fc:
    ex = [f for f in flags if f[0] == k][:12]
    for e in ex: print('  ', e)
