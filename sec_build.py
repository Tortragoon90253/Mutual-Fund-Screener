"""
Build the static SEC data set for the GitHub Pages site.

  py sec_build.py                      # all active funds (bulk download, default)
  py sec_build.py --mode watchlist     # only the funds listed in watchlist.txt
  py sec_build.py --out data-branch    # output folder (default: data)

Output layout (served by the site under data/):
  index.json            search index: every share class + AMC names + run stats
  funds/<AMC id>.json   full fund records for that AMC, loaded only when a fund is added

The key comes from SEC_API_KEY / SEC_API_KEY_SECONDARY (GitHub Secrets) or sec-config.json.
It is never written to the output.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone

import sec_server as sec

HERE = os.path.dirname(os.path.abspath(__file__))
WATCHLIST = os.path.join(HERE, "watchlist.txt")
IN_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"
MAX_CALLS = int(os.environ.get("SEC_MAX_CALLS") or 8000)  # safety budget per run (protects the key's quota)
AMC_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


class BudgetExceeded(Exception):
    pass


def log(msg):
    print(msg, flush=True)


def warn(msg):
    log(f"::warning::{msg}" if IN_ACTIONS else f"! {msg}")


def set_output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def fetch_all(path, params=None):
    """Download every page of one endpoint, stopping if the call budget would be exceeded."""
    items, cursor, pages = [], None, 0
    started = time.time()
    while True:
        if sec.CALLS["network"] >= MAX_CALLS:
            raise BudgetExceeded(f"ใช้ API ครบ {MAX_CALLS} ครั้งแล้ว (หยุดที่ {path}) — ตั้ง SEC_MAX_CALLS ให้สูงขึ้นหรือใช้ --mode watchlist")
        p = dict(params or {}, page_size=100)
        if cursor:
            p["next_cursor"] = cursor
        data = sec.api_get(path, p)
        pages += 1
        items.extend(data.get("items") or [])
        cursor = data.get("next_cursor")
        if not cursor:
            break
    log(f"  {path}: {len(items):,} แถว / {pages} หน้า ({time.time() - started:.0f} วินาที)")
    return items


# ---------------------------------------------------------------- collect
def collect_all():
    """Bulk mode: one paginated download per endpoint, then group rows by fund."""
    profiles = fetch_all("/v2/fund/general-info/profiles", {"fund_status": "Registered"})
    if any(p.get("fund_status") != "Registered" for p in profiles):
        pass  # status filter ignored by the API: this download already holds every fund
    elif profiles:
        profiles += fetch_all("/v2/fund/general-info/profiles", {"fund_status": "IPO"})
    else:  # filter rejected -> take everything and filter here
        profiles = fetch_all("/v2/fund/general-info/profiles")
    unique = {}
    for p in profiles:
        if sec.is_active(p) and p.get("proj_id"):
            unique[(p["proj_id"], p.get("fund_class_name") or "")] = p
    profiles = list(unique.values())
    active = {p["proj_id"] for p in profiles}
    log(f"กองทุนที่เปิดอยู่ {len(active):,} กอง / {len(profiles):,} ชนิดหน่วยลงทุน")

    by_fund = {pid: {} for pid in active}
    notes = []
    for key, (path, _, dated) in sec.DATASETS.items():
        try:
            rows = fetch_all(path, {"latest": "true"} if dated else None)
        except sec.ApiError as e:
            if e.status in (401, 403):
                raise
            notes.append(f"ดึง{sec.DATASET_LABELS[key]}ไม่สำเร็จ ({e.status})")
            warn(notes[-1])
            continue
        for r in rows:
            pid = r.get("proj_id")
            if pid in by_fund:
                by_fund[pid].setdefault(key, []).append(r)

    today = date.today()
    try:
        navs = fetch_all("/v2/fund/daily-info/nav", {
            "start_nav_date": (today - timedelta(days=7)).isoformat(), "end_nav_date": today.isoformat()})
        for r in navs:
            if r.get("proj_id") in by_fund:
                by_fund[r["proj_id"]].setdefault("nav", []).append(r)
    except sec.ApiError as e:
        if e.status in (401, 403):
            raise
        notes.append(f"ดึง NAV ไม่สำเร็จ ({e.status})")
        warn(notes[-1])

    return [(p, by_fund[p["proj_id"]], notes) for p in profiles], []


def read_watchlist():
    entries = []
    with open(WATCHLIST, encoding="utf-8") as f:
        for raw in f:
            line = raw.split("#", 1)[0].strip()
            if line:
                term, _, cls = (part.strip() for part in line.partition("|"))
                entries.append((term, cls))
    return entries


def resolve(term, cls):
    """Watchlist term -> active share-class profiles. Accepts proj_id, fund abbreviation or class name."""
    rows = [p for p in fetch_all("/v2/fund/general-info/profiles", {"project_info": term}) if sec.is_active(p)]
    t = term.upper()
    if re.fullmatch(r"[A-Z]\d{4}_\d{4}", t):
        matches = [p for p in rows if (p.get("proj_id") or "").upper() == t]
    else:
        matches = [p for p in rows if (p.get("proj_abbr_name") or "").upper() == t] \
                  or [p for p in rows if (p.get("fund_class_name") or "").upper() == t]
    if cls:
        matches = [p for p in matches if (p.get("fund_class_name") or "").upper() == cls.upper()]
    if not matches:
        hints = sorted({(p.get("fund_class_name") if p.get("fund_class_name") not in ("", "main", None)
                         else p.get("proj_abbr_name")) or "" for p in rows} - {""})[:8]
        raise LookupError(f"ไม่พบกอง '{term}{' | ' + cls if cls else ''}' ที่เปิดขายอยู่"
                          + (f" (ชื่อใกล้เคียง: {', '.join(hints)})" if hints else ""))
    return matches


def collect_watchlist():
    """Watchlist mode: per-fund calls, only for the listed funds."""
    out, errors, seen = [], [], set()
    for term, cls in read_watchlist():
        try:
            profiles = resolve(term, cls)
        except LookupError as e:
            errors.append(str(e))
            warn(str(e))
            continue
        for p in profiles:
            key = (p["proj_id"], p.get("fund_class_name") or "")
            if key in seen:
                continue
            seen.add(key)
            raw = {}
            for name, (path, _, dated) in sec.DATASETS.items():
                raw[name] = fetch_all(path, {"proj_id": p["proj_id"], "latest": "true" if dated else None})
            today = date.today()
            raw["nav"] = fetch_all("/v2/fund/daily-info/nav", {
                "proj_id": p["proj_id"], "start_nav_date": (today - timedelta(days=7)).isoformat(),
                "end_nav_date": today.isoformat()})
            out.append((p, raw, []))
    return out, errors


# ---------------------------------------------------------------- write
def digest(index_items, amc_files):
    """Fingerprint of the data without per-run dates, to skip publishing when nothing changed."""
    h = hashlib.sha256()
    h.update(json.dumps(index_items, ensure_ascii=False, sort_keys=True).encode())
    for amc in sorted(amc_files):
        for k in sorted(amc_files[amc]):
            rec = json.loads(json.dumps(amc_files[amc][k]))
            rec.get("sec", {}).pop("fetched", None)
            h.update(k.encode())
            h.update(json.dumps(rec, ensure_ascii=False, sort_keys=True).encode())
    return h.hexdigest()


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["all", "watchlist"], default="all")
    ap.add_argument("--out", default=os.path.join(HERE, "data"))
    args = ap.parse_args()

    if not sec.load_keys():
        log("ไม่พบ API Key: ตั้งค่า GitHub Secret ชื่อ SEC_API_KEY (หรือใส่ใน sec-config.json เมื่อรันบนเครื่อง)")
        return 2
    sec.REQUEST_DELAY = 0.1
    sec._CACHE_TTL = 0  # no in-memory cache for a batch run
    started = time.time()
    log(f"โหมด: {args.mode} · งบประมาณ {MAX_CALLS:,} ครั้ง")

    try:
        records, errors = collect_all() if args.mode == "all" else collect_watchlist()
    except BudgetExceeded as e:
        log(f"หยุด: {e} — ไม่เขียนทับข้อมูลเดิม")
        return 1
    except sec.ApiError as e:
        if e.status in (401, 403):
            log(f"API Key ใช้ไม่ได้ ({e.status}) — ตรวจ GitHub Secret SEC_API_KEY และการ Subscribe API Product")
        else:
            log(f"ดึงข้อมูลไม่สำเร็จ: {e} — ไม่เขียนทับข้อมูลเดิม")
        return 1

    index_items, amc_files, amc_names, failed = [], {}, {}, 0
    for profile, raw, notes in records:
        cls = profile.get("fund_class_name") or ""
        amc = profile.get("unique_id") or "unknown"
        if not AMC_ID.match(amc):
            amc = "unknown"
        try:
            fund = sec.assemble_fund(profile, cls, raw, notes)
        except Exception as e:  # one malformed fund must not stop the whole run
            failed += 1
            if failed <= 20:
                warn(f"แปลงข้อมูล {profile.get('proj_abbr_name')} {cls} ไม่สำเร็จ: {type(e).__name__}")
            continue
        amc_names[amc] = profile.get("comp_name_th") or amc_names.get(amc, "")
        amc_files.setdefault(amc, {})[f"{profile['proj_id']}|{cls}"] = fund
        s = sec.profile_summary(profile)
        index_items.append({k: s[k] for k in ("projId", "cls", "abbr", "nameTh", "nameEn", "policy", "retail", "classDesc")}
                           | {"amcId": amc})
    if failed:
        errors.append(f"แปลงข้อมูลไม่สำเร็จ {failed} รายการ")

    if not index_items:
        log("ไม่มีกองทุนที่ดึงสำเร็จเลย — ไม่เขียนทับข้อมูลเดิม")
        return 1

    index_items.sort(key=lambda i: (i["abbr"], i["cls"]))
    fp = digest(index_items, amc_files)
    index_path = os.path.join(args.out, "index.json")
    try:
        with open(index_path, encoding="utf-8") as f:
            if json.load(f).get("digest") == fp:
                set_output("changed", "false")
                log(f"ข้อมูลไม่เปลี่ยนแปลง ({len(index_items):,} รายการ) · เรียก API {sec.CALLS['network']:,} ครั้ง"
                    f" · {time.time() - started:.0f} วินาที")
                return 0
    except (OSError, ValueError, AttributeError):
        pass

    funds_dir = os.path.join(args.out, "funds")
    shutil.rmtree(funds_dir, ignore_errors=True)
    for amc, recs in amc_files.items():
        write_json(os.path.join(funds_dir, f"{amc}.json"), {"amcId": amc, "items": recs})
    write_json(index_path, {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "SEC Open API (api.sec.or.th) — ข้อมูลจาก Fund Fact Sheet ที่ บลจ. รายงานต่อ ก.ล.ต.",
        "mode": args.mode,
        "count": len(index_items),
        "digest": fp,
        "amcs": amc_names,
        "errors": errors[:200],
        "stats": {"apiCalls": sec.CALLS["network"], "seconds": round(time.time() - started)},
        "items": index_items,
    })
    set_output("changed", "true")
    log(f"บันทึก {len(index_items):,} รายการ ({len(amc_files)} บลจ.) · เรียก API {sec.CALLS['network']:,} ครั้ง"
        f" · {time.time() - started:.0f} วินาที" + (f" · มีปัญหา {len(errors)} รายการ" if errors else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
