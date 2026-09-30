# -*- coding: utf-8 -*-
"""Full pipeline: submit each form 4x with rotating answers, extract official correct answers.

Google Forms quiz review ('viewscore') page shows, per question:
  - the submitted answer and whether it was right/wrong (1/1 or 0/1)
  - for wrong answers, a section 'الإجابة الصحيحة' listing the correct option(s)

Rotating the chosen option across 4 submissions (A,B,C,D) guarantees every
4-option question is answered correctly in at least one round; wrong rounds
additionally reveal the correct answer directly.
"""
import re, json, os, sys, time, html as htmllib
import urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parse_forms import parse_form, form_response_url

FORMS_DIR = os.path.join(HERE, 'forms_html')
RESP_DIR = os.path.join(HERE, 'responses')
LOG = os.path.join(HERE, 'pipeline.log')

def log(msg):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(msg + '\n')
    print(msg, flush=True)

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Content-Type': 'application/x-www-form-urlencoded'}

def http_post(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode('utf-8'), headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode('utf-8', errors='replace')

def http_get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA['User-Agent']})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode('utf-8', errors='replace')

def submit_round(form_path, choice):
    qs = parse_form(form_path)
    with open(form_path, 'r', encoding='utf-8') as f:
        html = f.read()
    url = form_response_url(html)
    data = {}
    for q in qs:
        if q['options']:
            idx = choice if choice < len(q['options']) else len(q['options']) - 1
            data['entry.%d' % q['entry']] = q['options'][idx]
            data['entry.%d_sentinel' % q['entry']] = ''
        else:
            data['entry.%d' % q['entry']] = 'Prometric Exam'
            data['entry.%d_sentinel' % q['entry']] = ''
    for name, value in re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', html):
        if name not in data:
            data[name] = htmllib.unescape(value)
    data.setdefault('fvv', '1')
    data.setdefault('pageHistory', '0')
    data.setdefault('submissionTimestamp', '-1')
    data['submit'] = 'Submit'
    body = http_post(url, data)
    m = re.search(r'(https://docs\.google\.com/forms/d/e/[A-Za-z0-9_\-]+/viewscore\?viewscore=[A-Za-z0-9_\-]+)', body)
    if not m:
        return None, 'no viewscore link found'
    return m.group(1), None

def parse_viewscore(page):
    """Return {itemid: {'score': '1/1'|'0/1', 'mine': str|None, 'reveal': [texts]}}"""
    out = {}
    starts = [(m.start(), m.group(1)) for m in re.finditer(r'data-item-id="(\d+)"', page)]
    for i, (pos, itemid) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(page)
        sl = page[pos:end]
        entry = {}
        sc = re.search(r'id="i\.points\.%s"[^>]*>([^<]*)<' % itemid, sl)
        mv = re.search(r'<input type="hidden" name="entry\.(\d+)"[^>]*value="([^"]*)"', sl)
        reveal = []
        ri = sl.find('الإجابة الصحيحة')
        if ri >= 0:
            tail = sl[ri:]
            reveal = [htmllib.unescape(x) for x in re.findall(r'<span dir="auto" class="[^"]*">([^<]*)</span>', tail)]
        out[itemid] = {
            'score': sc.group(1).strip() if sc else None,
            'entry': mv.group(1) if mv else None,
            'mine': htmllib.unescape(mv.group(2)) if mv else None,
            'reveal': reveal,
        }
    return out

def process_form(n):
    form_path = os.path.join(FORMS_DIR, 'form%d.html' % n)
    qs = parse_form(form_path)
    qmap = {str(q['itemid']): q for q in qs if q['options']}
    rounds = {}
    for k in range(4):
        vs_url, err = submit_round(form_path, k)
        if err:
            log('form%d round%d: ERROR %s' % (n, k, err))
            return False
        page = http_get(vs_url)
        parsed = parse_viewscore(page)
        rounds[k] = parsed
        n1 = sum(1 for v in parsed.values() if v['score'] == '1/1')
        log('form%d round%d: %d questions graded, %d correct' % (n, k, len(parsed), n1))
        time.sleep(2)
    answers = {}
    fails = []
    for itemid, q in qmap.items():
        correct = None
        for k in range(4):
            r = rounds[k].get(itemid)
            if not r:
                continue
            if r['reveal']:
                correct = r['reveal']
                break
        if correct is None:
            for k in range(4):
                r = rounds[k].get(itemid)
                if r and r['score'] == '1/1' and r['mine']:
                    correct = [r['mine']]
                    break
        if not correct:
            fails.append(itemid)
            continue
        # match against raw options
        matches = [i for i, o in enumerate(q['options']) if o == correct[0]]
        if len(matches) != 1:
            # fallback: prefix match (in case of value truncation)
            matches = [i for i, o in enumerate(q['options']) if o.startswith(correct[0][:200])]
        if len(matches) != 1:
            fails.append(itemid)
            continue
        answers[itemid] = {'index': matches[0], 'text': q['options'][matches[0]]}
    out_path = os.path.join(HERE, 'answers_form%d.json' % n)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(answers, f, ensure_ascii=False, indent=1)
    log('form%d: answered %d / %d questions, fails: %s -> %s' % (n, len(answers), len(qmap), fails[:10], out_path))
    return len(fails) == 0

if __name__ == '__main__':
    os.makedirs(RESP_DIR, exist_ok=True)
    forms = [int(a) for a in sys.argv[1:]] or list(range(1, 9))
    ok = True
    for n in forms:
        log('--- form %d ---' % n)
        try:
            ok = process_form(n) and ok
        except Exception as e:
            ok = False
            log('form%d EXCEPTION: %r' % (n, e))
        time.sleep(2)
    log('DONE ok=%s' % ok)
