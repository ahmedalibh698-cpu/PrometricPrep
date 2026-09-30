# -*- coding: utf-8 -*-
"""Merge parsed questions with official answers extracted from Google Forms quiz reviews.

- Loads per-form parsed questions (from forms_html) + answers_formN.json (itemid -> option index)
- Cleans text (same rules used for the raw dataset)
- Dedupes across forms by normalized question text; cross-checks that duplicate
  questions found in different forms carry the SAME official correct answer
- Emits app questions.js + a validation report
"""
import re, json, os, sys, html as htmllib
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parse_forms import parse_form

def clean_text(t):
    t = t.replace('\n', ' ').replace('\r', ' ').replace('\xa0', ' ')
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^\s*\d{1,3}\s*[-.)–]\s*', '', t)
    t = re.sub(r'\s*\d{1,3}\s*[-–]\s*$', '', t)
    t = re.sub(r'^\(\d+\)\s*', '', t)
    return t.strip()

def norm_key(t):
    return re.sub(r'[^a-z0-9]', '', clean_text(t).lower())

JUNK = re.compile(r'^(خيار|\(|\)|-|\d)$')
OPT_PREFIX = re.compile(r'^([A-Ea-e])\s*[).\-–:]\s*')

# leftover junk letter prefixes that survived cleaning (verified individually)
OPT_FIX = {
    'A 2.5': '2.5',
    'C Trihexyphenidyl': 'Trihexyphenidyl',
    'D osteonecrosis of the jaw': 'osteonecrosis of the jaw',
    'C nigro-striatal brain area': 'nigro-striatal brain area',
    'C rheinanthrone': 'rheinanthrone',
    'A flushing Adrenergic Receptors': 'flushing Adrenergic Receptors',
    'A High toxicity': 'High toxicity',
}

def strip_prefix(o):
    return OPT_FIX.get(o) or OPT_PREFIX.sub('', o)

def build():
    all_q = []
    conflicts = []
    for n in range(1, 9):
        form_path = os.path.join(HERE, 'forms_html', 'form%d.html' % n)
        ans_path = os.path.join(HERE, 'answers_form%d.json' % n)
        qs = parse_form(form_path)
        with open(ans_path, encoding='utf-8') as f:
            answers = json.load(f)
        used = 0
        for q in qs:
            if not q['options'] or str(q['itemid']) not in answers:
                continue
            ans = answers[str(q['itemid'])]
            idx = ans['index']
            raw_opts = q['options']
            # clean options, drop junk, strip letter prefixes
            keep, mapping = [], []
            for j, o in enumerate(raw_opts):
                o2 = clean_text(o).replace('ꭤ', 'α')
                if JUNK.match(o2):
                    continue
                o2 = strip_prefix(o2)
                if not o2:
                    continue
                if o2 in keep:
                    # exact duplicate option after cleaning; map to first occurrence
                    mapping.append(keep.index(o2))
                    continue
                keep.append(o2)
                mapping.append(len(keep) - 1)
            if len(keep) < 3:
                print('SKIP few opts: form%d %s' % (n, clean_text(q['title'])[:60]))
                continue
            if idx >= len(mapping):
                print('ANSWER OUT OF RANGE form%d item%s' % (n, q['itemid']))
                continue
            aidx = mapping[idx]
            # junk sequence prefixes like "A 2.5" / "C D-3": if >=3 options start
            # with a lone letter A-E followed by space, strip those letters
            seq = [j for j, o in enumerate(keep) if re.match(r'^[A-Ea-e]\s+\S', o)]
            if len(seq) >= 3 and seq == list(range(len(seq))):
                for j in seq:
                    keep[j] = re.sub(r'^[A-Ea-e]\s+', '', keep[j])
                # collapse any duplicates created, remapping the answer index
                seen2, keep2, remap = set(), [], {}
                for j, o in enumerate(keep):
                    if o in seen2:
                        remap[j] = keep2.index(o)
                        continue
                    seen2.add(o)
                    keep2.append(o)
                    remap[j] = len(keep2) - 1
                keep = keep2
                mapping = [remap[j] for j in mapping]
            all_q.append({'form': n, 'itemid': q['itemid'], 'question': clean_text(q['title']).replace('ꭤ', 'α'),
                          'options': keep, 'answer': mapping[idx],
                          'answer_text': keep[mapping[idx]], 'uid': (n, q['itemid'])})
        used += 1
    print('form%d: merged %d questions' % (n, used))

    # dedupe across forms with cross-check
    def norm_ans(t):
        t = re.sub(r'[^a-z0-9]', '', t.strip().lower())
        # drop a leading option-letter glued to a digit ("a25" -> "25")
        t = re.sub(r'^[a-e](?=\d)', '', t)
        return t
    # obvious source-form typos that appear as correct answers
    TYPO_FIX = {'lithlum': 'Lithium', 'propylthlouracil': 'Propylthiouracil'}
    final = OrderedDict()
    conflicts = []
    for q in all_q:
        na = norm_ans(q['answer_text'])
        if na in TYPO_FIX:
            q['answer_text'] = TYPO_FIX[na]
            q['options'][q['answer']] = TYPO_FIX[na]
        key = norm_key(q['question'])
        if key in final:
            prev = final[key]
            if norm_ans(prev['answer_text']) != norm_ans(q['answer_text']):
                conflicts.append({'question': q['question'][:90],
                                  'formA': (prev['form'], prev['answer_text']),
                                  'formB': (q['form'], q['answer_text'])})
            # keep the longer/more complete version
            if len(q['options']) > len(prev['options']):
                final[key] = q
            continue
        final[key] = q

    # fuzzy dedup: near-identical stems that evade exact matching (source typos).
    # Manual decisions from reviewing borderline pairs: (drop_substring, keep_substring)
    MANUAL_MERGE = [
        # NOTE: the two "vaccines contraindicated in pregnancy" questions are
        # DIFFERENT questions (different option sets, both keys valid) -- keep both.
        ('represent a.cost-effectiveness study', 'represent cost-effectiveness analyses study'),
        ('clation of the cervix', 'ripening and dilation of the cervix'),
        ('inter venous (IV)? Medication', 'intravenous (IV) medications in the hospital'),
        ('per millititre', 'administered at a rate of 50 mg/hr'),
        ('per milliliter. The drug is to be administered at a rate of 50', 'per milliliter. administered at a rate of 50'),
        ('67 year old man presents', 'A 67-year-old man presents'),
        ('Click image to enlarge Acetaminophen', 'Acetaminophen is an antipyretic'),
        ('A 33-year-old is woman', 'A 33-year-old woman with history of migraine'),
        ('An experiment on unknown drugs D-1. D-2', 'An experiment on unknown drugs D-1,D-2'),
        ('Ropivancaine', 'Ropivacaine is an Important'),
        ('Click image to enlarge The structure of norepinephrine', 'The structure of a norepinephrine-serotonin'),
        ('A 5OO infusion bottle', 'A 500 infusion bottle'),
        ('bisphosphates use', 'bisphosphonates use'),
        ('after prepared diluted', 'after proper diluted'),
        ('with complaint of inability to open eyes', 'with complaints of inability to open eyes'),
        ('decrease the effect of warfain', 'decrease the effect of warfarin'),
        ('measuring o.9 m2', 'measuring 0.9 m2'),
        ('best describe drug dependence', 'best describes drug dependence'),
    ]
    applied = 0
    for drop_sub, keep_sub in MANUAL_MERGE:
        ka = kb = None
        for k, q in final.items():
            if drop_sub in q['question']:
                ka = k
            elif keep_sub in q['question']:
                kb = k
        if ka and kb:
            if norm_ans(final[ka]['answer_text']) != norm_ans(final[kb]['answer_text']):
                conflicts.append({'question': final[ka]['question'][:90],
                                  'formA': (final[kb]['form'], final[kb]['answer_text']),
                                  'formB': (final[ka]['form'], final[ka]['answer_text']),
                                  'manual': True})
            del final[ka]
            applied += 1
        else:
            print('MANUAL MERGE MISS: %r -> %r (ka=%s kb=%s)' % (drop_sub, keep_sub, bool(ka), bool(kb)))
    print('manual merges applied:', applied)

    # auto-merge only very high similarity AND same numbers AND agreeing answers
    import difflib
    def sim(a, b):
        return difflib.SequenceMatcher(None, a, b).ratio()
    def numbers_in(t):
        # fix common letter->digit typos before extracting numbers
        t = re.sub(r'(?<=[\d.])O(?=[\d.]|\b)', '0', t)
        t = re.sub(r'\bo([.\d])', r'0\1', t)
        return sorted(re.findall(r'\d+(?:\.\d+)?', t))
    fuzzy_dropped = 0
    keys = list(final.keys())
    for i, k1 in enumerate(keys):
        if k1 not in final:
            continue
        for k2 in keys[i + 1:]:
            if k2 not in final:
                continue
            if abs(len(k1) - len(k2)) > 40:
                continue
            r = sim(k1, k2)
            if r >= 0.985:
                nums_ok = numbers_in(final[k1]['question']) == numbers_in(final[k2]['question'])
                ans_ok = norm_ans(final[k1]['answer_text']) == norm_ans(final[k2]['answer_text'])
                if nums_ok and ans_ok:
                    print('FUZZY MERGE %.3f: [%s] <-> [%s]' % (r, final[k1]['question'][:70], final[k2]['question'][:70]))
                    del final[k2]
                    fuzzy_dropped += 1
                else:
                    print('REVIEW NEEDED %.3f nums_ok=%s ans_ok=%s: [%s] <-> [%s]' % (r, nums_ok, ans_ok, final[k1]['question'][:70], final[k2]['question'][:70]))
    print('auto fuzzy merges:', fuzzy_dropped)

    # drop image/table-dependent questions that cannot be answered from text alone.
    # Rules (from manual review):
    #  - bare letter options ("A","B",..) = answer lives in an image -> drop
    #  - "(see image/figure/graph/chart)" or "Click image" -> drop
    #  - "(see table/see lab results)" -> drop UNLESS the data is included in the
    #    question text (keep-list below, verified manually)
    BARE = re.compile(r'^[a-e]$', re.I)
    VISUAL = re.compile(r'see (image|figure|graph|chart|photo)|click (the )?image', re.I)
    TABLAB = re.compile(r'see (table|lab)', re.I)
    KEEP_TABLAB = ['urea breath test', 'liver biopsy showed mild fibrosis',
                   'levothyroxine 100 mcg daily', 'creatinine clearance 103',
                   'heavy menstrual bleeding', 'atomic welghts', 'snake bite',
                   'breast milk']
    before = len(final)
    kept, dropped = [], []
    for q in final.values():
        qlow = q['question'].lower()
        if all(BARE.match(o.strip()) for o in q['options']) or VISUAL.search(qlow):
            dropped.append(q)
        elif TABLAB.search(qlow) and not any(s in qlow for s in KEEP_TABLAB):
            dropped.append(q)
        else:
            kept.append(q)
    out = kept
    print('image/table-dependent questions dropped:', len(dropped))
    for q in dropped:
        print('   DROPPED: [%s] %s' % (q['uid'], q['question'][:80]))
    print()
    print('TOTAL merged: %d | unique: %d | conflicts: %d' % (len(all_q), len(out), len(conflicts)))
    for c in conflicts:
        print('CONFLICT:', c['question'])
        print('   form%s -> %s | form%s -> %s' % (c['formA'][0], c['formA'][1][:40], c['formB'][0], c['formB'][1][:40]))

    # stats
    print('answer distribution:', Counter(q['answer'] for q in out))
    print('option counts:', Counter(len(q['options']) for q in out))

    # validation
    bad = [q for q in out if not (0 <= q['answer'] < len(q['options']))]
    print('invalid answer indices:', len(bad))
    dup_opts = [q['question'][:60] for q in out if len(set(o.lower() for o in q['options'])) != len(q['options'])]
    print('questions with duplicate options:', len(dup_opts), dup_opts[:5])

    # emit questions.js
    data = []
    for i, q in enumerate(out):
        data.append({'id': i + 1, 'form': q['form'], 'q': q['question'], 'o': q['options'], 'a': q['answer']})
    js_path = os.path.join(HERE, '..', 'questions.js')
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write('// Prometric exam questions with official answer key extracted from the source quiz forms.\n')
        f.write('// id: stable question id | form: source form | q: question text | o: options | a: 0-based index of correct option\n')
        f.write('const QUESTIONS = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('wrote', os.path.abspath(js_path), 'with', len(data), 'questions')

    with open(os.path.join(HERE, 'merge_report.json'), 'w', encoding='utf-8') as f:
        json.dump({'conflicts': conflicts, 'total_raw': len(all_q), 'unique': len(out)}, f, ensure_ascii=False, indent=1)

if __name__ == '__main__':
    build()
