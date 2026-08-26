#!/usr/bin/env python3
"""g++-vs-tracer stdout differ — the independent check on regressions.py.

regressions.py asserts hand-written expectations; this compiles the SAME program
with a real compiler and diffs stdout, so a wrong expectation cannot hide a bug.
Use it for broad smoke tests after touching the interpreter.

For each probe: g++ -std=c++17 → run → compare against the concatenated
{'type':'output'} events from the tracer at localhost:8765.

Probe conventions (files in tests/probes/):
  foo.cpp        program to compare
  foo.in         optional stdin, fed to both
  foo_crash.cpp  must crash: the tracer's output must be a PREFIX of g++'s and
                 the tracer must report a crash (g++ runs to completion or dies,
                 either way only the common prefix is meaningful)

NOTE: bits/stdc++.h does not exist on macOS — probes use explicit std headers.

Usage:  python3 tests/gtdiff.py [port] [probe.cpp ...]
"""
import json, os, subprocess, sys, urllib.request

HERE   = os.path.dirname(os.path.abspath(__file__))
PROBES = os.path.join(HERE, 'probes')
BUILD  = os.path.join(HERE, '.build')

args = sys.argv[1:]
PORT = args.pop(0) if args and args[0].isdigit() else '8765'
URL  = f'http://localhost:{PORT}/execute'


def native_stdout(src_path, stdin_data):
    os.makedirs(BUILD, exist_ok=True)
    exe = os.path.join(BUILD, os.path.basename(src_path)[:-4])
    cp = subprocess.run(['g++', '-std=c++17', '-w', '-o', exe, src_path],
                        capture_output=True, text=True)
    if cp.returncode != 0:
        return None, f'g++ failed: {cp.stderr.strip()[:300]}'
    try:
        rp = subprocess.run([exe], input=stdin_data, capture_output=True,
                            text=True, timeout=15)
    except subprocess.TimeoutExpired:
        return None, 'native binary timed out'
    return rp.stdout, None


def tracer_stdout(source, stdin_data):
    body = json.dumps({'source': source, 'language': 'cpp',
                       'stdin_input': stdin_data}).encode()
    req = urllib.request.Request(URL, data=body,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            trace = json.load(r)['trace']
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        try:
            detail = json.loads(detail).get('detail', detail)
        except Exception:
            pass
        return None, False, f'HTTP {e.code}: {detail[:300]}'
    except Exception as e:
        return None, False, str(e)[:300]
    steps = trace['steps'] if isinstance(trace, dict) else trace
    out = ''.join(s['event'].get('text', '') for s in steps
                  if s.get('event', {}).get('type') == 'output')
    crashed = any(s.get('event', {}).get('type') == 'crash' for s in steps)
    return out, crashed, None


def run_one(path):
    name   = os.path.basename(path)
    source = open(path).read()
    in_f   = path[:-4] + '.in'
    stdin_data = open(in_f).read() if os.path.exists(in_f) else ''
    expect_crash = name.endswith('_crash.cpp')

    want, err = native_stdout(path, stdin_data)
    if err:
        return 'SKIP', name, err
    got, crashed, err = tracer_stdout(source, stdin_data)
    if err:
        return 'FAIL', name, err

    if expect_crash:
        if not crashed:
            return 'FAIL', name, 'expected a crash, tracer finished cleanly'
        # A crashing native binary loses whatever was still in stdio's buffer, so
        # g++ can print LESS than the tracer even when both are right. Only the
        # common prefix is meaningful: require one to be a prefix of the other.
        if not (want.startswith(got) or got.startswith(want)):
            return 'FAIL', name, (f'prefix mismatch\n    g++    {want[:200]!r}'
                                  f'\n    tracer {got[:200]!r}')
        return 'PASS', name, ''
    if crashed:
        return 'FAIL', name, f'tracer crashed; g++ printed {want[:200]!r}'
    if want != got:
        return 'FAIL', name, f'\n    g++    {want[:400]!r}\n    tracer {got[:400]!r}'
    return 'PASS', name, ''


def main():
    paths = args or sorted(os.path.join(PROBES, f)
                           for f in os.listdir(PROBES) if f.endswith('.cpp'))
    tally = {'PASS': 0, 'FAIL': 0, 'SKIP': 0}
    for p in paths:
        status, name, msg = run_one(p)
        tally[status] += 1
        mark = {'PASS': 'ok   ', 'FAIL': 'FAIL ', 'SKIP': 'skip '}[status]
        print(f'  {mark}{name}' + (f'  {msg}' if msg else ''))
    print(f"\n  {tally['PASS']}/{tally['PASS'] + tally['FAIL']} match g++"
          + (f" ({tally['SKIP']} skipped)" if tally['SKIP'] else ''))
    return 1 if tally['FAIL'] else 0


if __name__ == '__main__':
    sys.exit(main())
