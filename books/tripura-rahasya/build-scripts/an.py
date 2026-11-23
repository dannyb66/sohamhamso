import sys, docx, collections, zipfile, re
from docx.shared import Emu
def inch(v): return None if v is None else round(Emu(v).inches,3)
for path in sys.argv[1:]:
    print("="*20, path)
    d = docx.Document(path)
    for i,s in enumerate(d.sections):
        print(f" sec{i}: page {inch(s.page_width)}x{inch(s.page_height)} T{inch(s.top_margin)} B{inch(s.bottom_margin)} L{inch(s.left_margin)} R{inch(s.right_margin)} gut{inch(s.gutter)} hdr{inch(s.header_distance)} ftr{inch(s.footer_distance)} start={s.start_type} difFirst={s.different_first_page_header_footer}")
    z = zipfile.ZipFile(path)
    sx = z.read('word/settings.xml').decode('utf8','ignore')
    print(" settings: mirrorMargins" in sx, 'mirrorMargins' in sx, 'evenAndOddHeaders' in sx, 'gutterAtTop' in sx)
    dx = z.read('word/document.xml').decode('utf8','ignore')
    print(" pageBreaks:", dx.count('w:type="page"'), "sectPr:", dx.count('<w:sectPr'), "tables:", dx.count('<w:tbl>'), "drawings:", dx.count('<w:drawing'), "PAGE fields:", len(re.findall(r'PAGE\b', dx)), "TOC:", 'TOC \\' in dx)
    print(" headers/footers:", [n for n in z.namelist() if re.search(r'(header|footer)\d*\.xml$', n)])
    for n in z.namelist():
        if re.search(r'(header|footer)\d*\.xml$', n):
            t = re.sub(r'<[^>]+>','',z.read(n).decode('utf8','ignore')).strip()
            x = z.read(n).decode('utf8','ignore')
            print(f"   {n}: text={t[:60]!r} PAGEfield={'PAGE' in x}")
    st = d.styles['Normal']
    print(" Normal:", st.font.name, st.font.size.pt if st.font.size else None, st.paragraph_format.line_spacing, st.paragraph_format.space_after)
    paras = d.paragraphs
    print(" paragraphs:", len(paras), "nonempty:", sum(1 for p in paras if p.text.strip()))
    sc = collections.Counter(p.style.name for p in paras)
    print(" styles used:", sc.most_common(15))
    fc = collections.Counter(); szc = collections.Counter(); al = collections.Counter()
    for p in paras:
        al[str(p.alignment)] += 1
        for r in p.runs:
            if r.text.strip():
                fc[r.font.name] += len(r.text); szc[r.font.size.pt if r.font.size else None] += len(r.text)
    print(" fonts(chars):", fc.most_common(8)); print(" sizes(chars):", szc.most_common(8)); print(" align:", al.most_common())
    # rFonts in xml
    print(" rFonts ascii:", collections.Counter(re.findall(r'w:ascii="([^"]+)"', dx)).most_common(6))
    print(" rFonts cs:", collections.Counter(re.findall(r'w:cs="([^"]+)"', dx)).most_common(6))
