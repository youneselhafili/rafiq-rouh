"""Import HCP RGPH 2024 administrative relationships; preserve existing location IDs.

Usage: python scripts/import-location-hierarchy.py path/to/hcp.xlsx
Source: https://www.hcp.ma/file/242341/
"""
import json, re, sys, unicodedata, zipfile
from pathlib import Path
import xml.etree.ElementTree as E

root = Path(__file__).resolve().parents[1]
path = root / 'src/data/cities.json'
locations = json.loads(path.read_text(encoding='utf-8'))
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
z = zipfile.ZipFile(sys.argv[1])
strings = [''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns)]
rows = []
for row in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//m:row', ns):
    d = {}
    for c in row.findall('m:c', ns):
        v = c.find('m:v', ns)
        if v is not None:
            d[re.sub('[0-9]', '', c.attrib['r'])] = strings[int(v.text)] if c.get('t') == 's' else v.text
    rows.append(d)

def norm(s):
    s = unicodedata.normalize('NFKD', s.lower())
    return ''.join(c for c in s if c.isalnum() and not unicodedata.combining(c)).translate(str.maketrans('أإآى', 'اااي'))

def name(d):
    en = re.sub(r"^(Commune |Arrondissement |dont le centre urbain )(de |du |des |d')?", '', d['A']).strip()
    ar = re.sub(r'^(جماعة|مقاطعة|تضم المركز الحضري)\s*', '', d.get('F', en)).strip()
    return ar, en

province = None
commune = None
records = []
for d in rows:
    a, code = d.get('A', ''), d.get('G', '')
    if a.startswith(('Province ', 'Préfecture ')) and '(' not in a and "d'arrondissement" not in a:
        province = d
    if not province or not a.startswith(('Commune ', 'Arrondissement ', 'dont le centre urbain ')):
        continue
    if a.startswith('Commune '): commune = d
    if not any(x['code'] == code for x in records):
        records.append({'row': d, 'province': province, 'commune': commune, 'code': code})

matched = set()
bycode = {}
metadata = {}
for rec in records:
    d, p, code = rec['row'], rec['province'], rec['code']
    ar, en = name(d)
    # Commune codes directly below a province use 01; rural communes sit under circles.
    kind = 'district' if d['A'].startswith('Arrondissement') else 'center' if d['A'].startswith('dont ') else 'city' if len(code) == len(p['G']) + 3 or code[len(p['G']):len(p['G'])+2] == '01' else 'commune'
    if kind == 'city' and (any(x['row']['A'].startswith('dont ') and x['commune']['G'] == code for x in records) or en == 'Tassoultante' or 'Méchouar' in en):
        kind = 'commune'
    match = next((x for x in locations if x['country'] == 'Morocco' and x['nameEn'] not in matched and (norm(x['name']) == norm(ar) or norm(x['nameEn']) == norm(en))), None)
    if not match:
        ident = en if not any(x['nameEn'] == en for x in locations) else f'{en} [{code}]'
        match = {'name': ar, 'nameEn': ident, 'country': 'Morocco', 'countryAr': 'المغرب', 'timezone': 'Africa/Casablanca', 'method': 21}
        locations.append(match)
    matched.add(match['nameEn'])
    bycode[code] = match['nameEn']
    provinceEn = re.sub(r"^(Province |Préfecture )(de |du |des |d')?", '', p['A'])
    metadata[match['nameEn']] = {'locationType': kind, 'provinceCode': p['G'], 'provinceName': p['F'], 'sourceCode': code, 'queryName': en + ', ' + provinceEn, 'communeCode': rec['commune']['G'] if rec['commune'] else ''}

for ident, m in metadata.items():
    if m['locationType'] == 'district': m['parentCity'] = bycode.get(m['communeCode'], '')

# Existing spelling variants retain their IDs and inherit the official record.
aliases = {'Fez': 'Fès', 'Meknes': 'Meknès', 'Sale': 'Salé', 'Tetouan': 'Tétouan', 'Tangier': 'Tanger'}
for x in locations:
    if x['country'] == 'Morocco' and x['nameEn'] not in metadata:
        target = aliases.get(x['nameEn'])
        if target in metadata: metadata[x['nameEn']] = dict(metadata[target])
    x.update(metadata.get(x['nameEn'], {'locationType': 'city'}))

for provinceCode in {x.get('provinceCode') for x in locations if x['country'] == 'Morocco'}:
    group = [x for x in locations if x.get('provinceCode') == provinceCode]
    if not any(x['locationType'] == 'city' for x in group):
        candidate = next((x for x in group if x['locationType'] == 'center'), group[0])
        candidate['isCityOption'] = True
for x in locations:
    if x.get('locationType') == 'city': x['queryName'] = x['nameEn']
path.write_text('[\n' + ',\n'.join('  ' + json.dumps(x, ensure_ascii=False) for x in locations) + '\n]\n', encoding='utf-8')
print(json.dumps({'locations': len(locations), 'officialRecords': len(records), 'types': {k: sum(x.get('locationType') == k for x in locations) for k in ['city','commune','center','district']}}))
