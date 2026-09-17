"""
Local bridge between fund-screener.html and SEC Open API (api.sec.or.th v2).

- Serves index.html (+ app.js, vendor/, data/) at http://127.0.0.1:8765/
- /api/health               -> is a key configured?
- /api/search?q=<text>      -> search fund share classes by name / abbreviation
- /api/fund?proj_id=&cls=   -> pull fact-sheet data and map it to the screener's fund format

The browser cannot call api.sec.or.th directly (no CORS headers) and the key must
not live inside the HTML, so this script holds the key and relays the calls.
Standard library only. Run:  py sec_server.py
"""
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST, PORT = "127.0.0.1", 8765
BASE = "https://api.sec.or.th"
HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "sec-config.json")


# ---------------------------------------------------------------- keys & HTTP
def load_keys():
    cfg = {}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        pass
    primary = os.environ.get("SEC_API_KEY") or cfg.get("primary_key") or ""
    secondary = os.environ.get("SEC_API_KEY_SECONDARY") or cfg.get("secondary_key") or ""
    return [k.strip() for k in (primary, secondary) if k and k.strip()]


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


_cache = {}
_CACHE_TTL = 15 * 60


REQUEST_DELAY = 0.0  # seconds between uncached calls; the batch builder raises this to be gentle on the API


def api_get(path, params=None):
    """GET one page. Falls back to the secondary key on 401/403/429 and retries 429/5xx with backoff."""
    params = {k: v for k, v in (params or {}).items() if v not in (None, "")}
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    keys = load_keys()
    if not keys:
        raise ApiError(401, "ยังไม่ได้ใส่ API Key (sec-config.json หรือ SEC_API_KEY)")
    last = None
    for attempt in range(3):
        for key in keys:
            if REQUEST_DELAY:
                time.sleep(REQUEST_DELAY)
            req = urllib.request.Request(url, headers={
                "Ocp-Apim-Subscription-Key": key,
                "Cache-Control": "no-cache",
                "Accept": "application/json",
            })
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.loads(r.read().decode("utf-8") or "{}")
                    _cache[url] = (time.time(), data)
                    return data
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:300]
                last = ApiError(e.code, f"SEC API ตอบกลับ {e.code}: {detail}")
                if e.code in (401, 403, 429) or e.code >= 500:
                    continue
                raise last
            except urllib.error.URLError as e:
                last = ApiError(502, f"เชื่อมต่อ api.sec.or.th ไม่ได้: {e.reason}")
        if last and last.status in (401, 403):
            break
        time.sleep(2 * (attempt + 1))
    raise last


def api_all(path, params=None, max_pages=20):
    items, cursor = [], None
    for _ in range(max_pages):
        p = dict(params or {}, page_size=100)
        if cursor:
            p["next_cursor"] = cursor
        data = api_get(path, p)
        items.extend(data.get("items") or [])
        cursor = data.get("next_cursor")
        if not cursor:
            break
    return items


# ---------------------------------------------------------------- helpers
def to_num(v):
    """Numbers arrive as float, '1.07', '-0.02', 'ไม่เกิน 1.5', 'T+4' ..."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:[.,]\d+)?", str(v))
    return float(m.group(0).replace(",", "")) if m else None


def class_match(item, cls):
    ic = (item.get("fund_class_name") or "").strip()
    if not cls or cls == "main":
        return ic in ("", "main")
    return ic == cls


def latest_rows(rows):
    """Keep rows from the most recent fact sheet (end_date null = currently effective)."""
    if not rows:
        return rows
    current = [r for r in rows if not r.get("end_date")]
    if current:
        return current
    top = max(r.get("start_date") or "" for r in rows)
    return [r for r in rows if (r.get("start_date") or "") == top]


def factsheet(path, proj_id, cls=None, class_level=True):
    params = {"proj_id": proj_id, "latest": "true"}
    rows = api_all(path, params)
    if class_level:
        matched = [r for r in rows if class_match(r, cls)]
        rows = matched or rows  # some funds report class data under "main"
    return latest_rows(rows)


def safe(fn, notes, label):
    try:
        return fn()
    except ApiError as e:
        if e.status in (401, 403):
            raise
        notes.append(f"ดึง{label}ไม่สำเร็จ ({e.status})")
    except Exception as e:  # malformed payloads should not kill the whole import
        notes.append(f"อ่าน{label}ไม่สำเร็จ ({type(e).__name__})")
    return []


def years_of(period):
    p = str(period or "").lower()
    m = re.match(r"\s*(\d+)\s*(y|year|ปี)", p)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------- mapping
REGION_WORDS = [
    ("US", r"united states|สหรัฐ|\busa?\b|america"),
    ("EU", r"europe|ยุโรป|luxembourg|ireland|germany|france"),
    ("JP", r"japan|ญี่ปุ่น"),
    ("CN", r"china|จีน|hong kong|ฮ่องกง"),
    ("ASIA", r"asia|เอเชีย|singapore|india|vietnam|korea|taiwan"),
]


def map_region(profile):
    flag = str(profile.get("invest_country_flag") or "")
    if flag == "3":
        return "TH"
    text = " ".join(str(profile.get(k) or "") for k in ("feederfund_country", "proj_name_en", "proj_name_th"))
    for code, pattern in REGION_WORDS:
        if re.search(pattern, text, re.I):
            return code
    return "GLOBAL"


def map_asset_class(profile, region, risk_level):
    text = " ".join(str(profile.get(k) or "") for k in ("policy_desc", "proj_name_th", "proj_name_en"))
    if risk_level in (1, 2) or re.search(r"ตลาดเงิน|money market", text, re.I):
        return "money_market"
    if re.search(r"ทองคำ|gold|น้ำมัน|oil|สินค้าโภคภัณฑ์|commodit", text, re.I):
        return "commodity"
    if re.search(r"อสังหา|reit|โครงสร้างพื้นฐาน|infra|property", text, re.I):
        return "reit"
    if re.search(r"ผสม|mixed|balanced|allocation", text, re.I):
        return "mixed"
    if re.search(r"ตราสารหนี้|พันธบัตร|fixed income|bond", text, re.I):
        return "bond"
    if re.search(r"ตราสารทุน|หุ้น|equity", text, re.I):
        return "thai_equity" if region == "TH" else "global_equity"
    return "mixed"


def map_tax(profile, specs):
    text = " ".join([str(profile.get("fund_class_tax_incentive_type") or ""),
                     str(profile.get("proj_name_th") or ""), str(profile.get("proj_name_en") or "")] +
                    [f"{s.get('spec_code', '')} {s.get('spec_desc', '')}" for s in specs])
    if re.search(r"thai\s*esg|thaiesg|ไทยเพื่อความยั่งยืน", text, re.I):
        return "ThaiESG", 5
    if re.search(r"\bssf\b|เพื่อการออม", text, re.I):
        return "SSF", 10
    if re.search(r"\brmf\b|เลี้ยงชีพ", text, re.I):
        return "RMF", 5
    return "none", 0


def map_hedge(profile, stats, region):
    if region == "TH":
        return "na"
    text = str(profile.get("exchange_rate_protection_policy") or "")
    if text:
        if re.search(r"ดุลพินิจ|discretion", text, re.I):
            return "discretion"
        if re.search(r"ไม่ป้องกัน|ไม่มีการป้องกัน|ไม่ได้ป้องกัน|no hedg|unhedg", text, re.I):
            return "none"
        if re.search(r"บางส่วน|partial", text, re.I):
            return "partial"
        if re.search(r"ทั้งหมด|เต็ม|ไม่น้อยกว่า\s*(9\d|100)|full", text, re.I):
            return "full"
    fx = to_num(stats.get("fx_hedging")) if stats else None
    if fx is not None and fx > 0:
        return "full" if fx >= 90 else "partial"
    return "na"


def map_performance(rows):
    """Return fund/benchmark returns for 1/3/5y and the longest available fund SD."""
    out, sd_by_year = {}, {}
    for r in rows:
        desc = str(r.get("performance_type_desc") or "")
        y = years_of(r.get("reference_period"))
        val = to_num(r.get("performance_value"))
        if y not in (1, 3, 5) or val is None or re.search(r"ค่าเฉลี่ย|เปอร์เซ็นไทล์|percentile|peer", desc, re.I):
            continue
        is_bm = bool(re.search(r"ตัวชี้วัด|benchmark|ดัชนี", desc, re.I))
        if re.search(r"ผันผวน|volatil|standard deviation", desc, re.I):
            if not is_bm:
                sd_by_year[y] = val
        elif re.search(r"ผลการดำเนินงาน|ผลตอบแทน|return|performance", desc, re.I):
            out[("bm" if is_bm else "ret") + str(y)] = val
    for y in (5, 3, 1):
        if y in sd_by_year:
            out["sd"] = sd_by_year[y]
            break
    return out


def map_fees(fs_rows, general_rows, notes):
    fees = {}
    for r in fs_rows:
        desc = str(r.get("fee_type_desc") or "")
        val = to_num(r.get("actual_value"))
        if val is None:
            val = to_num(r.get("rate"))
        if val is None:
            continue
        if re.search(r"front", desc, re.I):
            fees["front"] = val
        elif re.search(r"back", desc, re.I):
            fees["back"] = val
        elif re.search(r"switching in|สับเปลี่ยน.*เข้า", desc, re.I):
            fees["switchFee"] = val
        elif re.search(r"total|ค่าใช้จ่ายรวม|ค่าธรรมเนียมรวม", desc, re.I):
            fees["ter"] = val
    if "ter" not in fees:
        for r in general_rows:
            if re.search(r"total|รวม", str(r.get("fee_type_desc") or ""), re.I) and to_num(r.get("rate")) is not None:
                fees["ter"] = to_num(r.get("rate"))
                notes.append("TER ใช้อัตราสูงสุดตามโครงการ (ค่าจริงมักต่ำกว่า) — ตรวจกับ Fact Sheet")
                break
    return fees


def fetch_fund(proj_id, cls):
    notes = []
    profiles = api_all("/v2/fund/general-info/profiles", {"project_info": proj_id})
    profiles = [p for p in profiles if p.get("proj_id") == proj_id]
    if not profiles:
        raise ApiError(404, f"ไม่พบกองทุน {proj_id}")
    profile = next((p for p in profiles if class_match(p, cls)), profiles[0])
    cls = cls or (profile.get("fund_class_name") or "")

    specs = safe(lambda: [s for s in api_all("/v2/fund/general-info/specifications", {"proj_id": proj_id})
                          if class_match(s, cls) or not s.get("fund_class_name")], notes, "ประเภทพิเศษ")
    risk = safe(lambda: factsheet("/v2/fund/factsheet/risk-spectrum", proj_id, class_level=False), notes, "ระดับความเสี่ยง")
    stats_rows = safe(lambda: factsheet("/v2/fund/factsheet/statistics", proj_id, cls), notes, "ข้อมูลสถิติ")
    fee_rows = safe(lambda: factsheet("/v2/fund/factsheet/fees", proj_id, cls), notes, "ค่าธรรมเนียม")
    gen_fee_rows = safe(lambda: [r for r in api_all("/v2/fund/general-info/mutual-fund-fees", {"proj_id": proj_id})
                                 if class_match(r, cls)], notes, "ค่าธรรมเนียมตามโครงการ")
    perf_rows = safe(lambda: factsheet("/v2/fund/factsheet/performance", proj_id, cls), notes, "ผลการดำเนินงาน")
    div_rows = safe(lambda: factsheet("/v2/fund/factsheet/dividend-policy", proj_id, cls), notes, "นโยบายปันผล")
    period_rows = safe(lambda: factsheet("/v2/fund/factsheet/subscription-redemption-periods", proj_id, cls), notes, "ระยะเวลาซื้อขาย")
    min_rows = safe(lambda: factsheet("/v2/fund/factsheet/subscription-redemption-minimums", proj_id, cls), notes, "มูลค่าซื้อขั้นต่ำ")
    top5 = safe(lambda: factsheet("/v2/fund/factsheet/top5-holdings", proj_id, class_level=False), notes, "5 อันดับแรก")
    today = date.today()
    nav_rows = safe(lambda: api_all("/v2/fund/daily-info/nav", {
        "proj_id": proj_id, "fund_class_name": cls if cls and cls != "main" else None,
        "start_nav_date": (today - timedelta(days=14)).isoformat(), "end_nav_date": today.isoformat()}), notes, "NAV")

    stats = stats_rows[0] if stats_rows else {}
    risk_level = None
    if risk:
        m = re.search(r"RS(\d)", str(risk[0].get("risk_spectrum") or ""))
        risk_level = int(m.group(1)) if m else None

    region = map_region(profile)
    tax, min_hold = map_tax(profile, specs)
    master = (profile.get("feederfund_master_fund") or "").strip()
    fund = {
        "name": (profile.get("proj_abbr_name") or "") + (f" ({cls})" if cls and cls != "main" else "")
                + " — " + (profile.get("proj_name_th") or profile.get("proj_name_en") or proj_id),
        "amc": re.sub(r"^บริษัทหลักทรัพย์จัดการกองทุน\s*|\s*จำกัด.*$", "", profile.get("comp_name_th") or ""),
        "assetClass": map_asset_class(profile, region, risk_level),
        "region": region,
        "taxType": tax,
        "feeder": bool(master),
        "master": master,
        "holdings": "",
        "top5": round(sum(to_num(h.get("asset_ratio")) or 0 for h in top5), 2) if top5 else "",
        "riskLevel": str(risk_level) if risk_level else "",
        "maxDD": abs(to_num(stats.get("maximum_drawdown"))) if to_num(stats.get("maximum_drawdown")) is not None else "",
        "trackErr": to_num(stats.get("tracking_error")) if to_num(stats.get("tracking_error")) else "",
        "hedge": map_hedge(profile, stats, region),
        "dividend": "yes" if div_rows and str(div_rows[0].get("dividend_policy")).upper() == "Y" else ("no" if div_rows else "no"),
        "minHold": min_hold or "",
    }
    fund.update(map_fees(fee_rows, gen_fee_rows, notes))
    fund.update(map_performance(perf_rows))

    red = [r for r in period_rows if str(r.get("type")).lower() == "redemption"]
    if red and to_num(red[0].get("settlement_period")) is not None:
        fund["settle"] = to_num(red[0].get("settlement_period"))
    if min_rows:
        v = to_num(min_rows[0].get("minimum_sub"))
        if v is not None and "THB" in str(min_rows[0].get("minimum_sub_cur") or "THB").upper():
            fund["minBuy"] = v
    navs = sorted((n for n in nav_rows if class_match(n, cls) or not cls), key=lambda n: n.get("nav_date") or "")
    if navs and to_num(navs[-1].get("net_asset")):
        fund["aum"] = round(to_num(navs[-1]["net_asset"]) / 1e6, 1)

    if fund["feeder"] and isinstance(fund["top5"], float) and fund["top5"] > 80:
        notes.append("5 อันดับแรกคือกองหลัก — ความกระจุกตัวจริงต้องดูจาก Fact Sheet ของกองหลัก")
    if min_hold:
        notes.append(f"ระยะถือขั้นต่ำ {min_hold} ปี อนุมานจากประเภทกอง {tax} — ตรวจเงื่อนไขล่าสุดอีกครั้ง")
    if fund["region"] != "TH" and fund["hedge"] == "na":
        notes.append("ไม่พบนโยบายป้องกันค่าเงิน")

    labels = {"riskLevel": "ระดับความเสี่ยง", "maxDD": "Max Drawdown", "sd": "SD", "ter": "TER",
              "ret1": "ผลตอบแทน 1 ปี", "ret5": "ผลตอบแทน 5 ปี", "aum": "ขนาดกอง", "settle": "T+ รับเงินคืน"}
    missing = [label for k, label in labels.items() if fund.get(k) in ("", None)]
    asof = max([r.get("start_date") or "" for r in stats_rows + fee_rows + perf_rows + risk] or [""])
    fund["sec"] = {"projId": proj_id, "cls": cls, "asOf": asof, "fetched": today.isoformat(),
                   "notes": notes, "missing": missing}
    return fund


def profile_summary(p):
    return {
        "projId": p.get("proj_id"), "cls": p.get("fund_class_name") or "",
        "abbr": p.get("proj_abbr_name") or "", "nameTh": p.get("proj_name_th") or "",
        "nameEn": p.get("proj_name_en") or "", "amc": p.get("comp_name_th") or "",
        "classDesc": p.get("fund_class_description") or p.get("fund_class_detail") or "",
        "policy": p.get("policy_desc") or "", "retail": p.get("proj_retail_type") or "",
    }


def is_active(p):
    return p.get("fund_status") in ("Registered", "IPO")


def search(q):
    rows = api_all("/v2/fund/general-info/profiles", {"project_info": q}, max_pages=5)
    return [profile_summary(p) for p in rows if is_active(p)][:150]


# ---------------------------------------------------------------- server
class Handler(BaseHTTPRequestHandler):
    # Only these files are ever served; everything else (the key file, scripts) is 404.
    STATIC = {
        "/": ("index.html", "text/html; charset=utf-8"),
        "/index.html": ("index.html", "text/html; charset=utf-8"),
        "/app.js": ("app.js", "text/javascript; charset=utf-8"),
        "/vendor/chart.umd.min.js": ("vendor/chart.umd.min.js", "text/javascript; charset=utf-8"),
        "/data/funds.json": ("data/funds.json", "application/json; charset=utf-8"),
    }
    ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
    server_version = "FundScreener"
    sys_version = ""

    def log_message(self, fmt, *args):
        sys.stderr.write("  " + (fmt % args) + "\n")

    def security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                         "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")

    def send_bytes(self, status, body, ctype, head_only=False):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers()
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def send_json(self, status, obj):
        self.send_bytes(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def host_ok(self):
        # Blocks DNS-rebinding: a hostile site pointing its own domain at 127.0.0.1 sends its own Host header.
        return (self.headers.get("Host") or "").lower() in self.ALLOWED_HOSTS

    def api_request_ok(self):
        # Cross-site pages cannot add a custom header without a CORS preflight, which this server never approves.
        if self.headers.get("X-Fund-Screener") != "1":
            return False
        site = self.headers.get("Sec-Fetch-Site")
        return site in (None, "same-origin", "none")

    def serve_static(self, path, head_only=False):
        entry = self.STATIC.get(path)
        if not entry:
            return self.send_bytes(404, b"not found", "text/plain; charset=utf-8", head_only)
        try:
            with open(os.path.join(HERE, *entry[0].split("/")), "rb") as f:
                body = f.read()
        except OSError:
            return self.send_bytes(404, b"not found", "text/plain; charset=utf-8", head_only)
        return self.send_bytes(200, body, entry[1], head_only)

    def do_HEAD(self):
        if not self.host_ok():
            return self.send_bytes(403, b"forbidden", "text/plain; charset=utf-8", True)
        return self.serve_static(urllib.parse.urlparse(self.path).path, head_only=True)

    def do_GET(self):
        if not self.host_ok():
            return self.send_bytes(403, b"forbidden", "text/plain; charset=utf-8")
        url = urllib.parse.urlparse(self.path)
        if not url.path.startswith("/api/"):
            return self.serve_static(url.path)
        if not self.api_request_ok():
            return self.send_json(403, {"error": "forbidden"})
        qs = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            if url.path == "/api/health":
                return self.send_json(200, {"ok": True, "hasKey": bool(load_keys())})
            if url.path == "/api/search":
                q = qs.get("q", "").strip()[:100]
                if len(q) < 2:
                    return self.send_json(400, {"error": "พิมพ์อย่างน้อย 2 ตัวอักษร"})
                return self.send_json(200, {"items": search(q)})
            if url.path == "/api/fund":
                proj_id = qs.get("proj_id", "")
                if not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", proj_id):
                    return self.send_json(400, {"error": "proj_id ไม่ถูกต้อง"})
                return self.send_json(200, {"fund": fetch_fund(proj_id, qs.get("cls", "")[:60])})
            return self.send_json(404, {"error": "not found"})
        except ApiError as e:
            return self.send_json(e.status if 400 <= e.status < 600 else 502, {"error": str(e)})
        except Exception as e:
            sys.stderr.write(f"  ! {type(e).__name__}: {e}\n")
            return self.send_json(500, {"error": "เกิดข้อผิดพลาดภายในโปรแกรม ดูรายละเอียดในหน้าต่าง start.bat"})

    def do_POST(self):
        self.send_bytes(405, b"method not allowed", "text/plain; charset=utf-8")

    do_PUT = do_DELETE = do_OPTIONS = do_PATCH = do_POST


def main():
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252 and choke on Thai
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    if not os.path.exists(CONFIG_PATH) and not os.environ.get("SEC_API_KEY"):
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            f.write('{\n  "primary_key": "",\n  "secondary_key": ""\n}\n')
    if not load_keys():
        print("! ยังไม่พบ API Key — เปิดไฟล์ sec-config.json แล้วใส่ primary_key ก่อน (หรือตั้ง SEC_API_KEY)")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"โปรแกรมคัดกรองกองทุนพร้อมใช้งานที่ {url}  (กด Ctrl+C เพื่อปิด)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
