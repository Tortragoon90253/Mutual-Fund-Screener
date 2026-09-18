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
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

import sec_server as sec

HERE = os.path.dirname(os.path.abspath(__file__))
WATCHLIST = os.path.join(HERE, "watchlist.txt")
IN_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"
# AUM comes from the newest NAV row in this window. Seven days lost a third of the funds
# (aum 66.4% -> 47.5%) whenever a holiday stretch or a late filing fell inside it, which moved
# the liquidity score for reasons that had nothing to do with the funds. sec_server already uses 14.
NAV_DAYS = 14
# พอร์ตเต็มรายไตรมาสเป็นชุดที่ใหญ่ที่สุดและยังไม่เคยดึง จึงกำหนดเพดานของตัวเองไว้:
# เกินแล้วทิ้งทั้งชุดและรายงานขนาด ดีกว่าเก็บครึ่งเดียว (จะนับจำนวนหลักทรัพย์ขาด)
# หรือปล่อยให้ชนงบรวมแล้วล้มทั้งรอบที่ใช้เวลาเกือบชั่วโมง
PORT_MAX_PAGES = 2500
MAX_CALLS = int(os.environ.get("SEC_MAX_CALLS") or 8000)  # safety budget per run (protects the key's quota)
AMC_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
WORKERS = max(1, min(8, int(os.environ.get("SEC_WORKERS") or 4)))  # endpoints downloaded at the same time
# Compact search index: one array per share class instead of repeating key names 5,000 times
INDEX_FIELDS = ["projId", "cls", "abbr", "nameTh", "nameEn", "policy", "retail", "tag", "amcId", "aud"]
# Share classes sold only to provident/private funds, unit-linked policies, institutions or large investors
# (checked against all 4,923 real class descriptions, Sep 2026)
RESTRICTED_CLASS = re.compile(r"(?:ให้บริการ|เสนอขาย)เฉพาะ(?:แก่)?ผู้ลงทุน(?!ทั่วไป)|ผู้ลงทุน(?:ที่เป็น|ประเภท)?\s*กองทุน|รับโอน(?:เงิน)?จากกองทุนสำรองเลี้ยงชีพ|กองทุน(?:รวม)?\s*(?:และ/หรือ)?\s*(?:กองทุน)?ส่วนบุคคลภายใต้|unit\s*-?\s*link|กรมธรรม์ประกันชีวิต|ความคุ้มครองจากบริษัทประกัน|บริษัทประกันชีวิต|ผู้ลงทุนรายใหญ่|ผู้มีเงินลงทุนสูง|สถาบัน\s*(?:ที่|ตามที่)\s*บริษัทจัดการ(?:กำหนด|จะประกาศ)|ผู้ถือหน่วยลงทุนที่เป็นกองทุน|สำหรับกองทุนสำรองเลี้ยงชีพ", re.I)


class BudgetExceeded(Exception):
    pass


def class_tag(desc):
    """Share-class descriptions run to 2,700 characters; the search list only needs what sets classes apart."""
    d = str(desc or "")
    if re.search(r"ขายคืน.{0,40}อัตโนมัติ|auto[\s-]?redemption", d, re.I):
        return "ขายคืนอัตโนมัติ"
    if re.search(r"ไม่จ่ายเงินปันผล|ไม่มีนโยบายจ่ายเงินปันผล|ส่วนต่าง|สะสมมูลค่า|capital gain", d, re.I):
        return "สะสมมูลค่า"
    if re.search(r"ปันผล|dividend", d, re.I):
        return "จ่ายปันผล"
    return ""


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
def quarter_periods(back=3):
    """งวดไตรมาสที่ปิดแล้ว ล่าสุดก่อน เป็น YYYYMM"""
    today = date.today()
    y, m = today.year, ((today.month - 1) // 3) * 3
    if m == 0:
        y, m = y - 1, 12
    out = []
    for _ in range(back):
        out.append(f"{y}{m:02d}")
        m -= 3
        if m <= 0:
            y, m = y - 1, m + 12
    return out


def fetch_probe(path, params, max_pages):
    """ดึงชุดที่ยังไม่รู้ขนาด โดยมีเพดานหน้าเป็นของตัวเอง — เกินแล้วคืน None"""
    items, cursor, pages = [], None, 0
    started = time.time()
    while True:
        if pages >= max_pages:
            warn(f"{path}: เกิน {max_pages} หน้าแล้วยังไม่จบ — ทิ้งทั้งชุด ไม่นำมาใช้รอบนี้")
            return None
        if sec.CALLS["network"] >= MAX_CALLS:
            raise BudgetExceeded(f"ใช้ API ครบ {MAX_CALLS} ครั้งแล้ว (หยุดที่ {path})")
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


def fetch_profiles():
    profiles = fetch_all("/v2/fund/general-info/profiles", {"fund_status": "Registered"})
    if any(p.get("fund_status") != "Registered" for p in profiles):
        pass  # status filter ignored by the API: this download already holds every fund
    elif profiles:
        profiles += fetch_all("/v2/fund/general-info/profiles", {"fund_status": "IPO"})
    else:  # filter rejected -> take everything and filter here
        profiles = fetch_all("/v2/fund/general-info/profiles")
    return profiles


def collect_all():
    """Bulk mode: every endpoint is paginated on its own, so the downloads run side by side
    (SEC_WORKERS at a time); the API spends ~1.7 s per page, which made a sequential run ~100 min."""
    today = date.today()
    jobs = {"profiles": fetch_profiles}
    for key, (path, _, dated) in sec.DATASETS.items():
        jobs[key] = (lambda p=path, d=dated: fetch_all(p, {"latest": "true"} if d else None))
    # ปันผลไม่มีพารามิเตอร์กรองวันที่ จึงต้องดึงประวัติทั้งหมดแล้วมาตัดเองใน dividend_stats
    def fetch_portfolio():
        """พอร์ตเต็มของไตรมาสที่ปิดล่าสุดที่มีข้อมูล — ถอยทีละไตรมาสเพราะ บลจ. ส่งช้าไม่เท่ากัน"""
        for period in quarter_periods(3):
            rows = fetch_probe("/v2/fund/outstanding/portfolio",
                               {"start_period": period, "end_period": period}, PORT_MAX_PAGES)
            if rows is None:
                return []
            if rows:
                log(f"  พอร์ตเต็ม: ใช้งวด {period}")
                return rows
            log(f"  พอร์ตเต็ม: งวด {period} ยังไม่มีข้อมูล ถอยไปงวดก่อนหน้า")
        return []

    jobs["port"] = fetch_portfolio
    jobs["divh"] = lambda: fetch_all("/v2/fund/daily-info/dividend-history")
    jobs["nav"] = lambda: fetch_all("/v2/fund/daily-info/nav", {
        "start_nav_date": (today - timedelta(days=NAV_DAYS)).isoformat(), "end_nav_date": today.isoformat()})

    results, notes = {}, []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fn): key for key, fn in jobs.items()}
        for fut in as_completed(futures):
            key = futures[fut]
            try:
                results[key] = fut.result()
            except sec.ApiError as e:
                if e.status in (401, 403) or key == "profiles":
                    for f in futures:
                        f.cancel()
                    raise
                notes.append(f"ดึง{sec.DATASET_LABELS[key]}ไม่สำเร็จ ({e.status})")
                warn(notes[-1])
            except BudgetExceeded:
                for f in futures:
                    f.cancel()
                raise

    unique = {}
    for p in results["profiles"]:
        if sec.is_active(p) and p.get("proj_id"):
            unique[(p["proj_id"], p.get("fund_class_name") or "")] = p
    profiles = list(unique.values())
    by_fund = {p["proj_id"]: {} for p in profiles}
    log(f"กองทุนที่เปิดอยู่ {len(by_fund):,} กอง / {len(profiles):,} ชนิดหน่วยลงทุน")
    for key, rows in results.items():
        if key == "profiles":
            continue
        for r in rows:
            pid = r.get("proj_id")
            if pid in by_fund:
                by_fund[pid].setdefault(key, []).append(r)
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
            raw["divh"] = fetch_all("/v2/fund/daily-info/dividend-history", {"proj_id": p["proj_id"]})
            for period in quarter_periods(3):
                raw["port"] = fetch_all("/v2/fund/outstanding/portfolio",
                                        {"proj_id": p["proj_id"], "start_period": period, "end_period": period})
                if raw["port"]:
                    break
            raw["nav"] = fetch_all("/v2/fund/daily-info/nav", {
                "proj_id": p["proj_id"], "start_nav_date": (today - timedelta(days=NAV_DAYS)).isoformat(),
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


def quantile(values, p):
    v = sorted(values)
    i = (len(v) - 1) * p
    lo = int(i)
    return v[lo] if lo == i else v[lo] + (v[lo + 1] - v[lo]) * (i - lo)


def pct_breaks(amc_files, key, positive_only=True, min_n=30):
    """Percentile breakpoints of one numeric field per asset class -> [p10, p25, p50, p75, p90, n].
    Cheap, or well paid for its risk, only means something inside one asset class: a flat 0.5%
    TER line rates 86% of money market classes perfect and only 7% of global equity ones, and
    money market funds roll short paper so fast that their turnover dwarfs any equity fund's."""
    by = {}
    for recs in amc_files.values():
        for f in recs.values():
            v = f.get(key)
            if isinstance(v, (int, float)) and (v > 0 or not positive_only):
                by.setdefault(f.get("assetClass") or "", []).append(float(v))
    return {ac: [round(quantile(v, q), 3) for q in (.10, .25, .50, .75, .90)] + [len(v)]
            for ac, v in by.items() if ac and len(v) >= min_n}


DIAG_FIELDS = ["ter", "riskLevel", "aum", "maxDD", "sd", "sharpe", "trackErr", "ret1", "ret5", "bm5", "holdings"]


def build_diag(amc_files):
    """How complete the SEC data really is. A criterion resting on a field only a few funds
    report is worse than no criterion, so every candidate field is measured before it is scored."""
    # seed every candidate at 0 so a field nobody reports shows as 0.0%, not as a missing key
    filled = Counter({k: 0 for k in DIAG_FIELDS + ["alloc", "top5", "peer", "sdBy", "cal", "calBm", "price", "link", "bench", "div", "port"] + sec.STATS_EXTRA})
    n, peer_desc = 0, Counter()
    for recs in amc_files.values():
        for f in recs.values():
            n += 1
            for k in DIAG_FIELDS:
                if f.get(k) not in ("", None):
                    filled[k] += 1
            meta = f.get("sec") or {}
            for k in ("alloc", "top5", "peer", "sdBy", "cal", "calBm", "price", "link", "bench", "div", "port"):
                if meta.get(k):
                    filled[k] += 1
            for k in (meta.get("stats") or {}):
                filled[k] += 1
            for row in (meta.get("peer") or []):
                peer_desc[row[0]] += 1
    if not n:
        return {}
    cal_pairs = Counter()
    for recs in amc_files.values():
        for f in recs.values():
            meta = f.get("sec") or {}
            cal, cal_bm, peer = meta.get("cal") or {}, meta.get("calBm") or {}, meta.get("peer") or []
            peer_years = {row[1] for row in peer}
            cal_pairs[sum(1 for y in cal if y in cal_bm or y in peer_years)] += 1
    return {"n": n,
            "calPairs": dict(sorted(cal_pairs.items())),   # ปีปฏิทินที่มีทั้งกองและตัวเทียบ -> batting average
            "filled": {k: round(100.0 * c / n, 1) for k, c in sorted(filled.items(), key=lambda x: -x[1])},
            "peerDesc": peer_desc.most_common(25)}


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
        s.update(tag=class_tag(s["classDesc"]), amcId=amc, retail="" if s["retail"] == "R" else s["retail"],
                 aud="inst" if RESTRICTED_CLASS.search(f"{s['nameTh']} {s['classDesc']}") else "")
        index_items.append([s[k] or "" for k in INDEX_FIELDS])
    if failed:
        errors.append(f"แปลงข้อมูลไม่สำเร็จ {failed} รายการ")

    if not index_items:
        log("ไม่มีกองทุนที่ดึงสำเร็จเลย — ไม่เขียนทับข้อมูลเดิม")
        return 1

    index_items.sort(key=lambda r: (r[2], r[1]))
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

    diag = build_diag(amc_files)
    if diag:
        top = ", ".join(f"{k} {v}%" for k, v in list(diag["filled"].items())[:8])
        log(f"ความครบของข้อมูล ({diag['n']:,} รายการ): {top}")
        log(f"แถวเทียบกลุ่มที่พบ: {len(diag['peerDesc'])} แบบ" + (f" เช่น {diag['peerDesc'][0][0]}" if diag["peerDesc"] else " (ไม่พบ)"))

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
        "terPct": pct_breaks(amc_files, "ter"),          # ค่าธรรมเนียมเทียบในกลุ่มเดียวกัน
        "sharpePct": pct_breaks(amc_files, "sharpe", positive_only=False),  # ผลตอบแทนต่อความเสี่ยง
        "diag": diag,                      # ขั้น 0: ความครบของข้อมูล ใช้ตัดสินใจว่าจะสร้างเกณฑ์ใหม่ได้ไหม
        "fields": INDEX_FIELDS,
        "rows": index_items,
    })
    set_output("changed", "true")
    log(f"บันทึก {len(index_items):,} รายการ ({len(amc_files)} บลจ.) · เรียก API {sec.CALLS['network']:,} ครั้ง"
        f" · {time.time() - started:.0f} วินาที" + (f" · มีปัญหา {len(errors)} รายการ" if errors else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
