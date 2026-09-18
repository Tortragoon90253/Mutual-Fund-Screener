/* ============ constants ============ */
const ASSET = {
  global_equity:{label:'หุ้นต่างประเทศ', exp:7, sd:16, equity:true},
  thai_equity:{label:'หุ้นไทย', exp:5, sd:18, equity:true},
  mixed:{label:'กองทุนผสม', exp:5, sd:10, equity:true},
  reit:{label:'อสังหา/REIT/โครงสร้างพื้นฐาน', exp:5, sd:14, equity:true},
  commodity:{label:'ทองคำ/สินค้าโภคภัณฑ์', exp:4, sd:15, equity:true},
  bond:{label:'ตราสารหนี้', exp:3, sd:5, equity:false},
  money_market:{label:'ตลาดเงิน', exp:1.5, sd:1, equity:false}
};
/* ชนะตัวเทียบกี่ปีจากกี่ปีปฏิทิน — วัดความสม่ำเสมอได้ตรงกว่าตัวเลขย้อนหลัง 5 ปีตัวเดียว
   เพราะกองที่แพ้ 4 ปีแล้วมาชนะปีเดียวแรงๆ ให้ค่าเฉลี่ย 5 ปีเท่ากับกองที่ชนะสม่ำเสมอได้
   ตัวเทียบใช้ดัชนีชี้วัดของปีนั้นก่อน ไม่มีจึงใช้ค่าเฉลี่ยกลุ่ม */
const BAT_MIN_YEARS = 3;
function battingAvg(f){
  const sec = f.sec; if (!sec) return null;
  const cal = sec.cal || {}, bm = sec.calBm || {}, peer = {};
  (sec.peer || []).forEach(p=>{ if (/^20\d\d$/.test(p[1])) peer[p[1]] = p[2]; });
  let years = 0, wins = 0;
  Object.keys(cal).forEach(y=>{
    const ref = bm[y] !== undefined ? bm[y] : peer[y];
    if (ref === undefined) return;
    years++; if (cal[y] >= ref) wins++;
  });
  return years >= BAT_MIN_YEARS ? {years, wins} : null;
}
/* จุดตัด TER แยกตามประเภทสินทรัพย์ [p10, p25, p50, p75, p90, จำนวนกอง]
   ใช้เมื่อยังไม่ได้โหลด data/index.json (ซึ่งมีค่าที่คำนวณสดทุกรอบ build)
   คำนวณจากข้อมูล ก.ล.ต. 4,923 ชนิดหน่วยลงทุน (ก.ย. 2026) */
const TER_PCT = {
  global_equity:[0.71,1.32,1.84,2.895,5.0,2117], thai_equity:[0.611,1.29,1.87,2.33,3.21,692],
  mixed:[0.792,1.2,1.76,2.895,5.35,987],         reit:[1.17,1.279,1.675,2.452,5.0,171],
  commodity:[0.53,0.73,1.275,1.952,3.21,96],     bond:[0.19,0.41,0.8,1.98,4.807,604],
  money_market:[0.13,0.19,0.29,0.38,0.732,85]
};
/* Sharpe แยกตามประเภทสินทรัพย์ — คนละสเกลกันสิ้นเชิง กองตราสารหนี้ p90 ถึง 8.95
   ส่วนกองหุ้นไทย p50 แค่ 0.17 จึงเทียบข้ามประเภทไม่ได้ (ก.ย. 2026) */
const SHARPE_PCT = {
  global_equity:[-0.179,0.08,0.36,0.777,0.97,1194], thai_equity:[-0.305,-0.03,0.171,0.37,1.039,498],
  mixed:[-0.136,0.131,0.534,0.81,1.18,256],         reit:[0.054,0.19,0.358,0.56,0.63,65],
  bond:[-0.114,0.182,0.68,1.782,3.486,90]
};
const breaksFor = (tbl, key, ac) => (secStatic && secStatic[key] && secStatic[key][ac]) || tbl[ac] || null;
const terBreaks = ac => breaksFor(TER_PCT, 'terPct', ac);
const sharpeBreaks = ac => breaksFor(SHARPE_PCT, 'sharpePct', ac);
// อันดับในกลุ่มเดียวกัน: 0 = ต่ำสุด, 100 = สูงสุด (รับค่าติดลบได้)
function pctRank(v, br){
  const pts = [[br[0],10],[br[1],25],[br[2],50],[br[3],75],[br[4],90]];
  if (v <= br[0]) return clamp(10 - 10*(br[0]-v)/Math.max(br[1]-br[0], 1e-6), 0, 10);
  for (let i=1;i<pts.length;i++){
    const [x0,y0]=pts[i-1], [x1,y1]=pts[i];
    if (v<=x1) return x1===x0 ? y1 : y0 + (y1-y0)*(v-x0)/(x1-x0);
  }
  return clamp(90 + 10*(v-br[4])/Math.max(br[4]-br[3], 1e-6), 90, 100);
}
const DONUT = ['--d1','--d2','--d3','--d4','--d5','--d6','--d7'];  // สีของ donut พอร์ตกองทุน
const REGION = {TH:'ไทย', US:'สหรัฐฯ', GLOBAL:'ทั่วโลก', EU:'ยุโรป', ASIA:'เอเชีย', CN:'จีน', JP:'ญี่ปุ่น', EM:'ตลาดเกิดใหม่', OTHER:'อื่นๆ'};
const HEDGE = {full:'ป้องกันเต็มจำนวน', partial:'ป้องกันบางส่วน', discretion:'ตามดุลพินิจผู้จัดการ', none:'ไม่ป้องกัน', na:'ไม่ทราบ'};
const TAX = {none:'ไม่ใช่กองลดหย่อน', SSF:'SSF', RMF:'RMF', ThaiESG:'Thai ESG'};
const CRIT = [
  {k:'c1', name:'เป้าหมาย', w:15},
  {k:'c2', name:'ลงทุนในอะไร', w:10},
  {k:'c3', name:'ความเสี่ยง', w:15},
  {k:'c4', name:'ค่าธรรมเนียม', w:20},
  {k:'c5', name:'ผลตอบแทนย้อนหลัง', w:10},
  {k:'c6', name:'ค่าเงิน (Hedging)', w:10},
  {k:'c7', name:'นโยบายปันผล', w:10},
  {k:'c8', name:'สภาพคล่อง', w:10}
];
const opts = o => Object.entries(o).map(([v,l])=>({v,l}));
const FIELDS = [
  {g:'ข้อมูลทั่วไป', f:[
    {k:'name', l:'ชื่อกองทุน *', t:'text', req:true},
    {k:'amc', l:'บลจ.', t:'text'},
    {k:'assetClass', l:'ประเภทสินทรัพย์', t:'select', o:Object.entries(ASSET).map(([v,a])=>({v,l:a.label}))},
    {k:'region', l:'ภูมิภาคที่ลงทุน', t:'select', o:opts(REGION)},
    {k:'taxType', l:'สิทธิลดหย่อนภาษี', t:'select', o:opts(TAX)}
  ]},
  {g:'② ลงทุนในอะไร', f:[
    {k:'feeder', l:'เป็น Feeder Fund (ลงทุนผ่านกองหลัก)', t:'check'},
    {k:'master', l:'ชื่อกองหลัก / ETF ที่ลงทุน', t:'text'},
    {k:'holdings', l:'จำนวนหลักทรัพย์ที่ถือ', t:'number', step:1},
    {k:'top5', l:'สัดส่วน 5 อันดับแรก (%)', t:'number', step:0.1}
  ]},
  {g:'③ ระดับความเสี่ยง', f:[
    {k:'riskLevel', l:'ระดับความเสี่ยง (1–8)', t:'select', o:[{v:'',l:'ไม่ทราบ'}].concat([1,2,3,4,5,6,7,8].map(v=>({v:String(v),l:String(v)})))},
    {k:'maxDD', l:'ขาดทุนสูงสุด Max Drawdown (%)', t:'number', step:0.1, hint:'ใส่เป็นตัวเลขบวก เช่น 34'},
    {k:'sd', l:'ความผันผวน SD (% ต่อปี)', t:'number', step:0.1}
  ]},
  {g:'④ ค่าธรรมเนียมทั้งหมด', f:[
    {k:'front', l:'ค่าธรรมเนียมขาย Front-end (%)', t:'number', step:0.01},
    {k:'back', l:'ค่าธรรมเนียมรับซื้อคืน Back-end (%)', t:'number', step:0.01},
    {k:'switchFee', l:'ค่าธรรมเนียมสับเปลี่ยน (%)', t:'number', step:0.01},
    {k:'ter', l:'ค่าใช้จ่ายรวม TER (% ต่อปี)', t:'number', step:0.01, hint:'Feeder Fund: รวมค่าธรรมเนียมกองหลักด้วย'}
  ]},
  {g:'⑤ ผลตอบแทนย้อนหลัง เทียบดัชนีชี้วัด (% ต่อปี)', f:[
    {k:'ret1', l:'กองทุน 1 ปี', t:'number', step:0.01}, {k:'bm1', l:'ดัชนีชี้วัด 1 ปี', t:'number', step:0.01},
    {k:'ret3', l:'กองทุน 3 ปี', t:'number', step:0.01}, {k:'bm3', l:'ดัชนีชี้วัด 3 ปี', t:'number', step:0.01},
    {k:'ret5', l:'กองทุน 5 ปี', t:'number', step:0.01}, {k:'bm5', l:'ดัชนีชี้วัด 5 ปี', t:'number', step:0.01},
    {k:'trackErr', l:'Tracking Error (%) — กองดัชนี', t:'number', step:0.01},
    {k:'sharpe', l:'Sharpe Ratio', t:'number', step:0.01, hint:'ผลตอบแทนส่วนเพิ่มต่อความเสี่ยง 1 หน่วย — ยิ่งสูงยิ่งดี'}
  ]},
  {g:'⑥ ป้องกันความเสี่ยงค่าเงิน', f:[
    {k:'hedge', l:'นโยบาย Hedging', t:'select', o:opts(HEDGE)}
  ]},
  {g:'⑦ นโยบายปันผล', f:[
    {k:'dividend', l:'จ่ายปันผลหรือไม่', t:'select', o:[{v:'no',l:'ไม่จ่ายปันผล (สะสมมูลค่า)'},{v:'yes',l:'จ่ายปันผล'}]}
  ]},
  {g:'⑧ สภาพคล่อง & เงื่อนไขซื้อขาย', f:[
    {k:'aum', l:'ขนาดกองทุน (ล้านบาท)', t:'number', step:1},
    {k:'settle', l:'ได้เงินคืนภายใน T+ (วันทำการ)', t:'number', step:1},
    {k:'minBuy', l:'ซื้อขั้นต่ำ (บาท)', t:'number', step:1},
    {k:'minHold', l:'ต้องถือขั้นต่ำ (ปี)', t:'number', step:1, hint:'เช่น SSF 10 ปี, Thai ESG 5 ปี'}
  ]},
  {g:'สมมติฐานสำหรับการคาดการณ์', f:[
    {k:'expReturn', l:'ผลตอบแทนตลาดคาดหวัง (% ต่อปี)', t:'number', step:0.1, hint:'ก่อนหัก TER · เว้นว่าง = ค่าเริ่มต้นตามประเภทสินทรัพย์'},
    {k:'notes', l:'บันทึกเพิ่มเติม', t:'text'}
  ]}
];
const DEFAULT_FUND = {name:'',amc:'',assetClass:'global_equity',region:'US',taxType:'none',feeder:false,master:'',riskLevel:'6',hedge:'discretion',dividend:'no'};

const SAMPLES = [
  {name:'ตัวอย่าง: กองดัชนีหุ้นสหรัฐฯ ค่าธรรมเนียมต่ำ', amc:'บลจ. สมมติ A', assetClass:'global_equity', region:'US', taxType:'none', feeder:true, master:'ETF ดัชนี S&P 500', holdings:500, top5:25, riskLevel:'6', maxDD:34, sd:17, front:0, back:0, switchFee:0, ter:0.45, ret1:22, bm1:23, ret3:10, bm3:10.5, ret5:14, bm5:14.5, trackErr:0.6, hedge:'discretion', dividend:'no', aum:25000, settle:4, minBuy:1, minHold:0},
  {name:'ตัวอย่าง: กองหุ้นเทคโนโลยีโลก (Active)', amc:'บลจ. สมมติ B', assetClass:'global_equity', region:'GLOBAL', taxType:'none', feeder:true, master:'Global Tech Active Fund', holdings:40, top5:42, riskLevel:'7', maxDD:45, sd:25, front:1.5, back:0, switchFee:0, ter:1.9, ret1:30, bm1:25, ret3:5, bm3:8, ret5:12, bm5:13, hedge:'none', dividend:'no', aum:3000, settle:5, minBuy:1000, minHold:0},
  {name:'ตัวอย่าง: กองตราสารหนี้ทั่วโลก', amc:'บลจ. สมมติ C', assetClass:'bond', region:'GLOBAL', taxType:'none', feeder:true, master:'Global Aggregate Bond Fund', holdings:800, top5:8, riskLevel:'4', maxDD:8, sd:5, front:0, back:0, switchFee:0, ter:0.7, ret1:3, bm1:3.2, ret3:0.5, bm3:0.8, ret5:1.5, bm5:1.4, hedge:'full', dividend:'no', aum:8000, settle:5, minBuy:1, minHold:0},
  {name:'ตัวอย่าง: กองหุ้นไทยปันผล', amc:'บลจ. สมมติ D', assetClass:'thai_equity', region:'TH', taxType:'none', feeder:false, master:'', holdings:35, top5:38, riskLevel:'6', maxDD:30, sd:17, front:1, back:0, switchFee:0, ter:1.6, ret1:-5, bm1:-3, ret3:-3, bm3:-2, ret5:1, bm5:2, hedge:'na', dividend:'yes', aum:400, settle:3, minBuy:1000, minHold:0}
];

/* ============ state ============ */
const KEY = 'fundScreener.v1';
let state = load() || freshState();
function freshState(){
  return {
    profile:{goal:'wealth', years:10, riskTol:'6', lump:100000, monthly:5000, inflation:2, mode:'mix'},
    funds: SAMPLES.map(s=>({...s, id:uid(), sample:true})),
    weights: Object.fromEntries(CRIT.map(c=>[c.k,c.w])),
    portfolio:{}, holdings:{}, showReal:false
  };
}
function load(){ try{ return sanitizeState(JSON.parse(localStorage.getItem(KEY))); }catch(e){ return null; } }
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
function uid(){ return Math.random().toString(36).slice(2,10); }

/* ============ input sanitising ============
   Everything that comes from outside (localStorage, imported JSON, SEC data) is rebuilt
   field by field into known types, so no foreign markup or property can reach the page. */
function cleanNum(v, min=-1e12, max=1e12){ const n = parseFloat(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : ''; }
function cleanStr(v, max=300){ return (typeof v==='string' || typeof v==='number') ? String(v).slice(0, max) : ''; }
function cleanEnum(v, allowed, dflt){ return allowed.includes(String(v)) ? String(v) : dflt; }
function cleanId(v){ return /^[a-z0-9]{4,16}$/.test(v) ? v : uid(); }
function sanitizeFund(f){
  if (!f || typeof f!=='object') return null;
  const out = {};
  FIELDS.forEach(g=>g.f.forEach(fld=>{
    const v = f[fld.k];
    if (fld.t==='check') out[fld.k] = v===true;
    else if (fld.t==='number') out[fld.k] = cleanNum(v);
    else if (fld.t==='select') out[fld.k] = cleanEnum(v, fld.o.map(o=>o.v), DEFAULT_FUND[fld.k] ?? fld.o[0].v);
    else out[fld.k] = cleanStr(v, fld.k==='notes' ? 1000 : 300);
  }));
  if (!out.name) return null;
  out.id = cleanId(f.id);
  out.sample = f.sample===true;
  if (f.sec && typeof f.sec==='object'){
    const s = f.sec, list = a => Array.isArray(a) ? a.slice(0,30).map(x=>cleanStr(x,300)).filter(Boolean) : [];
    // [[ชื่อทรัพย์สิน, %NAV], ...] from the SEC fact sheet — drawn as the portfolio donut
    const slices = a => Array.isArray(a) ? a.slice(0,20)
      .map(x=>Array.isArray(x) ? [cleanStr(x[0],80), cleanNum(x[1],0,100)] : null)
      .filter(x=>x && x[0] && x[1] !== '' && x[1] > 0) : [];
    const years = o => { const out={};
      if (o && typeof o==='object') Object.entries(o).slice(0,20).forEach(([k,v])=>{
        if (/^20\d\d$/.test(k) && cleanNum(v,-100,1000)!=='') out[k]=cleanNum(v,-100,1000); });
      return out; };
    const peerRows = a => Array.isArray(a) ? a.slice(0,40)
      .map(x=>Array.isArray(x) ? [cleanStr(x[0],80), cleanStr(x[1],20), cleanNum(x[2],-100,1000)] : null)
      .filter(x=>x && x[1] && x[2]!=='') : [];
    const price = o => { if (!o || typeof o!=='object') return {};
      const out = {navDate: cleanStr(o.navDate,20)};
      ['nav','sell','buy'].forEach(k=>{ const v = cleanNum(o[k],0,1e7); if (v!=='' && v>0) out[k]=v; });
      return out.nav ? out : {}; };
    const stats = o => { const out={};
      if (o && typeof o==='object') Object.entries(o).slice(0,12).forEach(([k,v])=>{
        if (/^[a-z_]{1,40}$/.test(k) && v!=='' && v!=null) out[k]=cleanStr(v,40); });
      return out; };
    out.sec = {projId:cleanStr(s.projId,40), cls:cleanStr(s.cls,60), asOf:cleanStr(s.asOf,20), fetched:cleanStr(s.fetched,20), notes:list(s.notes), missing:list(s.missing),
               alloc:slices(s.alloc), top5:slices(s.top5), portAsOf:cleanStr(s.portAsOf,20), stats:stats(s.stats),
               cal:years(s.cal), calBm:years(s.calBm), peer:peerRows(s.peer), price:price(s.price)};
    if (!out.sec.projId) delete out.sec;
  }
  return out;
}
function sanitizeState(s){
  if (!s || typeof s!=='object' || !Array.isArray(s.funds)) return null;
  const base = freshState(), p = s.profile || {};
  const funds = s.funds.slice(0,500).map(sanitizeFund).filter(Boolean);
  const seen = new Set(); funds.forEach(f=>{ while (seen.has(f.id)) f.id = uid(); seen.add(f.id); });
  const portfolio = {};
  if (s.portfolio && typeof s.portfolio==='object') Object.entries(s.portfolio).forEach(([k,v])=>{ if (seen.has(k)) portfolio[k] = cleanNum(v,0,100000) || 0; });
  // holdings = สิ่งที่ถืออยู่จริง {fundId:{u:จำนวนหน่วย, c:ต้นทุนต่อหน่วย}}
  // portfolio = สัดส่วน % ที่วางแผนไว้ — คนละเรื่องกัน อย่ารวมกัน
  const holdings = {};
  if (s.holdings && typeof s.holdings==='object') Object.entries(s.holdings).forEach(([k,v])=>{
    if (!seen.has(k) || !v || typeof v!=='object') return;
    const u = cleanNum(v.u,0,1e12), c = cleanNum(v.c,0,1e9);
    if (u!=='' && u>0) holdings[k] = {u, c: c===''?0:c};
  });
  const weights = {};
  CRIT.forEach(c=>{ const w = cleanNum(s.weights?.[c.k],0,100); weights[c.k] = w==='' ? c.w : w; });
  return {
    profile:{
      goal: cleanEnum(p.goal, ['wealth','retire','income','tax','short'], base.profile.goal),
      years: cleanNum(p.years,1,50) || base.profile.years,
      riskTol: cleanEnum(p.riskTol, ['1','2','3','4','5','6','7','8'], base.profile.riskTol),
      lump: cleanNum(p.lump,0,1e12) === '' ? base.profile.lump : cleanNum(p.lump,0,1e12),
      monthly: cleanNum(p.monthly,0,1e10) === '' ? base.profile.monthly : cleanNum(p.monthly,0,1e10),
      inflation: cleanNum(p.inflation,0,50) === '' ? base.profile.inflation : cleanNum(p.inflation,0,50),
      mode: cleanEnum(p.mode, ['lump','dca','mix'], base.profile.mode)
    },
    funds, weights, portfolio, holdings, showReal: s.showReal===true
  };
}

/* ============ helpers ============ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const has = v => v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));
const num = (v, d=0) => has(v) ? parseFloat(v) : d;
const clamp = (x,a,b) => Math.max(a, Math.min(b, x));
const fmtB = n => Math.round(n).toLocaleString('th-TH') + ' ฿';
const fmtShort = n => { const a=Math.abs(n); return a>=1e6 ? (n/1e6).toFixed(a>=1e7?1:2)+' ล้าน' : a>=1e3 ? Math.round(n/1e3).toLocaleString('th-TH')+' พัน' : Math.round(n).toString(); };
const pct = (n,d=1) => (n>=0?'':'−') + Math.abs(n).toFixed(d) + '%';
const cls = s => s>=75 ? 's-good' : s>=50 ? 's-warn' : 's-bad';
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ============ screening ============ */
function evaluate(f, p){
  const a = ASSET[f.assetClass] || ASSET.mixed;
  const foreign = f.region !== 'TH';
  const years = num(p.years, 1), tol = num(p.riskTol, 6);
  const out = {fails:[], crit:{}};
  const C = (k, score, reasons) => out.crit[k] = {score: clamp(Math.round(score),0,100), reasons};
  const R = (lvl,t) => ({lvl,t});

  // 1 goal
  { let s=100; const r=[];
    if (years < 3 && a.equity){ s=20; r.push(R('bad',`ลงทุนแค่ ${years} ปี สั้นเกินไปสำหรับ${a.label}`)); out.fails.push('ระยะเวลาสั้นเกินไปสำหรับสินทรัพย์เสี่ยง'); }
    else if (years < 5 && a.equity){ s=60; r.push(R('warn',`ระยะ 3–5 ปี ${a.label}ยังผันผวนได้มาก`)); }
    if ((p.goal==='wealth'||p.goal==='retire') && !a.equity && years>=7){ s=Math.min(s,70); r.push(R('warn',`ลงทุนระยะยาวแต่เป็น${a.label} ผลตอบแทนอาจโตไม่ทันเงินเฟ้อ`)); }
    if (p.goal==='short' && a.equity){ s=Math.min(s,30); r.push(R('bad','เงินระยะสั้นไม่ควรอยู่ในสินทรัพย์ที่ราคาผันผวนสูง')); }
    if (p.goal==='tax'){ if (f.taxType==='none'){ s=Math.min(s,40); r.push(R('warn','เป้าหมายคือลดหย่อนภาษี แต่กองนี้ไม่ใช่กองลดหย่อน')); } else r.push(R('good',`เป็นกอง ${TAX[f.taxType]} ใช้ลดหย่อนภาษีได้`)); }
    if (!r.length) r.push(R('good',`${a.label} เหมาะกับเป้าหมายและระยะ ${years} ปี`));
    C('c1', s, r); }

  // 2 composition
  { let s; const r=[]; const h=num(f.holdings,NaN);
    if (isNaN(h)){ s=60; r.push(R('warn','ไม่ได้ระบุจำนวนหลักทรัพย์ — ควรเปิด Fact Sheet ดูว่ากองถืออะไร')); }
    else if (h>=100){ s=100; r.push(R('good',`กระจายการลงทุนดี ถือ ${h.toLocaleString()} ตัว`)); }
    else if (h>=30){ s=80; r.push(R('good',`ถือ ${h} ตัว กระจายตัวพอสมควร`)); }
    else if (h>=10){ s=60; r.push(R('warn',`ถือเพียง ${h} ตัว`)); }
    else { s=40; r.push(R('bad',`ถือเพียง ${h} ตัว กระจุกตัวมาก`)); }
    if (has(f.top5)){
      // ตลาดเงิน/ตราสารหนี้ถือตราสารระยะสั้นคุณภาพสูงไม่กี่ตัวเป็นเรื่องปกติ —
      // ความเสี่ยงอยู่ที่คุณภาพผู้ออกตราสาร ไม่ใช่จำนวนตัว จึงใช้เพดานคนละระดับกับกองที่ถือหุ้น
      const lim = a.equity ? 35 : 70;
      if (f.feeder && num(f.top5)>80) r.push(R('warn',`5 อันดับแรก ${f.top5}% คือกองหลัก — ดูความกระจุกตัวจาก Fact Sheet ของกองหลัก`));
      else if (num(f.top5)>lim){ s-=30; r.push(R('warn',`5 อันดับแรกรวม ${f.top5}% — กระจุกตัวสูง`)); }
      else if (!a.equity && num(f.top5)>35) r.push(R('good',`5 อันดับแรกรวม ${f.top5}% — ปกติสำหรับ${a.label} สิ่งที่ต้องดูคือคุณภาพผู้ออกตราสาร`));
      else r.push(R('good',`5 อันดับแรกรวม ${f.top5}%`)); }
    if (f.feeder){ if (!f.master){ s-=10; r.push(R('warn','เป็น Feeder Fund แต่ไม่ได้ระบุกองหลัก')); } else r.push(R('good',`Feeder Fund ลงทุนผ่าน ${f.master}`)); }
    C('c2', s, r); }

  // 3 risk
  { let s=100; const r=[]; const known = has(f.riskLevel); const lvl=num(f.riskLevel,0);
    if (!known){ s=50; r.push(R('warn','ไม่ทราบระดับความเสี่ยง — ดูจาก Fact Sheet แล้วเลือกในฟอร์ม (ยังไม่ถูกคัดออก)')); }
    else if (lvl>tol){ s=0; r.push(R('bad',`ความเสี่ยงระดับ ${lvl} สูงกว่าที่รับได้ (${tol})`)); out.fails.push(`ความเสี่ยงระดับ ${lvl} เกินที่รับได้`); }
    else r.push(R('good',`ความเสี่ยงระดับ ${lvl} ไม่เกินที่รับได้ (${tol})`));
    const allowed = tol*7;
    if (has(f.maxDD)){ const dd=Math.abs(num(f.maxDD)); const ratio=dd/allowed;
      const ds = clamp(100-Math.max(0,ratio-0.5)*100,0,100); if (known && lvl<=tol) s=ds; else if (!known) s=Math.min(50, ds);
      r.push(R(ratio>1?'bad':ratio>0.8?'warn':'good',`เคยขาดทุนสูงสุด −${dd}% (ระดับที่รับได้ประมาณ −${allowed}%) — ถ้าเจอแบบนี้อีกจะถือต่อไหวไหม?`)); }
    else { if (known && lvl<=tol) s=70; r.push(R('warn','ไม่ได้ระบุ Max Drawdown')); }
    C('c3', s, r); }

  // 4 fees
  { let s; const r=[]; const ter=num(f.ter,NaN), front=num(f.front), back=num(f.back);
    const br = terBreaks(f.assetClass);
    if (isNaN(ter)){ s=40; r.push(R('warn','ไม่ได้ระบุ TER — ค่าใช้จ่ายรวมคือสิ่งสำคัญที่สุดข้อหนึ่ง')); }
    else if (br){
      // เทียบภายในกลุ่มสินทรัพย์เดียวกัน เพราะเส้นตายตัวข้ามกลุ่มให้คะแนนกลับหัว:
      // TER 0.5% ทำให้กองตลาดเงิน 86% ได้เต็ม แต่กองหุ้นต่างประเทศได้แค่ 7%
      const rank = pctRank(ter, br); s = Math.round(100-rank);
      r.push(R(rank<=33?'good':rank<=75?'warn':'bad',
        `TER ${ter}% ต่อปี — ถูกกว่า ${s}% ของกองประเภทเดียวกัน (${a.label} ${br[5].toLocaleString()} กอง)`)); }
    else if (ter<=0.5){ s=100; r.push(R('good',`TER ${ter}% ต่อปี ต่ำมาก`)); }
    else if (ter<=1){ s=80; r.push(R('good',`TER ${ter}% ต่อปี อยู่ในเกณฑ์ดี`)); }
    else if (ter<=1.5){ s=55; r.push(R('warn',`TER ${ter}% ต่อปี ค่อนข้างสูง`)); }
    else { s=25; r.push(R('bad',`TER ${ter}% ต่อปี สูง — กินผลตอบแทนทุกปีไม่ว่ากองจะกำไรหรือขาดทุน`)); }
    if (front+back>1.5){ s-=15; r.push(R('bad',`ค่าธรรมเนียมซื้อ+ขายรวม ${(front+back).toFixed(2)}%`)); }
    else if (front+back>0){ s-=5; r.push(R('warn',`มีค่าธรรมเนียมซื้อ ${front}% / ขาย ${back}%`)); }
    else r.push(R('good','ไม่มีค่าธรรมเนียมซื้อ/ขาย'));
    if (f.feeder && !isNaN(ter)) r.push(R('warn','Feeder Fund: ตรวจว่า TER รวมค่าธรรมเนียมของกองหลักแล้ว'));
    if (!isNaN(ter)){ const cost = 100000*(front/100) + 100000*(ter/100)*years; r.push(R('warn',`ประมาณการค่าใช้จ่ายต่อเงินลงทุน 100,000 บาท ใน ${years} ปี ≈ ${fmtB(cost)}`)); }
    C('c4', s, r); }

  // 5 past performance
  { const r=[]; const per=[['ret1','bm1','1 ปี'],['ret3','bm3','3 ปี'],['ret5','bm5','5 ปี']].filter(([x,y])=>has(f[x])&&has(f[y]));
    let s;
    const bat = battingAvg(f);
    per.forEach(([x,y,l])=>{ const d=num(f[x])-num(f[y]);
      r.push(R(d>=0?'good':'warn',`${l}: กอง ${pct(num(f[x]),2)} vs ดัชนี ${pct(num(f[y]),2)} (${d>=0?'ชนะ':'แพ้'} ${Math.abs(d).toFixed(2)}%)`)); });
    if (bat){   // อัตราชนะรายปีวัดเรื่องเดียวกันแต่ละเอียดกว่า จึงใช้แทนเมื่อมีข้อมูลพอ
      s = 30 + 70*bat.wins/bat.years;
      r.push(R(bat.wins/bat.years>=0.6?'good':bat.wins/bat.years>=0.4?'warn':'bad',
        `ชนะตัวเทียบ ${bat.wins} จาก ${bat.years} ปีปฏิทิน`)); }
    else if (!per.length){ s=50; r.push(R('warn','ไม่มีข้อมูลผลตอบแทนเทียบดัชนีชี้วัด')); }
    else { s = 40 + 60*per.filter(([x,y])=>num(f[x])>=num(f[y])).length/per.length; }
    if (per.length && !has(f.ret5)) { s-=10; r.push(R('warn','ไม่มีผลตอบแทน 5 ปี — ประวัติสั้นเกินกว่าจะสรุปได้')); }
    // ผลตอบแทนต้องดูคู่กับความเสี่ยงที่จ่ายไป และต้องเทียบในกลุ่มเดียวกัน เพราะ Sharpe
    // ของกองตราสารหนี้กับกองหุ้นอยู่คนละสเกล · ดัชนีชี้วัด 5 ปีมีแค่ 36% ของกอง แต่ Sharpe มี 61%
    const sbr = sharpeBreaks(f.assetClass);
    if (has(f.sharpe) && sbr){
      const rk = pctRank(num(f.sharpe), sbr);
      if (!per.length && !bat) s = Math.round(35 + 0.6*rk);   // ไม่มีอะไรให้เทียบเลย -> ใช้ตัวนี้แทนการเดา 50
      else s = clamp(s + Math.round((rk-50)*0.3), 0, 100);     // มีฐานอยู่แล้ว -> ปรับได้ ±15
      r.push(R(rk>=60?'good':rk>=30?'warn':'bad',
        `Sharpe ${num(f.sharpe)} — ดีกว่า ${Math.round(rk)}% ของกองประเภทเดียวกัน (${a.label} ${sbr[5].toLocaleString()} กอง)`)); }
    if (has(f.ret1) && has(f.ret5) && num(f.ret1)>20 && num(f.ret1)>2*num(f.ret5)) r.push(R('warn','ผลตอบแทนปีล่าสุดสูงกว่าค่าเฉลี่ยระยะยาวมาก — ระวังการซื้อตามกระแส'));
    if (has(f.trackErr) && num(f.trackErr)>1.5){ s-=10; r.push(R('warn',`Tracking Error ${f.trackErr}% ค่อนข้างสูง`)); }
    C('c5', s, r); }

  // 6 hedging
  { let s; const r=[]; const h=f.hedge||'na';
    if (!foreign){ s=100; r.push(R('good','ลงทุนในไทย ไม่มีความเสี่ยงค่าเงิน')); }
    else if (a.equity){
      s = {none:90, discretion:90, partial:85, full:75, na:60}[h];
      r.push(R(h==='na'?'warn':'good', {
        none:'ไม่ป้องกันค่าเงิน: ได้/เสียจากค่าบาทด้วย ระยะยาวผลกระทบมักเฉลี่ยกันไป',
        discretion:'ป้องกันตามดุลพินิจ: ยืดหยุ่น ขึ้นกับฝีมือผู้จัดการ',
        partial:'ป้องกันบางส่วน: ลดผลกระทบค่าเงินได้ระดับหนึ่ง',
        full:'ป้องกันเต็มจำนวน: ค่าเงินไม่กระทบ แต่มีต้นทุนการป้องกันความเสี่ยง',
        na:'ไม่ทราบนโยบายป้องกันค่าเงิน — ควรตรวจสอบ'}[h]));
    } else {
      s = {full:100, partial:75, discretion:60, none:30, na:40}[h];
      r.push(R(s>=75?'good':s>=60?'warn':'bad', h==='full' ? 'ตราสารหนี้ต่างประเทศป้องกันค่าเงินเต็มจำนวน เหมาะสม'
        : 'ตราสารหนี้ต่างประเทศควรป้องกันค่าเงิน เพราะความผันผวนของค่าบาทอาจกลบดอกเบี้ยที่ได้'));
    }
    C('c6', s, r); }

  // 7 dividend
  { let s; const r=[]; const d=f.dividend==='yes';
    if (p.goal==='income'){ s = d?100:50; r.push(d ? R('good','จ่ายปันผล ตรงกับเป้าหมายกระแสเงินสด') : R('warn','ไม่จ่ายปันผล — ถ้าต้องการกระแสเงินสด อาจใช้แบบขายคืนอัตโนมัติแทน')); }
    else { s = d?60:100; r.push(d ? R('warn','จ่ายปันผล: ถูกหักภาษี 10% และเงินไม่ได้ทบต้นเต็มที่') : R('good','ไม่จ่ายปันผล เงินทบต้นเต็มที่ และกำไรจากการขายคืนไม่ต้องเสียภาษี')); }
    C('c7', s, r); }

  // 8 liquidity
  { let s; const r=[];
    if (!has(f.aum)){ s=60; r.push(R('warn','ไม่ได้ระบุขนาดกองทุน')); }
    else { const aum=num(f.aum); s = aum>=5000?100: aum>=1000?85: aum>=500?70:40;
      r.push(R(aum>=500?'good':'warn',`ขนาดกอง ${aum.toLocaleString()} ล้านบาท${aum<500?' — กองเล็ก มีโอกาสถูกปิดกองหรือสภาพคล่องต่ำ':''}`)); }
    if (has(f.settle)){ const t=num(f.settle); if (t>5){ s-=20; r.push(R('warn',`ได้เงินคืน T+${t} ช้า`)); } else r.push(R('good',`ได้เงินคืน T+${t}`)); }
    if (has(f.minHold) && num(f.minHold)>0){ const mh=num(f.minHold);
      if (mh>years){ s-=40; r.push(R('bad',`ต้องถือขั้นต่ำ ${mh} ปี นานกว่าระยะลงทุน ${years} ปี`)); out.fails.push(`ต้องถือขั้นต่ำ ${mh} ปี เกินระยะลงทุน`); }
      else r.push(R('good',`ถือขั้นต่ำ ${mh} ปี ไม่เกินระยะลงทุน`)); }
    if (has(f.minBuy) && p.mode!=='lump' && num(f.minBuy) > num(p.monthly)){ s-=10; r.push(R('warn',`ซื้อขั้นต่ำ ${fmtB(num(f.minBuy))} สูงกว่าเงิน DCA ต่อเดือน`)); }
    C('c8', s, r); }

  const wsum = CRIT.reduce((t,c)=>t+num(state.weights[c.k]),0) || 1;
  out.total = Math.round(CRIT.reduce((t,c)=>t+out.crit[c.k].score*num(state.weights[c.k]),0)/wsum);
  out.pass = out.fails.length===0;
  out.grade = !out.pass ? 'F' : out.total>=80?'A': out.total>=65?'B': out.total>=50?'C':'D';
  return out;
}

/* ============ projection ============ */
function fundAssumptions(f){
  const a = ASSET[f.assetClass] || ASSET.mixed;
  return { r: has(f.expReturn)?num(f.expReturn):a.exp, sd: has(f.sd)?num(f.sd):a.sd,
           ter:num(f.ter), front:num(f.front), back:num(f.back) };
}
// Monthly simulation. z: scenario shift in σ of the annualized return over the horizon (σ/√N).
function simulate({lump, monthly, years, legs, z=0, terOverride=null, noLoad=false}){
  const N = Math.max(1, Math.round(years));
  const vals = legs.map(()=>0);
  let principal = 0, fees = 0;
  const rows = [];
  const snap = (y) => {
    let v=0; legs.forEach((L,i)=>{ v += vals[i]*(1-(noLoad?0:L.back)/100); });
    const backFee = legs.reduce((t,L,i)=>t+vals[i]*(noLoad?0:L.back)/100,0);
    rows.push({year:y, principal, value:v, fees:fees+backFee});
  };
  const rates = legs.map(L => Math.max(-0.95, (L.r + z*L.sd/Math.sqrt(N))/100));
  for (let m=0; m<12*N; m++){
    legs.forEach((L,i)=>{
      const c = (m===0?lump:0)*L.w + monthly*L.w;
      if (c>0){ const load = c*(noLoad?0:L.front)/100; principal += c; fees += load; vals[i] += c-load; }
      if (m===0 && i===legs.length-1) snap(0);
    });
    legs.forEach((L,i)=>{
      vals[i] *= Math.pow(1+rates[i], 1/12);
      const fee = vals[i]*((terOverride??L.ter)/100)/12;
      vals[i] -= fee; fees += fee;
    });
    if ((m+1)%12===0) snap((m+1)/12);
  }
  return rows;
}

/* ============ UI: tabs ============ */
/* สามส่วนหลักบนแถบบน — วางแผนลงทุนคือส่วนเดียวที่ใช้งานได้ตอนนี้ */
document.querySelectorAll('.mainnav button').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.sec)));
function showSection(sec){
  if (!$('#section-'+sec)) return;
  document.querySelectorAll('.mainnav button').forEach(b=>b.classList.toggle('active', b.dataset.sec===sec));
  document.querySelectorAll('.section').forEach(el=>el.classList.toggle('active', el.id==='section-'+sec));
  try{ localStorage.setItem(KEY+'.sec', sec); }catch(e){}
  if (sec==='port') renderHoldings();
}

document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
function showTab(t){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+t));
  try{ localStorage.setItem(KEY+'.tab', t); }catch(e){}
  if (t==='screen') renderScreen();
  if (t==='plan') renderPlan();
}

/* ============ UI: profile ============ */
document.querySelectorAll('[data-p]').forEach(el=>{
  el.value = state.profile[el.dataset.p];
  el.addEventListener('input',()=>{ state.profile[el.dataset.p]=el.value; save(); });
  // โปรไฟล์อยู่ค้างข้างซ้ายแล้ว แก้ปุ๊บผลต้องเปลี่ยนปั๊บ — ใช้ change ไม่ใช่ input
  // เพราะช่องตัวเลขจะยิง input ทุกการกดแป้น แล้ววาดกราฟใหม่ทุกครั้ง
  el.addEventListener('change',()=>{
    if ($('#panel-screen').classList.contains('active')) renderScreen();
    if ($('#panel-plan').classList.contains('active')) renderPlan();
  });
});

/* ============ UI: fund form ============ */
let editingId = null;
function buildForm(){
  const form = $('#fundForm');
  form.innerHTML = FIELDS.map(g=>`<fieldset><legend>${g.g}</legend><div class="grid">${g.f.map(fld=>{
    const id='ff_'+fld.k;
    if (fld.t==='check') return `<label class="f chk"><input type="checkbox" id="${id}"> ${fld.l}</label>`;
    const hint = fld.hint?`<span class="hint">${fld.hint}</span>`:'';
    if (fld.t==='select') return `<label class="f">${fld.l}<select id="${id}">${fld.o.map(o=>`<option value="${o.v}">${o.l}</option>`).join('')}</select>${hint}</label>`;
    return `<label class="f">${fld.l}<input id="${id}" type="${fld.t}" ${fld.step?`step="${fld.step}"`:''} ${fld.req?'required':''}>${hint}</label>`;
  }).join('')}</div></fieldset>`).join('') +
  `<p class="form-legend" id="formLegend" hidden><span class="lg need">ช่องสีเหลือง</span> ก.ล.ต. ไม่มีข้อมูล — กรอกเองจาก Fact Sheet · <span class="lg check">ขอบสีฟ้า</span> ระบบอนุมานให้ — ควรตรวจ</p>` +
  `<div class="row"><button class="btn primary" type="submit" id="btnSave">บันทึกกองทุน</button><button class="btn" type="button" id="btnReset">ล้างฟอร์ม</button></div>`;
  form.addEventListener('submit', e=>{ e.preventDefault(); saveFund(); });
  $('#btnReset').addEventListener('click', ()=>fillForm(null));
  fillForm(null);
}
function fillForm(f){
  editingId = f ? f.id : null;
  const src = f || DEFAULT_FUND;
  FIELDS.forEach(g=>g.f.forEach(fld=>{
    const el = $('#ff_'+fld.k);
    if (fld.t==='check') el.checked = !!src[fld.k];
    else el.value = src[fld.k] ?? (fld.t==='select' ? el.options[0].value : '');
  }));
  markSecFields(f);
  $('#formTitle').textContent = f ? 'แก้ไข: '+f.name : 'เพิ่มกองทุน';
  $('#btnSave').textContent = f ? 'บันทึกการแก้ไข' : 'บันทึกกองทุน';
}
// Fields the SEC data can fill; empty ones are highlighted for manual entry. Inferred ones get a "check" outline.
const SEC_FILLABLE = ['holdings','top5','riskLevel','maxDD','sd','front','back','ter','ret1','bm1','ret3','bm3','ret5','bm5','sharpe','aum','settle','minBuy'];
const SEC_INFERRED = ['assetClass','region','hedge','minHold'];
function markSecFields(f){
  const isSec = !!(f && f.sec);
  FIELDS.forEach(g=>g.f.forEach(fld=>{
    const label = $('#ff_'+fld.k).closest('label');
    label.classList.toggle('need', isSec && SEC_FILLABLE.includes(fld.k) && !has(f[fld.k]));
    label.classList.toggle('check', isSec && (SEC_INFERRED.includes(fld.k) || (fld.k==='ter' && (f.sec.notes||[]).some(n=>n.includes('TER')))));
  }));
  $('#formLegend').hidden = !isSec;
}
function saveFund(){
  const f = {};
  FIELDS.forEach(g=>g.f.forEach(fld=>{
    const el = $('#ff_'+fld.k);
    f[fld.k] = fld.t==='check' ? el.checked : fld.t==='number' ? (el.value===''?'':parseFloat(el.value)) : el.value.trim();
  }));
  if (!f.name) return;
  if (editingId){ const i=state.funds.findIndex(x=>x.id===editingId); state.funds[i] = {...state.funds[i], ...f}; }
  else state.funds.push({...f, id:uid(), sample:false});
  save(); fillForm(null); renderFunds();
}
/* ---- พอร์ตกองทุนจาก Fact Sheet (ก.ล.ต.) ----
   alloc = สัดส่วนประเภททรัพย์สิน (%NAV) -> donut · top5 = ทรัพย์สิน 5 อันดับแรก -> รายการ */
function portBlock(f){
  const s = f.sec; if (!s) return '';
  const alloc = s.alloc || [], top5 = s.top5 || [], st = s.stats || {};
  // ค่า '0' คือช่องที่ บลจ. ไม่ได้กรอก ไม่ใช่ศูนย์จริง (YTM ครึ่งหนึ่งของที่รายงานมาเป็น 0)
  const val = v => { const t=String(v ?? '').trim(); return (!t || parseFloat(t)===0) ? '' : t; };
  const bondish = f.assetClass==='bond' || f.assetClass==='money_market';
  const extra = [['อัตราหมุนเวียนการลงทุน (เท่า/ปี)', val(st.portfolio_turnover_ratio), true],
                 ['ระยะเวลาฟื้นจากขาดทุนสูงสุด', String(st.recovering_period||'').trim(), true],
                 ['อายุเฉลี่ยตราสาร (Duration)', String(st.portfolio_duration_period||'').trim(), bondish],
                 ['Yield to Maturity (%)', val(st.yield_to_maturity), bondish]].filter(x=>x[2] && x[1]);
  if (!alloc.length && !top5.length && !extra.length) return '';
  const asOf = s.portAsOf || s.asOf;
  const row = (x, i) => `<li>${i===null?'':`<span class="sw" style="background:var(${DONUT[i%DONUT.length]})"></span>`}`
    + `<span class="nm" title="${esc(x[0])}">${esc(x[0])}</span><span class="pv">${x[1].toFixed(2)}%</span></li>`;
  const total = alloc.reduce((t,x)=>t+x[1], 0);
  const parts = [];
  if (alloc.length) parts.push(`<h5>สัดส่วนประเภททรัพย์สิน (%NAV)</h5><ul class="port-list">${alloc.map(row).join('')}</ul>`);
  if (top5.length) parts.push(`<h5>ทรัพย์สิน 5 อันดับแรก</h5><ul class="port-list">${top5.map(x=>row(x,null)).join('')}</ul>`);
  if (alloc.length && Math.abs(total-100) >= 0.5)
    parts.push(`<p class="meta" style="margin:6px 0 0">รวมที่แฟกต์ชีตระบุ ${total.toFixed(2)}% ของ NAV — ส่วนที่เหลือไม่ได้แจกแจงไว้</p>`);
  if (extra.length) parts.push(`<h5>ข้อมูลประกอบ</h5><ul class="port-list">${extra
    .map(([k,v])=>`<li><span class="nm">${esc(k)}</span><span class="pv">${esc(v)}</span></li>`).join('')}</ul>`);
  if (f.feeder)
    parts.push(`<p class="meta" style="margin:6px 0 0">เป็น Feeder Fund — สัดส่วนนี้คือการถือหน่วยของกองหลัก ไม่ใช่ทรัพย์สินที่กองหลักลงทุนจริง</p>`);
  return `<details class="port" data-port="${esc(f.id)}">
      <summary>พอร์ตกองนี้${asOf?` · ณ ${esc(asOf)}`:''}</summary>
      <div class="port-body">
        ${alloc.length?`<div class="port-chart"><canvas id="port_${esc(f.id)}"></canvas></div>`:''}
        <div class="port-side">${parts.join('')}</div>
      </div></details>`;
}
function drawPort(id){
  const f = state.funds.find(x=>x.id===id);
  drawDonut('port_'+id, f && f.sec && f.sec.alloc);
}
function drawDonut(canvasId, rows){
  if (!rows || !rows.length || !document.getElementById(canvasId)) return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = css('--muted');
  draw(canvasId, {
    type:'doughnut',
    data:{labels: rows.map(x=>x[0]), datasets:[{
      data: rows.map(x=>x[1]),
      backgroundColor: rows.map((_,i)=>css(DONUT[i%DONUT.length])),
      borderColor: css('--surface-2'), borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:'58%',
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label:c=>` ${c.label}: ${c.parsed.toFixed(2)}%`}}}}
  });
}

function renderFunds(){
  $('#fundCount').textContent = state.funds.length;
  $('#fundList').innerHTML = state.funds.length ? state.funds.map(f=>{
    const a = ASSET[f.assetClass]||ASSET.mixed;
    return `<div class="fund-item">
      <b>${esc(f.name)} ${f.sample?'<span class="tag">ตัวอย่าง</span>':''}${f.sec?'<span class="tag sec">ก.ล.ต.</span>':''}</b>
      <div class="meta">${esc(f.amc||'-')} · ${a.label} · ${REGION[f.region]||''} · เสี่ยง ${esc(f.riskLevel||'?')} · TER ${has(f.ter)?esc(num(f.ter))+'%':'?'}</div>
      ${f.sec?`<div class="meta">Fact Sheet ${esc(f.sec.asOf||'-')} · ดึงเมื่อ ${esc(f.sec.fetched)}</div>
        ${f.sec.missing?.length?`<div class="meta" style="color:var(--warn)">ต้องกรอกเอง: ${esc(f.sec.missing.join(', '))}</div>`:''}
        ${f.sec.notes?.length?`<ul class="reasons">${f.sec.notes.map(n=>`<li class="warn">${esc(n)}</li>`).join('')}</ul>`:''}`:''}
      ${portBlock(f)}
      <div class="row" style="margin-top:8px"><button class="btn small" data-edit="${esc(f.id)}">แก้ไข</button>${f.sec&&secReady?`<button class="btn small" data-refresh="${esc(f.id)}">อัปเดตจาก ก.ล.ต.</button>`:''}<button class="btn small danger" data-del="${esc(f.id)}">ลบ</button></div>
    </div>`; }).join('') : '<p class="muted">ยังไม่มีกองทุน — กรอกฟอร์มด้านบน หรือกด "โหลดกองตัวอย่าง"</p>';
  // a canvas inside a closed <details> has no size, so the donut is drawn the first time it opens
  $('#fundList').querySelectorAll('details.port').forEach(d=>
    d.addEventListener('toggle', ()=>{ if (d.open) drawPort(d.dataset.port); }));
}
/* ============ SEC Open API data ============
   Two sources, tried in order:
   1. "live"   — local sec_server.py (start.bat) calls api.sec.or.th with your key
   2. "static" — data/index.json + data/funds/<AMC>.json built by GitHub Actions (GitHub Pages);
                 the browser never sees a key */
let secReady = false, secMode = null, secStatic = null;
const amcCache = {};
const AMC_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NON_RETAIL = {A:'ขายเฉพาะผู้ลงทุนสถาบัน', B:'ขายเฉพาะผู้มีเงินลงทุนสูง', H:'ขายเฉพาะสถาบัน/ผู้มีเงินลงทุนสูง'};
const RESULT_LIMIT = 50;
const RESTRICTED_CLASS_RE = /(?:ให้บริการ|เสนอขาย)เฉพาะ(?:แก่)?ผู้ลงทุน(?!ทั่วไป)|ผู้ลงทุน(?:ที่เป็น|ประเภท)?\s*กองทุน|รับโอน(?:เงิน)?จากกองทุนสำรองเลี้ยงชีพ|กองทุน(?:รวม)?\s*(?:และ\/หรือ)?\s*(?:กองทุน)?ส่วนบุคคลภายใต้|unit\s*-?\s*link|กรมธรรม์ประกันชีวิต|ความคุ้มครองจากบริษัทประกัน|บริษัทประกันชีวิต|ผู้ลงทุนรายใหญ่|ผู้มีเงินลงทุนสูง|สถาบัน\s*(?:ที่|ตามที่)\s*บริษัทจัดการ(?:กำหนด|จะประกาศ)|ผู้ถือหน่วยลงทุนที่เป็นกองทุน|สำหรับกองทุนสำรองเลี้ยงชีพ/i;  // same rule as RESTRICTED_CLASS in sec_build.py

async function secApi(path){
  const r = await fetch(path, {headers:{'X-Fund-Screener':'1'}, cache:'no-store'});
  const j = await r.json().catch(()=>({error:'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ'}));
  if (!r.ok) throw new Error(j.error || ('HTTP '+r.status));
  return j;
}
async function getJson(url){
  const r = await fetch(url, {cache:'no-cache'});
  if (!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
async function loadStatic(){
  const j = await getJson('data/index.json');
  if (!j || !(Array.isArray(j.items) || Array.isArray(j.rows))) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
  const amcs = (j.amcs && typeof j.amcs==='object') ? j.amcs : {};
  const breaks = (o, allowNeg) => (o && typeof o==='object') ? Object.fromEntries(Object.entries(o)
    .filter(([k,v])=>ASSET[k] && Array.isArray(v) && v.length===6
      && v.every(x=>typeof x==='number' && isFinite(x) && (allowNeg || x>=0))
      && v.slice(0,5).every((x,i,arr)=>i===0 || x>=arr[i-1]))) : null;
  j.terPct = breaks(j.terPct, false);
  j.sharpePct = breaks(j.sharpePct, true);
  // pre-compute a lowercase search string per share class
  const raw = Array.isArray(j.rows) && Array.isArray(j.fields)
    ? j.rows.filter(Array.isArray).map(row=>Object.fromEntries(j.fields.map((k,i)=>[k,row[i]])))
    : j.items;
  j.items = raw.filter(it=>it && typeof it.projId==='string').map(it=>{
    const x = {projId:cleanStr(it.projId,40), cls:cleanStr(it.cls,60), abbr:cleanStr(it.abbr,60), nameTh:cleanStr(it.nameTh),
               nameEn:cleanStr(it.nameEn), policy:cleanStr(it.policy,100), retail:cleanStr(it.retail,2),
               tag:cleanStr(it.tag, 80), amcId:AMC_ID_RE.test(it.amcId)?it.amcId:'',
               aud: it.aud==='inst' || RESTRICTED_CLASS_RE.test(`${cleanStr(it.nameTh)} ${cleanStr(it.classDesc, 5000)}`) ? 'inst' : ''};
    x.amc = cleanStr(amcs[x.amcId]);
    x.hay = [x.abbr,x.cls,x.nameTh,x.nameEn,x.amc].join(' ').toLowerCase();
    return x;
  });
  return j;
}
async function secInit(){
  const status = $('#secStatus');
  if (!location.protocol.startsWith('http')){
    status.textContent = 'เปิดแบบไฟล์ธรรมดาอยู่ — ใช้กรอกข้อมูลเองได้ ถ้าต้องการข้อมูลจาก ก.ล.ต. ให้เปิดผ่าน start.bat หรือเว็บ GitHub Pages';
    return;
  }
  let noKeyMsg = '';
  try{
    const h = await secApi('api/health');
    if (h.hasKey){
      secMode = 'live'; secReady = true;
      status.textContent = 'โหมดเครื่องตัวเอง: ค้นหาได้ทุกกองจาก ก.ล.ต. แบบสด แล้วกด "เพิ่ม"';
      $('#secQ').placeholder = 'ชื่อย่อ / ชื่อกองทุน เช่น SCBS&P500';
      $('#secForm').style.display = 'flex'; renderFunds(); return;
    }
    noKeyMsg = 'เชื่อมต่อเซิร์ฟเวอร์แล้ว แต่ยังไม่มี API Key — ใส่คีย์ในไฟล์ sec-config.json แล้วรีเฟรชหน้านี้';
  }catch(e){ /* no local server: use the prebuilt data */ }
  try{
    secStatic = await loadStatic();
    secMode = 'static'; secReady = true;
    const when = secStatic.generated ? new Date(secStatic.generated).toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'}) : '-';
    const scope = secStatic.mode==='watchlist' ? 'เฉพาะกองในรายการติดตาม' : 'ทุกกองที่เปิดขาย';
    status.textContent = `ข้อมูลจาก ก.ล.ต. ${secStatic.items.length.toLocaleString('th-TH')} ชนิดหน่วยลงทุน (${scope}) · อัปเดตล่าสุด ${when}`;
    const stamp = $('#dataStamp'); if (stamp) stamp.textContent = `ก.ล.ต. · ${secStatic.items.length.toLocaleString('th-TH')} หน่วย · ${when}`;
    $('#secQ').placeholder = 'ชื่อย่อ / ชื่อกองทุน / บลจ. เช่น S&P500, ปันผล, กสิกร';
    $('#secForm').style.display = 'flex'; renderFunds();
  }catch(e){
    status.textContent = noKeyMsg || 'ยังไม่มีข้อมูลจาก ก.ล.ต. — กรอกข้อมูลเองได้ตามปกติ';
  }
}
function renderSecResults(items, total){
  const more = total > items.length ? ` — แสดง ${items.length} รายการแรก พิมพ์ให้เจาะจงขึ้นเพื่อดูเพิ่ม` : '';
  $('#secResults').innerHTML = items.length ? `<p class="muted" style="margin:0 0 4px">พบ ${total.toLocaleString('th-TH')} รายการ${more}</p>` + items.map(it=>`<div class="sec-row">
      <div><b>${esc(it.abbr)}${it.cls&&it.cls!=='main'?' · '+esc(it.cls):''}</b> ${NON_RETAIL[it.retail]?`<span class="tag">${NON_RETAIL[it.retail]}</span>`:''}${it.aud==='inst'?'<span class="tag" title="ขายเฉพาะกองทุนสำรองเลี้ยงชีพ/กองทุนส่วนบุคคล/ประกันควบการลงทุน/สถาบัน">เฉพาะกลุ่ม</span>':''}
        <div class="meta">${esc(it.nameTh||it.nameEn)}</div>
        <div class="meta">${esc(it.amc)}${it.policy?' · '+esc(it.policy):''}${it.tag?' · '+esc(it.tag):''}</div></div>
      <button class="btn small primary" data-secadd="${esc(it.projId)}" data-seccls="${esc(it.cls)}">เพิ่ม</button></div>`).join('')
    : '<p class="muted">ไม่พบกองทุน — ลองใช้ชื่อย่อหรือคำอื่น</p>';
}
function searchStatic(q){
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = secStatic.items.filter(it=>words.every(w=>it.hay.includes(w)));
  const ql = q.toLowerCase();
  const rank = it => (it.abbr.toLowerCase()===ql || it.cls.toLowerCase()===ql) ? 0
                   : (it.abbr.toLowerCase().startsWith(ql) || it.cls.toLowerCase().startsWith(ql)) ? 1 : 2;
  hits.sort((a,b)=>rank(a)-rank(b) || a.abbr.localeCompare(b.abbr) || a.cls.localeCompare(b.cls));
  return hits;
}
$('#secForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const q = $('#secQ').value.trim(), box = $('#secResults');
  if (q.length<2){ box.innerHTML='<p class="muted">พิมพ์อย่างน้อย 2 ตัวอักษร</p>'; return; }
  if (secMode==='static'){
    const hits = searchStatic(q);
    renderSecResults(hits.slice(0, RESULT_LIMIT), hits.length);
    return;
  }
  box.innerHTML = '<p class="muted">กำลังค้นหา…</p>';
  try{
    const items = (await secApi('api/search?q='+encodeURIComponent(q))).items
      .map(it=>({...it, tag: it.classDesc && it.classDesc.length>80 ? it.classDesc.slice(0,80)+'…' : it.classDesc}));
    renderSecResults(items, items.length);
  }
  catch(err){ box.innerHTML = `<div class="callout warn">${esc(err.message)}</div>`; }
});
async function loadAmc(amcId){
  if (!AMC_ID_RE.test(amcId)) throw new Error('รหัส บลจ. ไม่ถูกต้อง');
  if (!amcCache[amcId]) amcCache[amcId] = getJson(`data/funds/${encodeURIComponent(amcId)}.json`).catch(e=>{ delete amcCache[amcId]; throw e; });
  return amcCache[amcId];
}
async function staticFund(projId, cls){
  const it = secStatic && secStatic.items.find(x=>x.projId===projId && x.cls===(cls||''));
  if (!it || !it.amcId) throw new Error('ไม่พบกองนี้ในข้อมูลล่าสุด');
  const items = (await loadAmc(it.amcId)).items || {};
  const key = `${projId}|${cls||''}`;
  if (!Object.prototype.hasOwnProperty.call(items, key)) throw new Error('ไม่พบข้อมูลรายละเอียดของกองนี้');
  return items[key];
}
async function secFetchFund(projId, cls, source){
  if (secMode==='static' || source==='static') return staticFund(projId, cls);
  const {fund} = await secApi(`api/fund?proj_id=${encodeURIComponent(projId)}&cls=${encodeURIComponent(cls||'')}`);
  return fund;
}
async function addSecFund(b){
  const projId = b.dataset.secadd, cls = b.dataset.seccls;
  if (state.funds.some(f=>f.sec && f.sec.projId===projId && f.sec.cls===cls) && !confirm('กองนี้มีอยู่แล้ว ต้องการเพิ่มซ้ำหรือไม่?')) return;
  b.disabled = true; b.textContent = 'กำลังดึง…';
  try{
    const fund = await secFetchFund(projId, cls, b.dataset.secsrc);
    const rec = sanitizeFund({...DEFAULT_FUND, ...fund, id:uid(), sample:false}); if (!rec) throw new Error('ข้อมูลกองทุนไม่ครบ');
    state.funds.push(rec); save(); renderFunds();
    b.textContent = 'เพิ่มแล้ว ✓';
    fillForm(rec); $('#fundForm').scrollIntoView({behavior:'smooth'});
  }catch(err){ b.disabled=false; b.textContent='เพิ่ม'; alert('ดึงข้อมูลไม่สำเร็จ: '+err.message); }
}
$('#secResults').addEventListener('click', e=>{ const b = e.target.closest('[data-secadd]'); if (b) addSecFund(b); });

/* ============ Recommendations ============
   Scores every share class in the SEC data set with the same 8-criteria engine used in tab ③,
   after removing funds an ordinary investor cannot or should not compare (institution-only,
   fixed-term, too little data), then slices the result into advice-oriented shortlists. */
let recoData = null, recoTab = 'top', recoProfileKey = '';
const RECO_SIZE = 10;
const NON_RETAIL_CODES = ['A','B','H'];
const profileKey = () => JSON.stringify([state.profile.goal, state.profile.years, state.profile.riskTol, state.profile.mode, state.profile.monthly, state.weights]);

function looksFixedTerm(it, f){
  if (typeof f.fixedTerm === 'boolean') return f.fixedTerm;  // provided by data built after this feature
  return /\d+\/\d{2}\b/.test(it.abbr + ' ' + it.nameTh) || /\d+M\d*\b/.test(it.abbr);
}
function dataGaps(f){
  const gaps = [];
  if (!has(f.riskLevel)) gaps.push('ระดับความเสี่ยง');
  if (!has(f.ter) || num(f.ter)<=0) gaps.push('TER');
  if (!has(f.ret1) && !has(f.ret3) && !has(f.ret5)) gaps.push('ผลตอบแทนย้อนหลัง');
  if (!has(f.maxDD)) gaps.push('Max Drawdown');
  if (!has(f.aum)) gaps.push('ขนาดกอง');
  return gaps;
}
async function ensureStaticData(){
  if (secStatic) return secStatic;
  secStatic = await loadStatic();   // live mode: works when the local data/ folder exists (py sec_build.py)
  return secStatic;
}
async function buildRecommendations(progress){
  await ensureStaticData();
  const amcIds = [...new Set(secStatic.items.map(it=>it.amcId).filter(Boolean))];
  let done = 0;
  // download the AMC files a few at a time
  const queue = amcIds.slice();
  await Promise.all(Array.from({length:4}, async ()=>{
    while (queue.length){ const id = queue.shift(); await loadAmc(id); progress(++done, amcIds.length); }
  }));

  const p = state.profile, tol = num(p.riskTol, 6);
  const excluded = {nonRetail:0, fixedTerm:0, gaps:0, failed:0};
  const growthGoal = ['wealth','retire','tax'].includes(p.goal) && num(p.years)>=5;
  const GROWTH = ['global_equity','thai_equity','mixed','reit'];
  const rows = [];
  for (const it of secStatic.items){
    const raw = ((await loadAmc(it.amcId)).items || {})[`${it.projId}|${it.cls}`];
    if (!raw) continue;
    if (NON_RETAIL_CODES.includes(it.retail) || it.aud==='inst'){ excluded.nonRetail++; continue; }
    const f = sanitizeFund({...DEFAULT_FUND, ...raw, id:'reco0000'});
    if (!f) continue;
    if (looksFixedTerm(it, raw)){ excluded.fixedTerm++; continue; }
    const gaps = dataGaps(f);
    if (gaps.length > 1 || gaps.includes('ระดับความเสี่ยง') || gaps.includes('TER')){ excluded.gaps++; continue; }
    const e = evaluate(f, p);
    if (!e.pass){ excluded.failed++; continue; }
    const beats = [['ret1','bm1'],['ret3','bm3'],['ret5','bm5']].filter(([a,b])=>has(f[a]) && has(f[b]));
    rows.push({it, f, e, gaps,
      excess: beats.length ? beats.reduce((t,[a,b])=>t+num(f[a])-num(f[b]),0)/beats.length : null,
      beatsAll: beats.length===3 && beats.every(([a,b])=>num(f[a])>=num(f[b]))});
  }
  const byScore = (a,b)=> b.e.total-a.e.total || a.gaps.length-b.gaps.length || num(a.f.ter,9)-num(b.f.ter,9) || num(b.f.aum)-num(a.f.aum);
  // one share class per fund, so a single fund cannot fill a whole list
  const onePerFund = list => { const seen = new Set(); return list.filter(r=>!seen.has(r.it.projId) && seen.add(r.it.projId)); };
  const ranked = onePerFund(rows.slice().sort(byScore));

  const cats = [];
  if (p.goal==='tax') cats.push({k:'tax', label:'ลดหย่อนภาษี',
    desc:'กอง SSF / RMF / Thai ESG ที่ผ่านเกณฑ์ เรียงตามคะแนนรวม' + (growthGoal ? ' — ถือยาวหลายปีจึงคัดเฉพาะสินทรัพย์เติบโต (หุ้น/ผสม/REIT)' : ''),
    list: ranked.filter(r=>r.f.taxType!=='none' && (!growthGoal || GROWTH.includes(r.f.assetClass)))});
  if (p.goal==='income') cats.push({k:'income', label:'จ่ายปันผล', desc:'กองที่มีนโยบายจ่ายเงินปันผล เหมาะกับเป้าหมายกระแสเงินสด',
    list: ranked.filter(r=>r.f.dividend==='yes')});
  // A long-term growth goal should not be topped by short-term bond funds just because they are cheap and calm;
  // a short-term goal should not be topped by equity funds.
  const topList = growthGoal ? ranked.filter(r=>GROWTH.includes(r.f.assetClass))
                : p.goal==='short' ? ranked.filter(r=>['bond','money_market'].includes(r.f.assetClass)) : ranked;
  const topNote = growthGoal ? ' — เป้าหมายระยะยาวจึงคัดเฉพาะสินทรัพย์เติบโต (หุ้น/ผสม/REIT) ส่วนตราสารหนี้ดูในหมวด "เสี่ยงต่ำกว่าที่รับได้"'
                : p.goal==='short' ? ' — เป้าหมายระยะสั้นจึงคัดเฉพาะตราสารหนี้และตลาดเงิน' : '';
  cats.push({k:'top', label:'เหมาะกับโปรไฟล์ที่สุด', desc:'คะแนนรวมสูงสุดตามเกณฑ์ 8 ข้อและน้ำหนักที่ตั้งไว้ในแท็บ ③'+topNote, list: topList});
  cats.push({k:'cheap', label:'ค่าธรรมเนียมต่ำ', desc:'คะแนนรวมตั้งแต่ 60 ขึ้นไป เรียงตาม TER จากต่ำไปสูง — ต้นทุนที่แน่นอนที่สุดในระยะยาว'+(growthGoal?' (เฉพาะสินทรัพย์เติบโต)':''),
    list: onePerFund(rows.filter(r=>r.e.total>=60 && num(r.f.ter)>0 && (!growthGoal || GROWTH.includes(r.f.assetClass))).sort((a,b)=>num(a.f.ter)-num(b.f.ter) || byScore(a,b)))});
  cats.push({k:'consistent', label:'ชนะดัชนีสม่ำเสมอ', desc:'ผลตอบแทนไม่แพ้ดัชนีชี้วัดทั้ง 1, 3 และ 5 ปี เรียงตามส่วนต่างเฉลี่ย',
    list: onePerFund(rows.filter(r=>r.beatsAll).sort((a,b)=>b.excess-a.excess || byScore(a,b)))});
  cats.push({k:'safer', label:'เสี่ยงต่ำกว่าที่รับได้', desc:`ระดับความเสี่ยงไม่เกิน ${Math.max(1,tol-2)} (ต่ำกว่าที่รับได้ 2 ระดับ) สำหรับส่วนที่ต้องการความมั่นคง`,
    list: ranked.filter(r=>num(r.f.riskLevel)<=Math.max(1,tol-2))});
  const perAsset = [];
  Object.keys(ASSET).forEach(k=>perAsset.push(...ranked.filter(r=>r.f.assetClass===k).slice(0,2)));
  cats.push({k:'asset', label:'ดีสุดแต่ละประเภทสินทรัพย์', desc:'2 อันดับแรกของแต่ละประเภท — ใช้เป็นจุดเริ่มต้นจัดพอร์ตแบบกระจายความเสี่ยง', list: perAsset, keepOrder:true});

  return {cats, excluded, candidates: rows.length, total: secStatic.items.length, generated: secStatic.generated};
}

function renderRecommendations(){
  const box = $('#recoBox');
  const d = recoData; if (!d) return;
  const cat = d.cats.find(c=>c.k===recoTab) || d.cats[0]; recoTab = cat.k;
  const list = cat.keepOrder ? cat.list : cat.list.slice(0, RECO_SIZE);
  const p = state.profile, goalText = $('[data-p=goal]').selectedOptions[0].text;
  const stale = profileKey() !== recoProfileKey;
  const ex = d.excluded;
  box.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div><b>แนะนำตามโปรไฟล์</b> <span class="muted">· ${esc(goalText)} · ${esc(p.years)} ปี · รับความเสี่ยงได้ระดับ ${esc(p.riskTol)}</span></div>
      <button class="btn small" type="button" id="btnRecoClose">ซ่อน</button>
    </div>
    ${stale ? '<div class="callout warn">โปรไฟล์หรือน้ำหนักคะแนนเปลี่ยนไปแล้ว — กด "แนะนำกองทุนตามโปรไฟล์" อีกครั้งเพื่อคำนวณใหม่</div>' : ''}
    <div class="chips" role="tablist">${d.cats.map(c=>`<button type="button" data-reco-tab="${c.k}" class="${c.k===cat.k?'active':''}">${esc(c.label)}<span class="n">${c.keepOrder?c.list.length:Math.min(RECO_SIZE,c.list.length)}</span></button>`).join('')}</div>
    <p class="sub" style="margin:0 0 4px">${esc(cat.desc)}</p>
    ${list.length ? list.map((r,i)=>recoRow(r, cat.keepOrder ? ASSET[r.f.assetClass].label : i+1, cat.keepOrder)).join('')
      : '<p class="muted">ไม่มีกองที่เข้าเงื่อนไขในหมวดนี้ — ลองปรับโปรไฟล์หรือดูหมวดอื่น</p>'}
    <p class="muted" style="font-size:.8rem;margin:10px 0 0">
      คัดจาก ${d.candidates.toLocaleString('th-TH')} ชนิดหน่วยลงทุนที่ผ่านเกณฑ์ (ทั้งหมด ${d.total.toLocaleString('th-TH')}) ·
      ตัดออก: ไม่ผ่านเกณฑ์โปรไฟล์ ${ex.failed.toLocaleString('th-TH')} · ข้อมูลไม่พอ ${ex.gaps.toLocaleString('th-TH')} ·
      กองมีกำหนดอายุ ${ex.fixedTerm.toLocaleString('th-TH')} · ชนิดเฉพาะกลุ่ม (สถาบัน/กองทุนสำรองเลี้ยงชีพ/ประกันควบการลงทุน) ${ex.nonRetail.toLocaleString('th-TH')} ·
      แสดงชนิดหน่วยลงทุนที่ดีที่สุดกองละ 1 ชนิด<br>
      ผลนี้เป็นการจัดอันดับตามเกณฑ์ของโปรแกรมจากข้อมูล Fact Sheet ไม่ใช่คำแนะนำการลงทุนเฉพาะบุคคล ผลตอบแทนในอดีตไม่รับประกันอนาคต — อ่านหนังสือชี้ชวนก่อนตัดสินใจ
    </p>`;
}
function recoRow(r, rank, isLabel){
  const f = r.f, it = r.it, e = r.e;
  const pctv = v => has(v) ? `${num(v).toFixed(2)}%` : '–';
  const ret = has(f.ret5) ? ['5 ปี', f.ret5, f.bm5] : has(f.ret3) ? ['3 ปี', f.ret3, f.bm3] : ['1 ปี', f.ret1, f.bm1];
  const goods = CRIT.flatMap(c=>e.crit[c.k].score>=80 ? e.crit[c.k].reasons.filter(x=>x.lvl==='good').slice(0,1) : []).slice(0,2);
  const warns = CRIT.flatMap(c=>e.crit[c.k].reasons.filter(x=>x.lvl!=='good')).filter(x=>!x.t.includes('จำนวนหลักทรัพย์') && !x.t.includes('ประมาณการค่าใช้จ่าย')).slice(0,2);
  return `<div class="reco-row">
    <div class="reco-rank" ${isLabel?'style="font-size:.72rem;line-height:1.2"':''}>${esc(rank)}</div>
    <div>
      <b>${esc(it.abbr)}${it.cls && it.cls!=='main' ? ' · '+esc(it.cls) : ''}</b>
      ${f.taxType!=='none' ? `<span class="tag sec">${esc(TAX[f.taxType])}</span>` : ''}${it.tag ? ` <span class="tag">${esc(it.tag)}</span>` : ''}
      <div class="meta muted" style="font-size:.84rem">${esc(it.nameTh || it.nameEn)} · ${esc(it.amc)}</div>
      <div class="reco-facts">
        <span>${esc(ASSET[f.assetClass].label)}</span><span>เสี่ยง ${esc(f.riskLevel)}</span><span>TER ${pctv(f.ter)}</span>
        <span>ผลตอบแทน ${ret[0]} ${pctv(ret[1])}${has(ret[2]) ? ` (ดัชนี ${pctv(ret[2])})` : ''}</span>
        <span>ขาดทุนสูงสุด ${has(f.maxDD) ? '−'+num(f.maxDD).toFixed(1)+'%' : '–'}</span>
        <span>ขนาด ${has(f.aum) ? Math.round(num(f.aum)).toLocaleString('th-TH')+' ลบ.' : '–'}</span>
      </div>
      <div class="reco-why">${goods.map(x=>`<span class="good">✓ ${esc(x.t)}</span>`).join(' · ')}${goods.length && warns.length ? '<br>' : ''}${warns.map(x=>`<span class="warn">! ${esc(x.t)}</span>`).join(' · ')}</div>
    </div>
    <div class="reco-side">
      <span class="grade ${cls(e.total)}" title="คะแนนรวม ${e.total}">${esc(e.grade)}</span>
      <span class="muted" style="font-size:.8rem">${e.total} คะแนน</span>
      <button class="btn small primary" type="button" data-secadd="${esc(it.projId)}" data-seccls="${esc(it.cls)}" data-secsrc="static">เพิ่ม</button>
    </div>
  </div>`;
}
$('#btnReco').addEventListener('click', async ()=>{
  const box = $('#recoBox'), btn = $('#btnReco');
  box.hidden = false; btn.disabled = true;
  box.innerHTML = '<p class="muted">กำลังเตรียมข้อมูล…</p>';
  try{
    recoProfileKey = profileKey();
    recoData = await buildRecommendations((n, total)=>{ box.innerHTML = `<p class="muted">กำลังโหลดข้อมูลกองทุน ${n}/${total} บลจ.…</p>`; });
    if (!recoData.cats.find(c=>c.k===recoTab)) recoTab = recoData.cats[0].k;
    if (['tax','income'].includes(recoData.cats[0].k)) recoTab = recoData.cats[0].k;
    renderRecommendations();
  }catch(err){
    box.innerHTML = `<div class="callout warn">ยังใช้การแนะนำไม่ได้: ต้องมีชุดข้อมูลทุกกองจาก ก.ล.ต. (มีบนเว็บ GitHub Pages หรือรัน <code>py sec_build.py</code> บนเครื่องก่อน) — ${esc(err.message)}</div>`;
  }finally{ btn.disabled = false; }
});
$('#recoBox').addEventListener('click', e=>{
  const tab = e.target.closest('[data-reco-tab]');
  if (tab){ recoTab = tab.dataset.recoTab; renderRecommendations(); return; }
  if (e.target.id==='btnRecoClose'){ $('#recoBox').hidden = true; return; }
  const b = e.target.closest('[data-secadd]'); if (b) addSecFund(b);
});

$('#fundList').addEventListener('click', async e=>{
  const rf = e.target.dataset.refresh;
  if (rf){
    const i = state.funds.findIndex(x=>x.id===rf), old = state.funds[i];
    e.target.disabled = true; e.target.textContent = 'กำลังอัปเดต…';
    try{
      const fund = await secFetchFund(old.sec.projId, old.sec.cls);
      // keep what the API cannot provide and the user's own assumptions
      const keep = {};
      ['holdings','expReturn','notes'].forEach(k=>{ if (has(old[k]) || (k==='notes'&&old[k])) keep[k]=old[k]; });
      Object.keys(fund).forEach(k=>{ if (fund[k]==='' && old[k]!=='' && old[k]!==undefined) keep[k]=old[k]; });
      state.funds[i] = sanitizeFund({...old, ...fund, ...keep, id:old.id}) || old;
      save(); renderFunds();
    }catch(err){ alert('อัปเดตไม่สำเร็จ: '+err.message); renderFunds(); }
    return;
  }
  const ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (ed){ fillForm(state.funds.find(f=>f.id===ed)); $('#fundForm').scrollIntoView({behavior:'smooth'}); }
  if (del){ const f=state.funds.find(x=>x.id===del); if (confirm('ลบ "'+f.name+'" ?')){ state.funds=state.funds.filter(x=>x.id!==del); delete state.portfolio[del]; delete state.holdings[del]; if(editingId===del) fillForm(null); save(); renderFunds(); } }
});
$('#btnWipe').addEventListener('click', ()=>{
  if (!confirm('ลบข้อมูลโปรไฟล์ กองทุน และพอร์ตทั้งหมดที่เก็บในเบราว์เซอร์นี้? (ควร Export JSON ไว้ก่อนถ้าต้องการเก็บ)')) return;
  try{ localStorage.removeItem(KEY); localStorage.removeItem(KEY+'.tab'); localStorage.removeItem(KEY+'.sec'); }catch(e){}
  state = freshState(); location.reload();
});
$('#btnSamples').addEventListener('click',()=>{ state.funds = state.funds.filter(f=>!f.sample).concat(SAMPLES.map(s=>({...s,id:uid(),sample:true}))); save(); renderFunds(); });
$('#btnClearSamples').addEventListener('click', ()=>{ const ids=state.funds.filter(f=>f.sample).map(f=>f.id); ids.forEach(id=>delete state.portfolio[id]); state.funds=state.funds.filter(f=>!f.sample); save(); renderFunds(); });
$('#btnExport').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fund-screener-data.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
});
$('#fileImport').addEventListener('change', e=>{
  const file = e.target.files[0]; if (!file) return;
  file.text().then(t=>{ const s=sanitizeState(JSON.parse(t)); if (!s) throw 0; state=s; save(); location.reload(); })
    .catch(()=>alert('ไฟล์ไม่ถูกต้อง'));
});

/* ============ UI: screening ============ */
let selectedFundId = null;
function renderFundPanel(res){
  const box = $('#fundPanel'); if (!box) return;
  const r = res.find(x=>x.f.id===selectedFundId) || res[0];
  if (!r){ box.innerHTML = '<p class="muted" style="margin:0">ยังไม่มีกองทุน — เพิ่มในแท็บ ①</p>'; return; }
  selectedFundId = r.f.id;
  const e = r.e, alloc = (r.f.sec && r.f.sec.alloc) || [];
  const barInk = s => s>=75 ? 'var(--good)' : s>=50 ? 'var(--warn)' : 'var(--bad)';
  box.innerHTML = `<div class="fp-head">
      <b>${esc(r.f.name)}</b>
      <span class="fp-score"><span class="grade ${e.pass?cls(e.total):'s-bad'}">${e.grade}</span><span class="n">${e.total}</span></span>
    </div>
    ${e.pass ? '' : `<p class="callout warn" style="margin:0 0 12px;font-size:.82rem">ไม่ผ่านเกณฑ์: ${esc(e.fails.join(' · '))}</p>`}
    ${alloc.length ? '<div class="fp-donut"><canvas id="panelDonut"></canvas></div>' : ''}
    ${CRIT.map((c,i)=>{ const v = e.crit[c.k].score;
      return `<div class="fp-crit"><span class="nm">${i+1}. ${esc(c.name)}</span><span class="bar"><i style="width:${v}%;background:${barInk(v)}"></i></span><span class="pv">${v}</span></div>`;
    }).join('')}
    <div class="fp-sec">เหตุผล</div>
    <ul class="reasons">${CRIT.map((c,i)=>e.crit[c.k].reasons.map(x=>`<li class="${x.lvl}"><span class="crit">${i+1}. ${esc(c.name)}:</span> ${esc(x.t)}</li>`).join('')).join('')}</ul>`;
  if (alloc.length) drawDonut('panelDonut', alloc);
}

function renderScreen(){
  const p = state.profile;
  const res = state.funds.map(f=>({f, e:evaluate(f,p)})).sort((a,b)=>(b.e.pass-a.e.pass)||(b.e.total-a.e.total));
  // เลือกกองให้เสร็จก่อนสร้างตาราง ไม่งั้นแถวแรกจะไม่ถูกไฮไลต์ในรอบแรก
  if (!res.some(r=>r.f.id===selectedFundId)) selectedFundId = res.length ? res[0].f.id : null;
  const passN = res.filter(r=>r.e.pass).length;
  $('#screenSub').textContent = `ผ่านเกณฑ์ ${passN} จาก ${res.length} กอง · โปรไฟล์: ${$('[data-p=goal]').selectedOptions[0].text}, ${p.years} ปี, รับความเสี่ยงได้ระดับ ${p.riskTol}`;
  $('#screenTable').innerHTML = `<thead><tr><th>#</th><th>กองทุน</th><th>เกรด</th><th class="num">คะแนน</th>${CRIT.map((c,i)=>`<th title="${c.name}">${i+1}. ${c.name}</th>`).join('')}<th>สถานะ</th></tr></thead><tbody>${
    res.map((r,i)=>`<tr class="${r.f.id===selectedFundId?'sel':''}"><td>${i+1}</td><td><button type="button" class="linklike" data-sel="${esc(r.f.id)}">${esc(r.f.name)}</button></td>
      <td><span class="grade ${r.e.pass?cls(r.e.total):'s-bad'}">${r.e.grade}</span></td>
      <td class="num"><b>${r.e.total}</b></td>
      ${CRIT.map(c=>`<td><span class="cell ${cls(r.e.crit[c.k].score)}">${r.e.crit[c.k].score}</span></td>`).join('')}
      <td>${r.e.pass?'<span class="cell s-good">ผ่าน</span>':`<span class="cell s-bad" title="${esc(r.e.fails.join(', '))}">ไม่ผ่าน</span>`}</td></tr>`).join('')
  }</tbody>`;
  document.querySelectorAll('[data-sel]').forEach(b=>b.addEventListener('click',()=>{
    selectedFundId = b.dataset.sel;
    document.querySelectorAll('#screenTable tr').forEach(tr=>tr.classList.toggle('sel', !!tr.querySelector(`[data-sel="${CSS.escape(selectedFundId)}"]`)));
    renderFundPanel(res);
  }));
  renderFundPanel(res);

  $('#weightInputs').innerHTML = CRIT.map((c,i)=>`<label class="f">${i+1}. ${c.name}<input type="number" min="0" max="100" step="1" data-w="${c.k}" value="${esc(num(state.weights[c.k]))}"></label>`).join('');
  document.querySelectorAll('[data-w]').forEach(el=>el.addEventListener('change',()=>{ state.weights[el.dataset.w]=num(el.value); save(); renderScreen(); }));

  // portfolio
  const passed = res.filter(r=>r.e.pass);
  Object.keys(state.portfolio).forEach(id=>{ if(!passed.some(r=>r.f.id===id)) delete state.portfolio[id]; });
  const wsum = Object.values(state.portfolio).reduce((t,v)=>t+num(v),0);
  $('#pfTable').innerHTML = passed.length ? `<thead><tr><th>เลือก</th><th>กองทุน</th><th>เกรด</th><th class="num">สัดส่วน (%)</th><th class="num">หลังปรับ</th><th class="num">ผลตอบแทนคาด</th><th class="num">SD</th><th class="num">TER</th></tr></thead><tbody>${
    passed.map(r=>{ const A=fundAssumptions(r.f); const on = r.f.id in state.portfolio; const w=num(state.portfolio[r.f.id]);
      return `<tr class="pf-row"><td><input type="checkbox" data-pf="${esc(r.f.id)}" ${on?'checked':''}></td><td>${esc(r.f.name)}</td><td>${r.e.grade}</td>
      <td class="num"><input type="number" min="0" step="5" data-pfw="${esc(r.f.id)}" value="${on?w:''}" ${on?'':'disabled'}></td>
      <td class="num">${on&&wsum?(w/wsum*100).toFixed(1)+'%':'-'}</td>
      <td class="num">${A.r.toFixed(1)}%</td><td class="num">${A.sd.toFixed(1)}%</td><td class="num">${A.ter.toFixed(2)}%</td></tr>`; }).join('')}</tbody>`
    : '<tbody><tr><td class="muted">ยังไม่มีกองที่ผ่านการคัดกรอง</td></tr></tbody>';
  $('#pfSum').textContent = passed.length ? `สัดส่วนที่กรอกรวม ${wsum}% → ปรับเป็น 100% อัตโนมัติ` : '';
  document.querySelectorAll('[data-pf]').forEach(el=>el.addEventListener('change',()=>{
    if (el.checked) state.portfolio[el.dataset.pf] = Object.keys(state.portfolio).length ? 0 : 100;
    else delete state.portfolio[el.dataset.pf];
    if (el.checked && !state.portfolio[el.dataset.pf]){ const n=Object.keys(state.portfolio).length; Object.keys(state.portfolio).forEach(k=>state.portfolio[k]=Math.round(100/n)); }
    save(); renderScreen(); }));
  document.querySelectorAll('[data-pfw]').forEach(el=>el.addEventListener('change',()=>{ state.portfolio[el.dataset.pfw]=num(el.value); save(); renderScreen(); }));
  save();
}

/* ============ UI: พอร์ตของฉัน ============
   มูลค่าจริง = จำนวนหน่วยที่ผู้ใช้กรอก x ราคาต่อหน่วยล่าสุดจาก ก.ล.ต.
   กองที่ยังไม่มีราคา (ข้อมูลรอบเก่า) จะไม่ถูกนับรวม และบอกไว้ชัดๆ แทนที่จะเดาเป็น 0 */
const priceOf = f => (f.sec && f.sec.price && f.sec.price.nav) || null;
function renderHoldings(){
  if (!$('#holdTable')) return;
  const rows = state.funds.map(f=>{
    const h = state.holdings[f.id] || {u:0, c:0};
    const nav = priceOf(f);
    const value = nav && h.u ? h.u*nav : null;
    const cost  = h.u && h.c ? h.u*h.c : null;
    return {f, u:h.u||'', c:h.c||'', nav, value, cost,
            pl: (value!=null && cost!=null) ? value-cost : null,
            noPrice: h.u>0 && !nav};
  });
  const held = rows.filter(r=>r.u>0);
  const totV = held.reduce((t,r)=>t+(r.value||0),0);
  const totC = held.reduce((t,r)=>t+(r.cost||0),0);
  const pl = totV && totC ? totV-totC : 0;
  const feeYr = held.reduce((t,r)=>t+(r.value||0)*num(r.f.ter)/100,0);
  const wTer = totV ? feeYr/totV*100 : 0;

  $('#pfKpis').innerHTML = [
    ['มูลค่าปัจจุบัน', totV?fmtB(totV):'—', held.length?`${held.length} กองทุน`:'ยังไม่ได้กรอกจำนวนหน่วย'],
    ['ต้นทุนรวม', totC?fmtB(totC):'—', totC?'จากต้นทุนเฉลี่ยที่กรอก':'กรอกต้นทุนเพื่อดูกำไร/ขาดทุน'],
    ['กำไร/ขาดทุน', (totV&&totC)?`${pl>=0?'+':'−'}${fmtB(Math.abs(pl))}`:'—', (totV&&totC)?pct(pl/totC*100,2):''],
    ['ค่าธรรมเนียมต่อปี (ประมาณ)', totV?fmtB(feeYr):'—', totV?`TER ถ่วงน้ำหนัก ${wTer.toFixed(2)}%`:'']
  ].map(([k,v,d])=>`<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${esc(d)}</div></div>`).join('');

  $('#holdTable').innerHTML = state.funds.length ? `<thead><tr><th>กองทุน</th><th class="num">หน่วย</th><th class="num">ต้นทุน/หน่วย</th><th class="num">NAV ล่าสุด</th><th class="num">มูลค่า</th><th class="num">กำไร/ขาดทุน</th><th class="num">สัดส่วน</th></tr></thead><tbody>${
    rows.map(r=>`<tr class="pf-row">
      <td>${esc(r.f.name)}${r.noPrice?' <span class="tag">ยังไม่มีราคา</span>':''}</td>
      <td class="num"><input type="number" min="0" step="1" data-hu="${esc(r.f.id)}" value="${r.u}"></td>
      <td class="num"><input type="number" min="0" step="0.0001" data-hc="${esc(r.f.id)}" value="${r.c}"></td>
      <td class="num">${r.nav!=null?r.nav.toFixed(4):'—'}</td>
      <td class="num">${r.value!=null?fmtB(r.value):'—'}</td>
      <td class="num" ${r.pl!=null?`style="color:var(${r.pl>=0?'--good':'--bad'})"`:''}>${r.pl!=null?`${r.pl>=0?'+':'−'}${fmtB(Math.abs(r.pl))}`:'—'}</td>
      <td class="num">${(r.value!=null&&totV)?(r.value/totV*100).toFixed(1)+'%':'—'}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">ยังไม่มีกองทุน — เพิ่มในแท็บ "วางแผนลงทุน" ก่อน</td></tr></tbody>';

  const asOf = held.map(r=>r.f.sec && r.f.sec.price && r.f.sec.price.navDate).filter(Boolean).sort().pop();
  $('#holdNote').textContent = asOf ? `ราคาต่อหน่วย ณ ${asOf} · มูลค่าคำนวณจากราคานี้ ไม่ใช่ราคาเรียลไทม์` : '';

  document.querySelectorAll('[data-hu],[data-hc]').forEach(el=>el.addEventListener('change',()=>{
    const id = el.dataset.hu || el.dataset.hc, cur = state.holdings[id] || {u:0,c:0};
    const v = cleanNum(el.value,0,1e12) || 0;
    if (el.dataset.hu) cur.u = v; else cur.c = v;
    if (cur.u>0) state.holdings[id] = cur; else delete state.holdings[id];
    save(); renderHoldings();
  }));

  // สัดส่วนตามประเภทสินทรัพย์
  const byClass = {};
  held.forEach(r=>{ if (r.value!=null) byClass[r.f.assetClass] = (byClass[r.f.assetClass]||0) + r.value; });
  const slices = Object.entries(byClass).sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>[(ASSET[k]||ASSET.mixed).label, +(v/totV*100).toFixed(2)]);
  $('#holdLegend').innerHTML = slices.map((x,i)=>`<li><span class="sw" style="background:var(${DONUT[i%DONUT.length]})"></span><span class="nm">${esc(x[0])}</span><span class="pv">${x[1].toFixed(1)}%</span></li>`).join('')
    || '<li class="muted">ยังไม่มีข้อมูลพอคำนวณ</li>';
  drawDonut('holdDonut', slices);

  const al = [];
  const missing = rows.filter(r=>r.noPrice).length;
  if (missing) al.push(['warn', `${missing} กองยังไม่มีราคาต่อหน่วย — ข้อมูลชุดนี้สร้างก่อนที่โปรแกรมจะเก็บราคา กด Run workflow หนึ่งรอบแล้วกด "อัปเดตจาก ก.ล.ต." ในการ์ดกองนั้น`]);
  if (totV && wTer>1.5) al.push(['warn', `ค่าธรรมเนียมรวมทั้งพอร์ต ${wTer.toFixed(2)}%/ปี คิดเป็น ${fmtB(feeYr)} ถูกหักทุกปีไม่ว่าพอร์ตจะกำไรหรือขาดทุน`]);
  held.filter(r=>r.pl!=null && r.pl<0).forEach(r=>al.push(['warn', `${r.f.name.split(' —')[0]} ขาดทุน ${fmtB(Math.abs(r.pl))} (${pct(r.pl/r.cost*100,1)})`]));
  if (held.length===1) al.push(['', 'พอร์ตมีกองเดียว — กระจายไปสินทรัพย์หรือภูมิภาคอื่นเพื่อลดความเสี่ยง']);
  if (!held.length) al.push(['', 'กรอกจำนวนหน่วยในตารางด้านบนเพื่อเริ่มติดตามพอร์ต']);
  $('#holdAlerts').innerHTML = al.map(([c,t])=>`<div class="callout ${c}">${esc(t)}</div>`).join('');
}

/* ============ UI: plan ============ */
const charts = {};
$('#modeSeg').addEventListener('click', e=>{ const m=e.target.dataset.mode; if(m){ state.profile.mode=m; save(); renderPlan(); } });
$('#showReal').addEventListener('change', e=>{ state.showReal=e.target.checked; save(); renderPlan(); });

function portfolioLegs(){
  const ids = Object.keys(state.portfolio).filter(id=>state.funds.some(f=>f.id===id));
  const tot = ids.reduce((t,id)=>t+num(state.portfolio[id]),0);
  if (!ids.length || tot<=0) return [];
  return ids.map(id=>{ const f=state.funds.find(x=>x.id===id); return {...fundAssumptions(f), w:num(state.portfolio[id])/tot, name:f.name}; })
            .filter(L=>L.w>0);
}
function renderPlan(){
  const p = state.profile;
  document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('active', b.dataset.mode===p.mode));
  $('#showReal').checked = !!state.showReal;
  // make sure portfolio only has passing funds
  state.funds.forEach(f=>{ if (f.id in state.portfolio && !evaluate(f,p).pass) delete state.portfolio[f.id]; });
  const legs = portfolioLegs();
  $('#planEmpty').style.display = legs.length ? 'none' : 'block';
  $('#planBody').style.display = legs.length ? 'block' : 'none';
  const years = Math.max(1, Math.round(num(p.years,10)));
  const lump = p.mode==='dca' ? 0 : num(p.lump);
  const monthly = p.mode==='lump' ? 0 : num(p.monthly);
  $('#modeSub').textContent = {lump:`ลงทุนก้อนเดียว ${fmtB(num(p.lump))} ตั้งแต่วันแรก`, dca:`ทยอยลงทุน ${fmtB(num(p.monthly))} ทุกเดือน`, mix:`เงินก้อน ${fmtB(num(p.lump))} + DCA ${fmtB(num(p.monthly))}/เดือน`}[p.mode] + ` · ระยะ ${years} ปี (แก้ตัวเลขได้ที่แท็บ ①)`;
  if (!legs.length) return;
  if (lump+monthly<=0){ $('#planEmpty').textContent='จำนวนเงินลงทุนเป็น 0 — กรอกเงินก้อนหรือเงินรายเดือนที่แท็บ ①'; $('#planEmpty').style.display='block'; $('#planBody').style.display='none'; return; }

  const run = z => simulate({lump, monthly, years, legs, z});
  const bad = run(-1), mid = run(0), good = run(1);
  const infl = num(p.inflation)/100;
  const real = mid.map(r=>r.value/Math.pow(1+infl, r.year));
  const last = mid[mid.length-1];
  const wR = legs.reduce((t,L)=>t+L.w*L.r,0), wTer = legs.reduce((t,L)=>t+L.w*L.ter,0), wSd = legs.reduce((t,L)=>t+L.w*L.sd,0);
  const gain = last.value-last.principal;

  $('#kpis').innerHTML = [
    ['เงินต้นรวม', fmtB(last.principal), `${years} ปี`],
    ['มูลค่าคาดการณ์ (กลาง)', fmtB(last.value), `กำไร ${fmtB(gain)} (${pct(gain/last.principal*100)})`],
    ['กรณีแย่ – ดี', `${fmtShort(bad.at(-1).value)} – ${fmtShort(good.at(-1).value)}`, 'บาท ณ ปีสุดท้าย'],
    ['มูลค่าหลังหักเงินเฟ้อ', fmtB(real.at(-1)), `เงินเฟ้อ ${num(p.inflation)}%/ปี`],
    ['ค่าธรรมเนียมรวม', fmtB(last.fees), `TER เฉลี่ยพอร์ต ${wTer.toFixed(2)}%`]
  ].map(([k,v,d])=>`<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');

  $('#projSub').textContent = `ผลตอบแทนตลาดคาดหวังของพอร์ต ${wR.toFixed(1)}%/ปี (ก่อนหัก TER) · กรณีแย่/ดี = ผลตอบแทนเฉลี่ยต่อปีต่ำ/สูงกว่าคาด 1 ส่วนเบี่ยงเบน (σ/√${years}) ≈ ${(wR - wSd/Math.sqrt(years)).toFixed(1)}% / ${(wR + wSd/Math.sqrt(years)).toFixed(1)}% ต่อปี`;

  const C = {bad:css('--c-bad'), mid:css('--c-mid'), good:css('--c-good'), pr:css('--c-principal'), real:css('--c-real'), grid:css('--grid'), text:css('--muted')};
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = C.text;
  const moneyTick = {callback:v=>fmtShort(v)};
  const tip = {callbacks:{label:c=>`${c.dataset.label}: ${fmtB(c.parsed.y)}`}};
  const baseOpts = {responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{legend:{position:'bottom',labels:{boxWidth:12,usePointStyle:true}}, tooltip:tip},
    scales:{x:{grid:{display:false}}, y:{grid:{color:C.grid}, ticks:moneyTick, beginAtZero:true}}};
  const labels = mid.map(r=>'ปี '+r.year);
  const line = (label, data, color, extra={}) => ({label, data, borderColor:color, backgroundColor:color, pointRadius:years>20?0:2, borderWidth:2, tension:.2, ...extra});

  const ds = [
    line('กรณีดี', good.map(r=>r.value), C.good),
    line('กรณีกลาง', mid.map(r=>r.value), C.mid, {borderWidth:3}),
    line('กรณีแย่', bad.map(r=>r.value), C.bad),
    line('เงินต้นสะสม', mid.map(r=>r.principal), C.pr, {borderDash:[6,4], pointRadius:0})
  ];
  if (state.showReal) ds.push(line('กลาง (หลังหักเงินเฟ้อ)', real, C.real, {borderDash:[2,3], pointRadius:0}));
  draw('chProj', {type:'line', data:{labels, datasets:ds}, options:baseOpts});

  // lump vs DCA with same total principal
  const P = last.principal;
  const cmp = [-1,0,1].map(z=>[
    simulate({lump:P, monthly:0, years, legs, z}).at(-1).value,
    simulate({lump:0, monthly:P/(12*years), years, legs, z}).at(-1).value]);
  $('#cmpSub').textContent = `ใช้เงินต้นเท่ากัน ${fmtB(P)}: ลงก้อนเดียววันแรก vs ทยอย ${fmtB(P/(12*years))}/เดือน ตลอด ${years} ปี`;
  draw('chCmp', {type:'bar', data:{labels:['กรณีแย่','กรณีกลาง','กรณีดี'], datasets:[
      {label:'ก้อนเดียว', data:cmp.map(c=>c[0]), backgroundColor:C.mid, borderRadius:4},
      {label:'DCA', data:cmp.map(c=>c[1]), backgroundColor:C.good, borderRadius:4}]},
    options:{...baseOpts, scales:{x:{grid:{display:false}}, y:{grid:{color:C.grid}, ticks:moneyTick, beginAtZero:true}}}});

  // fee impact
  const cheap = simulate({lump, monthly, years, legs, z:0, terOverride:0.2, noLoad:true});
  const lost = cheap.at(-1).value - last.value;
  $('#feeSub').textContent = lost>0 ? `ถ้าพอร์ตเสียค่าใช้จ่ายเพียง 0.2%/ปี และไม่มีค่าธรรมเนียมซื้อขาย จะมีเงินมากขึ้น ${fmtB(lost)} (${pct(lost/last.value*100)})` : 'ค่าธรรมเนียมของพอร์ตนี้ต่ำอยู่แล้ว';
  draw('chFee', {type:'line', data:{labels, datasets:[
      line(`พอร์ตที่เลือก (TER ${wTer.toFixed(2)}%)`, mid.map(r=>r.value), C.mid, {borderWidth:3}),
      line('ถ้า TER 0.2% ไม่มีค่าซื้อขาย', cheap.map(r=>r.value), C.good, {borderDash:[6,4]})]}, options:baseOpts});

  // table
  $('#yearTable').innerHTML = `<thead><tr><th>ปี</th><th class="num">เงินต้นสะสม</th><th class="num">กรณีแย่</th><th class="num">กรณีกลาง</th><th class="num">กรณีดี</th><th class="num">กลาง (หลังเงินเฟ้อ)</th><th class="num">ค่าธรรมเนียมสะสม</th></tr></thead><tbody>${
    mid.map((r,i)=>`<tr><td>${r.year}</td><td class="num">${fmtB(r.principal)}</td><td class="num">${fmtB(bad[i].value)}</td><td class="num"><b>${fmtB(r.value)}</b></td><td class="num">${fmtB(good[i].value)}</td><td class="num">${fmtB(real[i])}</td><td class="num">${fmtB(r.fees)}</td></tr>`).join('')}</tbody>`;

  // advice
  const adv = [];
  const lumpWins = cmp[1][0] > cmp[1][1];
  adv.push(['', `<b>ก้อนเดียว vs DCA:</b> ในกรณีกลาง การลงก้อนเดียว${lumpWins?'ได้มากกว่า':'ได้น้อยกว่า'} DCA ${fmtB(Math.abs(cmp[1][0]-cmp[1][1]))} เพราะเงินอยู่ในตลาดนานกว่า ตลาดที่มีแนวโน้มขึ้นระยะยาวจึงมักเอื้อให้ลงก้อนเดียว — แต่ DCA ช่วยลดความเสี่ยงจากการซื้อผิดจังหวะ ลดความกดดันทางใจ และเหมาะกับคนที่มีรายได้เป็นรายเดือน`]);
  if (num(p.lump)>0 && p.mode!=='lump') adv.push(['', 'ถ้ามีเงินก้อนแต่กังวลเรื่องจังหวะตลาด ทางสายกลางคือแบ่งทยอยลงทุนภายใน 6–12 เดือน แทนการกระจายยาวทั้งช่วง']);
  if (wTer>1) adv.push(['warn', `TER เฉลี่ยของพอร์ต ${wTer.toFixed(2)}% ค่อนข้างสูง — ลองหากองดัชนีที่ลงทุนในสินทรัพย์เดียวกันแต่ค่าธรรมเนียมต่ำกว่า`]);
  if (real.at(-1) < last.principal) adv.push(['warn', 'มูลค่าหลังหักเงินเฟ้อต่ำกว่าเงินต้น — พอร์ตนี้อาจโตไม่ทันเงินเฟ้อตามสมมติฐานปัจจุบัน']);
  if (bad.at(-1).value < last.principal) adv.push(['warn', `ในกรณีแย่ พอร์ตยังขาดทุน ${fmtB(last.principal-bad.at(-1).value)} ณ ปีที่ ${years} — ต้องมั่นใจว่าไม่จำเป็นต้องใช้เงินก้อนนี้ก่อนกำหนด`]);
  if (legs.length===1) adv.push(['', 'พอร์ตมีกองเดียว — พิจารณากระจายไปยังสินทรัพย์หรือภูมิภาคอื่นเพื่อลดความเสี่ยง']);
  adv.push(['', 'ทบทวนพอร์ตอย่างน้อยปีละครั้ง และปรับสัดส่วน (Rebalance) กลับสู่เป้าหมาย']);
  $('#advice').innerHTML = adv.map(([c,t])=>`<div class="callout ${c}">${t}</div>`).join('');
  save();
}
function draw(id, cfg){ if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }

/* ============ init ============ */
buildForm();
renderFunds();
secInit();
try{ const t = localStorage.getItem(KEY+'.tab'); if (t && $('#panel-'+t)) showTab(t); }catch(e){}
try{ const sec = localStorage.getItem(KEY+'.sec'); if (sec) showSection(sec); }catch(e){}
// Chart.js bakes the palette in when a chart is built, so switching theme needs a redraw.
// The theme is set by data-theme on <html>, not by the OS, so watch the attribute.
new MutationObserver(()=>{
  document.querySelectorAll('#fundList details.port[open]').forEach(d=>drawPort(d.dataset.port));
  if ($('#panel-plan').classList.contains('active')) renderPlan();
}).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
