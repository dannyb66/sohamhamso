import sys, json, re, copy, zipfile, shutil, os
import docx
from docx.oxml.ns import qn
from lxml import etree

TEMPLATE, DATA, OUTDOCX, PARTLABEL, CHFROM, CHTO, LOGOUT = sys.argv[1:8]
PAGEMAP = json.load(open(sys.argv[8])) if len(sys.argv) > 8 else {}
CHFROM, CHTO = int(CHFROM), int(CHTO)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def w(tag): return '{%s}%s' % (W, tag)
TITLES = {12:'OBSERVING THE WORLD OF GANDHASHAILA',13:'OBSERVING THE WORLD OF SHAILALOKA',14:'THE STORY OF SHAILALOKA',
 15:'ASHTAVAKRA I',16:'ASHTAVAKRA II',17:'ASHTAVAKRA III',18:'KNOWLEDGE SECTION',
 19:'DISCUSSION ON THE DISTINCTION OF STATES OF KNOWLEDGE',20:'THE CONCLUSION OF THE SONGS OF KNOWLEDGE',
 21:'THE STORY OF THE DEMON',22:'THE COMPILATION OF ADVENTURES'}
data = json.load(open(DATA))
chapters = [c for c in data['chapters'] if CHFROM <= c['num'] <= CHTO]
log = []

doc = docx.Document(TEMPLATE)
body = doc.element.body
els = list(body)
P = {k: copy.deepcopy(els[i]) for k, i in dict(heading=31, after_heading=32, label=33, dev=34, tr=36, wm=38, tl=39,
     spacer=40, col_gap=710, col_dev=711, col_gap2=712, col_en=713, toc_sdt=29).items()}
for k in P:
    for sp in P[k].iter(w('sectPr')): sp.getparent().remove(sp)
chapter_sect = copy.deepcopy(els[713].find('.//' + w('sectPr')))

def set_text_runs(p, text):
    """Keep first text run's rPr, replace all runs with one run containing text."""
    runs = p.findall(w('r'))
    proto = next((r for r in runs if r.find(w('t')) is not None), None)
    rpr = copy.deepcopy(proto.find(w('rPr'))) if proto is not None and proto.find(w('rPr')) is not None else None
    for r in p.findall(w('r')): p.remove(r)
    for h in p.findall(w('hyperlink')): p.remove(h)
    r = etree.SubElement(p, w('r'))
    if rpr is not None: r.append(rpr)
    t = etree.SubElement(r, w('t')); t.text = text; t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    return r

def rpr(bold=False, italic=False, dev=False):
    rp = etree.Element(w('rPr'))
    f = etree.SubElement(rp, w('rFonts'))
    for a in ('ascii', 'hAnsi', 'eastAsia'): f.set(w(a), 'Calibri')
    f.set(w('cs'), 'Mangal')
    if bold: etree.SubElement(rp, w('b')).set(w('val'), '1'); etree.SubElement(rp, w('bCs')).set(w('val'), '1')
    if italic: etree.SubElement(rp, w('i')).set(w('val'), '1'); etree.SubElement(rp, w('iCs')).set(w('val'), '1')
    if dev:
        l = etree.SubElement(rp, w('lang')); l.set(w('val'), 'en-US'); l.set(w('bidi'), 'hi-IN')
    return rp

def para(proto, segments):
    p = copy.deepcopy(proto)
    for r in p.findall(w('r')): p.remove(r)
    for (text, b, i, d) in segments:
        r = etree.SubElement(p, w('r')); r.append(rpr(b, i, d))
        t = etree.SubElement(r, w('t')); t.text = text; t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    return p

def empty(proto): 
    p = copy.deepcopy(proto)
    for r in p.findall(w('r')): p.remove(r)
    return p

def clean(t, kind, ch, v):
    s = t.strip()
    if kind == 'tr':
        s2 = re.sub(r'\s*॥\s*(\d+)\s*॥', r' ॥ \1 ॥', s)
        s2 = re.sub(r'(\S)।', r'\1 ।', s2) if s2 != s else s2
        if s2 != s: log.append(('translit-danda-spacing', ch, v, s, s2)); s = s2
    return s

# ---------- front matter ----------
new = []
fm = [copy.deepcopy(e) for e in els[0:31]]
# title page
set_text_runs(fm[1], f'(PART {PARTLABEL})')
# copyright year
for r in fm[12].findall(w('r')):
    t = r.find(w('t'))
    if t is not None and 'SOHAM' in (t.text or ''): t.text = '2026 SOHAM HAMSO'
# dedication text (printed wording)
ded = ['DEDICATED TO', 'THE ONE UNIVERSAL CONSCIOUSNESS SHINING EVERYWHERE', 'WHO OUT OF HER OWN MERCY TAKES VARIOUS FORMS AS',
       'MY MOTHER, FATHER, GURU, EVERYONE, AND MYSELF', 'TO MAKE THIS WORK POSSIBLE']
for k, txt in zip(range(20, 25), ded): set_text_runs(fm[k], txt)

# TOC (rebuilt with cached entries; page numbers filled later by placeholder)
sdt = fm[29]
content = sdt.find(w('sdtContent'))
toc_proto = copy.deepcopy(content.findall(w('p'))[0])
for p in content.findall(w('p')): content.remove(p)
bm_id = 100
toc_paras = []
for n, ch in enumerate(chapters):
    p = etree.Element(w('p'))
    ppr = etree.SubElement(p, w('pPr')); etree.SubElement(ppr, w('pStyle')).set(w('val'), 'TOC1')
    if n == 0:
        r = etree.SubElement(p, w('r')); etree.SubElement(r, w('fldChar')).set(w('fldCharType'), 'begin')
        r = etree.SubElement(p, w('r')); it = etree.SubElement(r, w('instrText')); it.text = ' TOC \\o "1-1" \\h \\z \\u '
        it.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        r = etree.SubElement(p, w('r')); etree.SubElement(r, w('fldChar')).set(w('fldCharType'), 'separate')
    h = etree.SubElement(p, w('hyperlink')); h.set(w('anchor'), f'_TocCh{ch["num"]}'); h.set(w('history'), '1')
    r = etree.SubElement(h, w('r')); r.append(rpr())
    t = etree.SubElement(r, w('t')); t.text = f'{ch["num"]}. {TITLES[ch["num"]]}'; t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    etree.SubElement(r, w('tab'))
    t2 = etree.SubElement(r, w('t')); t2.text = str(PAGEMAP.get(str(ch['num']), '0'))
    if n == len(chapters) - 1:
        r = etree.SubElement(p, w('r')); etree.SubElement(r, w('fldChar')).set(w('fldCharType'), 'end')
    content.append(p)

# section properties
def fix_sect(sp, typ, keep_refs=False, pgstart=None, titlepg=True):
    for c in list(sp):
        if c.tag in (w('headerReference'), w('footerReference'), w('type'), w('pgNumType'), w('pgMar'), w('pgSz'), w('titlePg')): sp.remove(c)
    t = etree.Element(w('type')); t.set(w('val'), typ)
    sz = etree.Element(w('pgSz')); sz.set(w('w'), '8640'); sz.set(w('h'), '12960'); sz.set(w('orient'), 'portrait')
    mg = etree.Element(w('pgMar'))
    for k, v in dict(top='1094', right='864', bottom='1094', left='1094', header='504', footer='504', gutter='204').items(): mg.set(w(k), v)
    order = [t, sz, mg]
    if pgstart: pn = etree.Element(w('pgNumType')); pn.set(w('start'), str(pgstart)); order.append(pn)
    if titlepg: tp = etree.Element(w('titlePg')); tp.set(w('val'), '1'); order.append(tp)
    for e in order: sp.append(e)
    return sp
for idx, typ in [(11, 'nextPage'), (17, 'nextPage'), (26, 'nextPage'), (30, 'oddPage')]:
    fix_sect(fm[idx].find('.//' + w('sectPr')), typ)
new.extend(fm)

# ---------- chapters ----------
chapter_sects = []
for ci, ch in enumerate(chapters):
    c = ch['num']
    hp = copy.deepcopy(P['heading'])
    for b in hp.findall(w('bookmarkStart')) + hp.findall(w('bookmarkEnd')): hp.remove(b)
    for r in hp.findall(w('r')): hp.remove(r)
    bs = etree.SubElement(hp, w('bookmarkStart')); bs.set(w('id'), str(bm_id)); bs.set(w('name'), f'_TocCh{c}')
    r = etree.SubElement(hp, w('r')); r.append(rpr())
    t = etree.SubElement(r, w('t')); t.text = f'{c}. {TITLES[c]}'
    be = etree.SubElement(hp, w('bookmarkEnd')); be.set(w('id'), str(bm_id)); bm_id += 1
    new.append(hp); new.append(empty(P['after_heading']))
    for vi, v in enumerate(ch['verses']):
        R = v['roles']; n = v['label']
        new.append(para(P['label'], [(f'Verse {n}', True, False, False)]))
        for d in R['dev']: new.append(para(P['dev'], [(d.strip(), True, False, True)]))
        for t_ in R['tr']: new.append(para(P['tr'], [(clean(t_, 'tr', c, n), False, True, False)]))
        if R['wm_pairs']:
            pairs = [list(x) for x in R['wm_pairs']]
            last = pairs[-1][1]
            if last.endswith('.') and not last.endswith('etc.'):
                pairs[-1][1] = last[:-1]; log.append(('wm-trailing-period', c, n, last, pairs[-1][1]))
            segs = []
            for k, (term, mean) in enumerate(pairs):
                segs.append((term.strip(), False, True, False))
                segs.append((' — ' + mean.strip() + ('; ' if k < len(pairs) - 1 else ''), False, False, False))
            new.append(para(P['wm'], segs))
        new.append(para(P['tl'], [(R['tl'].strip(), True, False, False)]))
        if vi < len(ch['verses']) - 1: new.append(empty(P['spacer']))
    col = ch['colophon']
    new.append(empty(P['col_gap']))
    new.append(para(P['col_dev'], [(col['dev'].strip(), True, False, True)]))
    new.append(empty(P['col_gap2']))
    last_p = para(P['col_en'], [(col['en'].strip(), True, False, False)])
    sp = copy.deepcopy(chapter_sect)
    fix_sect(sp, 'oddPage', pgstart=1 if ci == 0 else None)
    if ci < len(chapters) - 1:
        last_p.find(w('pPr')).append(sp)
        new.append(last_p)
    else:
        new.append(last_p); final_sect = sp
    chapter_sects.append(sp)

# replace body
for e in list(body): body.remove(e)
for e in new: body.append(e)
body.append(final_sect)

# headers / footers: create parts
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
part = doc.part
def hf_xml(kind, text=None, page=False):
    root = 'hdr' if kind == 'header' else 'ftr'
    sz = '18' if kind == 'header' else '22'
    inner = ''
    if text: inner = f'<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Mangal"/><w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
    if page: inner = (f'<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Mangal"/><w:sz w:val="{sz}"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>'
                      f'<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Mangal"/><w:sz w:val="{sz}"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
                      f'<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Mangal"/><w:sz w:val="{sz}"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>'
                      f'<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Mangal"/><w:sz w:val="{sz}"/></w:rPr><w:t>1</w:t></w:r>'
                      f'<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Mangal"/><w:sz w:val="{sz}"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>')
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:{root} xmlns:w="{W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>{inner}</w:p></w:{root}>').encode()
CT = {'header': 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      'footer': 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'}
specs = [('header', 'default', dict(text='SOHAM HAMSO')), ('header', 'even', dict(text='TRIPURA RAHASYA')), ('header', 'first', {}),
         ('footer', 'default', dict(page=True)), ('footer', 'even', dict(page=True)), ('footer', 'first', {})]
pn = 90
for sp in chapter_sects:
    refs = []
    for (kind, typ, kw) in specs:
        pt = Part(PackURI(f'/word/{kind}{pn}.xml'), CT[kind], hf_xml(kind, **kw), part.package); pn += 1
        rid = part.relate_to(pt, RT.HEADER if kind == 'header' else RT.FOOTER)
        el = etree.Element(w(f'{kind}Reference')); el.set(w('type'), typ); el.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id', rid)
        refs.append(el)
    for el in reversed(refs): sp.insert(0, el)
# drop old header/footer relationships no longer referenced
used = set(x.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id') for x in doc.element.iter() if x.tag in (w('headerReference'), w('footerReference')))
for rid, rel in list(part.rels.items()):
    if rel.reltype in (RT.HEADER, RT.FOOTER) and rid not in used: del part.rels[rid]
doc.save(OUTDOCX)

# ---------- post-process XML parts: fonts, settings ----------
tmp = OUTDOCX + '.tmp'
zin = zipfile.ZipFile(OUTDOCX); zout = zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    b = zin.read(item.filename)
    if item.filename.endswith('.xml') and item.filename.startswith('word/'):
        s = b.decode('utf8')
        for att in ('ascii', 'hAnsi', 'eastAsia'):
            s = re.sub(rf'w:{att}="(Gaspar|Gandhi Serif|Arial|Times New Roman)"', f'w:{att}="Calibri"', s)
        s = re.sub(r'w:cs="[^"]*"', 'w:cs="Mangal"', s)
        s = re.sub(r' w14:(paraId|textId)="[^"]*"', '', s)
        if item.filename == 'word/styles.xml':
            s = re.sub(r'(<w:style [^>]*w:styleId="TOC1">.*?)<w:tab w:val="right" w:leader="dot" w:pos="\d+"/>(.*?)<w:jc w:val="center"/>',
                       r'\1<w:tab w:val="right" w:leader="dot" w:pos="6470"/>\2<w:jc w:val="left"/>', s, count=1, flags=re.S)
        if item.filename == 'word/settings.xml':
            if 'mirrorMargins' not in s: s = s.replace('<w:defaultTabStop', '<w:mirrorMargins/><w:defaultTabStop', 1)
        b = s.encode('utf8')
    zout.writestr(item, b)
zout.close(); zin.close(); os.replace(tmp, OUTDOCX)
json.dump(log, open(LOGOUT, 'w'), ensure_ascii=False, indent=0)
print('built', OUTDOCX, 'chapters', [c['num'] for c in chapters], 'verses', sum(len(c['verses']) for c in chapters), 'log', len(log))
