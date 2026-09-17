"""
Build data/funds.json from watchlist.txt using the SEC Open API.

Used by GitHub Actions (.github/workflows/update-fund-data.yml) so the GitHub Pages
site can show SEC data without ever putting the API key in the browser.
Key comes from the SEC_API_KEY / SEC_API_KEY_SECONDARY environment variables
(GitHub Secrets) or from sec-config.json when run locally:  py sec_build.py
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

import sec_server as sec

HERE = os.path.dirname(os.path.abspath(__file__))
WATCHLIST = os.path.join(HERE, "watchlist.txt")
OUT = os.path.join(HERE, "data", "funds.json")
IN_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"


def warn(msg):
    print(f"::warning::{msg}" if IN_ACTIONS else f"! {msg}")


def read_watchlist():
    entries = []
    with open(WATCHLIST, encoding="utf-8") as f:
        for raw in f:
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            term, _, cls = (part.strip() for part in line.partition("|"))
            entries.append((term, cls))
    return entries


def resolve(term, cls):
    """Watchlist term -> active share-class profiles. Accepts proj_id, fund abbreviation or class name."""
    rows = [p for p in sec.api_all("/v2/fund/general-info/profiles", {"project_info": term}, max_pages=5)
            if sec.is_active(p)]
    t = term.upper()
    if re.fullmatch(r"[A-Z]\d{4}_\d{4}", t):
        matches = [p for p in rows if (p.get("proj_id") or "").upper() == t]
    else:
        matches = [p for p in rows if (p.get("proj_abbr_name") or "").upper() == t]
        if not matches:
            matches = [p for p in rows if (p.get("fund_class_name") or "").upper() == t]
    if cls:
        matches = [p for p in matches if (p.get("fund_class_name") or "").upper() == cls.upper()]
    if not matches:
        hints = sorted({(p.get("fund_class_name") if p.get("fund_class_name") not in ("", "main", None) else p.get("proj_abbr_name")) or "" for p in rows} - {""})[:8]
        raise LookupError(f"ไม่พบกอง '{term}{' | ' + cls if cls else ''}' ที่เปิดขายอยู่"
                          + (f" (ชื่อใกล้เคียง: {', '.join(hints)})" if hints else ""))
    return matches


def strip_volatile(items):
    """Compare runs without the per-day fetch date, so unchanged data is not re-committed."""
    out = []
    for it in items:
        it = json.loads(json.dumps(it))
        it.get("fund", {}).get("sec", {}).pop("fetched", None)
        out.append(it)
    return out


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    if not sec.load_keys():
        print("ไม่พบ API Key: ตั้งค่า GitHub Secret ชื่อ SEC_API_KEY (หรือใส่ใน sec-config.json เมื่อรันบนเครื่อง)")
        return 2
    sec.REQUEST_DELAY = 0.15

    previous = {}
    old_doc = None
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                old_doc = json.load(f)
            previous = {(i["projId"], i["cls"]): i for i in old_doc.get("items", [])}
        except (OSError, ValueError, KeyError, TypeError):
            old_doc = None

    items, errors, seen = [], [], set()
    for term, cls in read_watchlist():
        try:
            profiles = resolve(term, cls)
        except sec.ApiError as e:
            if e.status in (401, 403):
                print(f"API Key ใช้ไม่ได้ ({e.status}) — ตรวจ GitHub Secret SEC_API_KEY")
                return 2
            errors.append(f"{term}: {e}")
            warn(f"{term}: {e}")
            continue
        except LookupError as e:
            errors.append(str(e))
            warn(str(e))
            continue
        for p in profiles:
            key = (p.get("proj_id"), p.get("fund_class_name") or "")
            if key in seen:
                continue
            seen.add(key)
            label = f"{p.get('proj_abbr_name')} {key[1]}".strip()
            try:
                fund = sec.fetch_fund(*key)
                items.append({**sec.profile_summary(p), "fund": fund})
                print(f"✓ {label}")
            except sec.ApiError as e:
                if e.status in (401, 403):
                    print(f"API Key ใช้ไม่ได้ ({e.status}) — ตรวจ GitHub Secret SEC_API_KEY")
                    return 2
                if key in previous:
                    items.append(previous[key])
                    errors.append(f"{label}: ดึงไม่สำเร็จ ({e.status}) ใช้ข้อมูลรอบก่อน")
                else:
                    errors.append(f"{label}: ดึงไม่สำเร็จ ({e.status})")
                warn(errors[-1])

    if not items:
        print("ไม่มีกองทุนที่ดึงสำเร็จเลย — ไม่เขียนทับไฟล์เดิม")
        return 1

    items.sort(key=lambda i: (i.get("abbr") or "", i.get("cls") or ""))
    if old_doc and strip_volatile(old_doc.get("items", [])) == strip_volatile(items) and old_doc.get("errors") == errors:
        print(f"ข้อมูลไม่เปลี่ยนแปลง ({len(items)} รายการ)")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "SEC Open API (api.sec.or.th) — ข้อมูลจาก Fund Fact Sheet ที่ บลจ. รายงานต่อ ก.ล.ต.",
        "count": len(items),
        "items": items,
        "errors": errors,
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"บันทึก {len(items)} รายการลง data/funds.json" + (f" (มีปัญหา {len(errors)} รายการ)" if errors else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
