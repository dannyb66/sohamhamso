import docx, re, json, sys, collections
SRC = sys.argv[1]; OUT = sys.argv[2]
DEV = re.compile(r'[ऀ-ॿ]')
DEVDIG = str.maketrans('०१२३४५६७८९', '0123456789')
def is_dev(t):
    return len(DEV.findall(t)) > len(re.findall(r'[A-Za-z]', t))
d = docx.Document(SRC)
chapters = []; cur_ch = None; cur_v = None; issues = []; stray = []
for idx, p in enumerate(d.paragraphs):
    t = p.text
    s = t.strip()
    m_ch = re.match(r'^Chapter\s+(\d+)$', s)
    if p.style.name == 'Heading 2' or m_ch:
        if not m_ch: issues.append(('chapter-heading-unparsed', idx, s)); continue
        cur_ch = {'num': int(m_ch.group(1)), 'verses': [], 'colophon': None, 'src_para': idx, 'heading_style': p.style.name}
        chapters.append(cur_ch); cur_v = None; continue
    m_v = re.match(r'^Verse\s+(\d+)$', s)
    if m_v:
        cur_v = {'label': int(m_v.group(1)), 'lines': [], 'src_para': idx, 'label_style': p.style.name}
        cur_ch['verses'].append(cur_v); continue
    if not s: continue
    if cur_v is None:
        stray.append((idx, s[:100])); continue
    cur_v['lines'].append({'text': t, 'src_para': idx})
# detach colophons
for ch in chapters:
    last = ch['verses'][-1]
    L = last['lines']
    dev_col = [i for i, l in enumerate(L) if l['text'].strip().startswith('इति श्री') and 'ध्याय' in l['text']]
    en_col = [i for i, l in enumerate(L) if l['text'].strip().startswith('Thus ends')]
    if dev_col and en_col:
        i0 = min(dev_col[0], en_col[0])
        ch['colophon'] = {'dev': L[dev_col[0]]['text'], 'en': L[en_col[0]]['text']}
        extra = [l['text'] for j, l in enumerate(L[i0:], i0) if j not in (dev_col[0], en_col[0])]
        if extra: issues.append(('colophon-extra-lines', ch['num'], extra))
        last['lines'] = L[:i0]
    else:
        issues.append(('no-colophon', ch['num'], None))
    # any colophon-looking line elsewhere
    for v in ch['verses']:
        for l in v['lines']:
            if l['text'].strip().startswith('Thus ends'):
                issues.append(('colophon-midchapter', ch['num'], v['label']))
json.dump({'chapters': chapters, 'issues': issues, 'stray': stray}, open(OUT, 'w'), ensure_ascii=False, indent=0)
print('chapters', [(c['num'], len(c['verses'])) for c in chapters])
print('stray', stray[:10]); print('issues', issues)
