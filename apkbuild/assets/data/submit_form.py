# -*- coding: utf-8 -*-
"""Submit a Google Form with placeholder answers and capture the confirmation page."""
import re, json, sys, os, urllib.request, urllib.parse, html as htmllib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parse_forms import parse_form, form_response_url

def submit(form_html_path, out_path, choice=0):
    qs = parse_form(form_html_path)
    with open(form_html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    url = form_response_url(html)

    data = {}
    answered = 0
    for q in qs:
        if q['options']:
            val = q['options'][choice]
            if len(val) > 480:
                val = val[:480]
            data['entry.%d' % q['entry']] = val
            data['entry.%d_sentinel' % q['entry']] = ''
            answered += 1
        else:
            # short answer (e.g. Name)
            data['entry.%d' % q['entry']] = 'Prometric Exam'
            data['entry.%d_sentinel' % q['entry']] = ''
    # include the form's own hidden fields (fbzx, partialResponse, ...)
    for name, value in re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', html):
        if name not in data:
            data[name] = htmllib.unescape(value)
    data.setdefault('fvv', '1')
    data.setdefault('pageHistory', '0')
    data.setdefault('submissionTimestamp', '-1')
    data['submit'] = 'Submit'

    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode('utf-8'),
                                 headers={'Content-Type': 'application/x-www-form-urlencoded',
                                          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            status = resp.status
            final_url = resp.geturl()
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        status = e.code
        final_url = e.geturl()
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(body)
    return status, final_url, len(body), answered

if __name__ == '__main__':
    src = sys.argv[1]
    out = sys.argv[2]
    choice = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    status, final_url, size, answered = submit(src, out, choice)
    print('status:', status)
    print('final url:', final_url)
    print('page size:', size, '| answered entries:', answered)
    for kw in ['view score', 'View score', 'viewscore', 'correct', 'Correct', 'FB_PUBLIC_LOAD_DATA_', 'response has been recorded']:
        print(kw, '->', body.count(kw) if 'body' in dir() else '')
