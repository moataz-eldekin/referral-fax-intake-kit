"""Live eval: runs every sample fax through the running app and checks it against test-data/faxes/<slug>/expected.json.

Start the app first (npm run dev) with your Sully keys in .env.local, then:
    python3 scripts/eval.py                   # all 8 faxes
    python3 scripts/eval.py --only 01,04      # some of them (prefixes)
    python3 scripts/eval.py --record-demo     # also save demo-results.json for demo mode
    python3 scripts/eval.py --base http://localhost:3000

What it checks per fax: the fax kind, the queue it lands in, urgency (an urgent referral
marked routine is a hard fail), each expected field value, that no wrong value is marked
"found" (silent errors), every expected flag, the patient match, and that the request for
missing items has no promises or advice. It reports cost (Text to JSON $0.05 per request,
M1 at $1.50 / $4.60 per 1M tokens) and time per fax, and writes eval/RESULTS.md.

The same team wrote these faxes and the rules, so this is a smoke test, not clinical validation.
Sample faxes already in the app are deleted first, so old runs do not show up as duplicates.
"""
import argparse
import datetime as dt
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.request

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FAXES = os.path.join(APP, "test-data", "faxes")
DATA = os.path.join(APP, "data", "faxes")

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:3000")
ap.add_argument("--email", default="sam.ortiz@example.com")
ap.add_argument("--password", default="change-me")
ap.add_argument("--only", default="")
ap.add_argument("--record-demo", action="store_true")
ap.add_argument("--keep", action="store_true", help="keep the faxes this run creates")
args = ap.parse_args()

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with opener.open(req, timeout=120) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def norm(v):
    return re.sub(r"[^a-z0-9]", "", str(v).lower()) if v is not None else None


TITLES = {"md", "do", "np", "pa", "rn", "dr"}


def tokens(v):
    return {t for t in re.split(r"[^a-z0-9]+", str(v).lower()) if t and t not in TITLES}


def same(path, expected, got):
    if expected is None:
        return got is None
    if got is None:
        return False
    if path.endswith(("name", "practice", "payer")):
        return tokens(expected) <= tokens(got)
    if path.endswith(("phone", "fax", "npi")):
        return re.sub(r"\D", "", got) == re.sub(r"\D", "", expected)
    return norm(expected) == norm(got)


def field(fax, path):
    cur = fax.get("referral") or {}
    for p in path.split("."):
        cur = cur[int(p)] if isinstance(cur, list) and p.isdigit() and int(p) < len(cur) else (cur.get(p) if isinstance(cur, dict) else None)
        if cur is None:
            return None
    return cur


BAD_FAXBACK = re.compile(r"\b(scheduled|booked|will be seen|we will call|we'll call|recommend|should|consider|diagnos)", re.I)

status, body = call("POST", "/api/auth/login", {"email": args.email, "password": args.password})
if status != 200:
    sys.exit(f"Login failed ({status}). Is the app running at {args.base}?")

# Clear old sample faxes so they do not count as duplicates.
_, listing = call("GET", "/api/faxes")
for f in listing.get("faxes", []):
    if f.get("source") == "sample":
        call("DELETE", f"/api/faxes/{f['id']}")

slugs = sorted(d for d in os.listdir(FAXES) if os.path.isdir(os.path.join(FAXES, d)))
if args.only:
    slugs = [s for s in slugs if any(s.startswith(p.strip()) for p in args.only.split(","))]

rows, created = [], []
for slug in slugs:
    exp = json.load(open(os.path.join(FAXES, slug, "expected.json")))
    t0 = time.time()
    status, body = call("POST", "/api/faxes", {"sample": slug})
    if status != 201:
        rows.append({"slug": slug, "fail": [f"upload failed: {status} {body}"]})
        continue
    fid = body["fax"]["id"]
    created.append(fid)
    fax = None
    for _ in range(150):
        _, b = call("GET", f"/api/faxes/{fid}")
        fax = b.get("fax")
        if fax and fax["run"]["status"] != "running":
            break
        time.sleep(1)
    secs = time.time() - t0
    fails, notes = [], []
    if fax["run"]["status"] != "done":
        fails.append(f"run ended {fax['run']['status']}: {fax['run'].get('error')}")
    if fax.get("kind") != exp["kind"]:
        fails.append(f"kind {fax.get('kind')} != {exp['kind']}")
    if fax.get("queue") != exp["queue"]:
        fails.append(f"queue {fax.get('queue')} != {exp['queue']}")
    under = exp.get("urgency") == "urgent" and fax["urgency"]["level"] != "urgent"
    if exp.get("urgency") and fax["urgency"]["level"] != exp["urgency"]:
        fails.append(("UNDER-TRIAGE: " if under else "") + f"urgency {fax['urgency']['level']} != {exp['urgency']}")
    right = total = silent = 0
    for path, want in exp.get("fields", {}).items():
        f = field(fax, path)
        got = f.get("value") if f else None
        total += 1
        if same(path, want, got):
            right += 1
        else:
            fails.append(f"{path}: got {got!r}, expected {want!r} ({f.get('status') if f else 'no field'})")
            if f and f.get("status") == "found":
                silent += 1
    ids = [c["id"] for c in fax.get("checks", [])]
    for flag in exp.get("flags", []):
        if not any(i == flag or i.startswith(flag) for i in ids):
            fails.append(f"flag missing: {flag} (got {ids})")
    if exp.get("match") and (fax.get("match") or {}).get("status") != exp["match"]:
        fails.append(f"match {(fax.get('match') or {}).get('status')} != {exp['match']}")
    fb = (fax.get("faxBack") or {}).get("text") or ""
    if fb and BAD_FAXBACK.search(fb):
        fails.append(f"request for missing items breaks the rules: {BAD_FAXBACK.search(fb).group(0)!r}")
    calls = [c for c in fax.get("calls", []) if not c.get("demo")]
    t2j = sum(1 for c in calls if c["path"].endswith("text-to-json") and c["ok"])
    tin = sum((c.get("usage") or {}).get("promptTokens", 0) for c in calls)
    tout = sum((c.get("usage") or {}).get("completionTokens", 0) for c in calls)
    cost = t2j * 0.05 + tin / 1e6 * 1.50 + tout / 1e6 * 4.60
    if fax.get("faxBack", {}).get("source") == "template":
        notes.append("fax-back fell back to the template")
    rows.append(dict(slug=slug, fail=fails, notes=notes, fields=f"{right}/{total}", right=right, total=total, silent=silent, under=under,
                     cost=cost, secs=secs, m1=sum(1 for c in calls if "chat/completions" in c["path"]), t2j=t2j, queue=fax.get("queue"), urgency=fax["urgency"]["level"]))
    print(f"{'PASS' if not fails else 'FAIL'}  {slug}  fields {right}/{total}  queue {fax.get('queue')}  {fax['urgency']['level']}  ${cost:.3f}  {secs:.1f}s")
    for x in fails:
        print("      -", x)

    if args.record_demo:
        disk = json.load(open(os.path.join(DATA, fid, "fax.json")))
        raw = disk.get("raw") or {}
        demo = {"classify": raw.get("classify")}
        if raw.get("extract") is not None:
            demo["extract"] = raw["extract"]
        if (disk.get("faxBack") or {}).get("source") in ("m1", "rewritten"):
            demo["faxBack"] = disk["faxBack"]["text"]
        json.dump(demo, open(os.path.join(FAXES, slug, "demo-results.json"), "w"), indent=2)

if not args.keep:
    for fid in created:
        call("DELETE", f"/api/faxes/{fid}")

ok = [r for r in rows if not r["fail"]]
right = sum(r.get("right", 0) for r in rows)
total = sum(r.get("total", 0) for r in rows)
cost = [r["cost"] for r in rows if "cost" in r]
secs = [r["secs"] for r in rows if "secs" in r]
summary = (f"{len(ok)}/{len(rows)} faxes pass. Field accuracy {right}/{total} ({100 * right / max(total, 1):.0f}%). "
           f"Urgent referrals marked routine: {sum(1 for r in rows if r.get('under'))}. Wrong values marked found: {sum(r.get('silent', 0) for r in rows)}. "
           f"Average cost ${sum(cost) / max(len(cost), 1):.3f} per fax, average time {sum(secs) / max(len(secs), 1):.1f} s.")
print("\n" + summary)

os.makedirs(os.path.join(APP, "eval"), exist_ok=True)
with open(os.path.join(APP, "eval", "RESULTS.md"), "w") as out:
    out.write(f"# Eval results ({dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})\n\n")
    out.write("| Fax | Fields | Queue | Urgency | M1 calls | Text to JSON | Cost | Time | Result |\n|---|---|---|---|---|---|---|---|---|\n")
    for r in rows:
        out.write(f"| {r['slug']} | {r.get('fields', '-')} | {r.get('queue', '-')} | {r.get('urgency', '-')} | {r.get('m1', '-')} | {r.get('t2j', '-')} | ${r.get('cost', 0):.3f} | {r.get('secs', 0):.1f} s | {'PASS' if not r['fail'] else 'FAIL: ' + '; '.join(r['fail'])} |\n")
    out.write(f"\n{summary}\n\nThe same team wrote the sample faxes and the rules, so this is a smoke test, not clinical validation.\n")
json.dump({"ranAt": dt.datetime.now(dt.timezone.utc).isoformat(), "rows": rows}, open(os.path.join(APP, "eval", "results.json"), "w"), indent=2)
sys.exit(0 if len(ok) == len(rows) else 1)
