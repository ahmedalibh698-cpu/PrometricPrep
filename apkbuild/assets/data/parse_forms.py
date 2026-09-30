# -*- coding: utf-8 -*-
"""Parse Google Forms HTML (data-params blocks) into entry/option structures."""
import re, json, html as htmllib, sys, os

FORMS_DIR = os.path.dirname(os.path.abspath(__file__)) + r'\forms' if False else None
# forms dir is next to this script
HERE = os.path.dirname(os.path.abspath(__file__))
FORMS = os.path.join(HERE, 'forms_html')

def parse_form(html_path):
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    blocks = re.findall(r'data-params="([^"]*)"', html)
    questions = []
    for b in blocks:
        s = htmllib.unescape(b)
        if not s.startswith('%.@.'):
            continue
        try:
            arr, _ = json.JSONDecoder().raw_decode(s[4:])
        except Exception:
            continue
        if not isinstance(arr, list):
            continue
        item = arr[0] if arr and isinstance(arr[0], list) else arr
        if not isinstance(item, list) or len(item) < 5:
            continue
        qtype = item[3]
        entries = item[4]
        if not isinstance(entries, list) or not entries:
            continue
        e0 = entries[0]
        if not isinstance(e0, list):
            continue
        entry_id = e0[0]
        opts = []
        if len(e0) > 1 and isinstance(e0[1], list):
            for o in e0[1]:
                if isinstance(o, list) and o and isinstance(o[0], str):
                    opts.append(o[0])
        questions.append({'itemid': item[0], 'type': qtype, 'entry': entry_id,
                          'options': opts, 'title': item[1] if isinstance(item[1], str) else ''})
    return questions

def form_response_url(html):
    m = re.search(r'(https://docs\.google\.com/forms/d/e/[A-Za-z0-9_\-]+/formResponse)', html)
    return m.group(1) if m else None

if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'form1.html')
    qs = parse_form(src)
    print('parsed blocks:', len(qs))
    print('with options:', sum(1 for q in qs if q['options']))
    print('formResponse url:', form_response_url(open(src, encoding='utf-8').read()))
    for q in qs[:3]:
        print(json.dumps(q, ensure_ascii=False)[:250])
