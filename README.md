# โปรแกรมคัดกรองกองทุน & วางแผนการลงทุน

คัดกรองกองทุนรวม/ETF ตามเกณฑ์ 8 ข้อ (อ้างอิงคลิป Money Matters EP.337) จัดพอร์ต และคาดการณ์ผลลัพธ์รายปีแบบลงทุนก้อนเดียว / DCA
ดึงข้อมูล Fund Fact Sheet จาก [SEC Open API](https://secopendata.sec.or.th) ได้ 2 แบบ

| แบบ | เปิดอย่างไร | ข้อมูล ก.ล.ต. | ต้องมีอะไร |
|---|---|---|---|
| **เว็บ GitHub Pages** | `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/` | พิมพ์ค้นหาได้ทุกกองที่เปิดขาย อัปเดตทุกสัปดาห์ (อาทิตย์ 03:00) | บัญชี GitHub + API Key ใน GitHub Secrets |
| **บนเครื่องตัวเอง** | ดับเบิลคลิก `start.bat` → `http://127.0.0.1:8765` | ค้นหาทุกกองแบบสด | Python 3 + API Key ใน `sec-config.json` |

> เครื่องมือนี้เพื่อการศึกษา ไม่ใช่คำแนะนำการลงทุน

---

## ทำงานอย่างไร (GitHub Pages)

```
GitHub Actions (ทุกสัปดาห์ / กดสั่งเอง)
  └─ sec_build.py ใช้ API Key จาก Secrets ดึงข้อมูลทุกกองแบบ bulk
       ├─ data/index.json          รายชื่อทุกชนิดหน่วยลงทุน (ใช้พิมพ์ค้นหา)
       └─ data/funds/<บลจ.>.json    รายละเอียดกอง แยกตาม บลจ. (โหลดเฉพาะตอนกด "เพิ่ม")
  └─ เก็บข้อมูลไว้ที่ branch "data" (มีแค่ 1 commit เสมอ ไม่ทำให้ repo บวม)
  └─ deploy หน้าเว็บ + ข้อมูลขึ้น GitHub Pages
```

หน้าเว็บไม่เคยเห็น API Key — มีแค่ไฟล์ข้อมูลที่สร้างไว้แล้ว

---

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ | ขึ้น GitHub? |
|---|---|---|
| `index.html`, `app.js`, `vendor/chart.umd.min.js` | หน้าโปรแกรม | ✅ |
| `sec_build.py` | สร้างชุดข้อมูลให้ GitHub Pages | ✅ |
| `sec_server.py`, `start.bat` | เซิร์ฟเวอร์บนเครื่อง (ถือคีย์แทนหน้าเว็บ) | ✅ (ไม่มีคีย์) |
| `watchlist.txt` | รายชื่อกองสำหรับโหมดสำรอง | ✅ |
| `.github/workflows/update-fund-data.yml` | ตั้งเวลาดึงข้อมูล + deploy เว็บ | ✅ |
| `sec-config.json` | **API Key ของคุณ** | ❌ กันไว้ใน `.gitignore` |
| `sec-config.example.json` | แม่แบบว่างสำหรับเครื่องใหม่ | ✅ |
| `data/` | ผลจากการรัน `sec_build.py` บนเครื่อง | ❌ (บน GitHub อยู่ใน branch `data`) |

---

## ตั้งค่า GitHub Pages ครั้งแรก

### 1. สร้าง repository
1. เข้า https://github.com แล้วล็อกอิน (สมัครฟรีถ้ายังไม่มี)
2. มุมขวาบน **+** → **New repository**
3. **Repository name**: เช่น `fund-screener`
4. เลือก **Public** (จำเป็นสำหรับ GitHub Pages แบบฟรี)
5. **ไม่ต้อง** ติ๊ก Add README / .gitignore / license
6. กด **Create repository**

### 2. ใส่ API Key เป็น Secret (ทำก่อนอัปโหลดโค้ด)
1. ในหน้า repo → **Settings** → เมนูซ้าย **Secrets and variables** → **Actions** → แท็บ **Secrets**
2. **New repository secret** → Name: `SEC_API_KEY` · Secret: Primary key → **Add secret**
3. **New repository secret** → Name: `SEC_API_KEY_SECONDARY` · Secret: Secondary key → **Add secret**

Secret ถูกเข้ารหัส ไม่มีใครเห็นค่า และถูกซ่อนเป็น `***` ใน log อัตโนมัติ

### 3. เปิด GitHub Pages
1. **Settings** → **Pages** → **Source** เลือก **GitHub Actions**
2. ถ้ายังเลือกไม่ได้เพราะ repo ยังว่าง ให้ทำขั้นตอน 4 ก่อน แล้วกลับมาตั้งค่านี้ จากนั้น Actions → งานที่ล้มเหลว → **Re-run all jobs**

### 4. อัปโหลดโค้ด
เปิด PowerShell หรือ Terminal ในโฟลเดอร์นี้ แล้วรันทีละบรรทัด

```bash
git add -A
git status
git commit -m "Initial commit: fund screener"
git remote add origin https://github.com/<ชื่อผู้ใช้>/fund-screener.git
git push -u origin main
```

- หลัง `git status` **ต้องไม่เห็น `sec-config.json`** ถ้าเห็นให้หยุดและอย่า commit
- ตอน `git push` ครั้งแรกจะมีหน้าต่างให้ล็อกอิน GitHub
- **อย่าใช้ปุ่ม "Upload files" บนเว็บ GitHub** เพราะไม่อ่าน `.gitignore` อาจอัปโหลดไฟล์คีย์ขึ้นไป

### 5. ตรวจผลรอบแรก
1. แท็บ **Actions** → งาน **Update fund data & deploy site**
   (รอบแรกที่ดึงทุกกองอาจใช้เวลาหลายนาทีถึงราวชั่วโมง ขึ้นกับจำนวนกองและความเร็ว API)
2. กดเข้าไปที่ขั้นตอน **Fetch data from SEC Open API** จะเห็นบรรทัดสรุป เช่น
   `บันทึก 5,xxx รายการ (xx บลจ.) · เรียก API x,xxx ครั้ง · xxx วินาที`
   **จดจำนวนครั้งที่เรียก API ไว้** เพื่อเทียบกับโควตาของคีย์
3. ✅ เขียว → เปิดเว็บ → แท็บ ② → พิมพ์ชื่อกอง → **ค้นหา** → **เพิ่ม**
4. ❌ แดง → ดูหัวข้อ "แก้ปัญหา"

---

## ปรับการทำงาน (ไม่ต้องแก้โค้ด)
**Settings → Secrets and variables → Actions → แท็บ Variables → New repository variable**

| Variable | ค่า | ใช้เมื่อ |
|---|---|---|
| `DATA_MODE` | `all` (ค่าเริ่มต้น) หรือ `watchlist` | โควตา API ไม่พอดึงทุกกอง → เปลี่ยนเป็น `watchlist` แล้วแก้ `watchlist.txt` |
| `SEC_MAX_CALLS` | ตัวเลข เช่น `8000` (ค่าเริ่มต้น) | จำนวนครั้งสูงสุดต่อรอบ ถ้าเกินระบบหยุดเองและใช้ข้อมูลรอบก่อน |

**เปลี่ยนความถี่:** แก้บรรทัด `cron` ใน `.github/workflows/update-fund-data.yml`
เช่น `"0 20 * * *"` = ทุกวัน 03:00 · `"0 20 1 * *"` = วันที่ 1 ของเดือน

**สั่งอัปเดตทันที:** Actions → Update fund data & deploy site → **Run workflow**

---

## ใช้งานประจำ

### แก้ไฟล์บนเครื่องแล้วอัปโหลดซ้ำ
```bash
git pull --rebase
git add -A
git commit -m "อธิบายสิ่งที่แก้"
git push
```

### ข้อมูลส่วนตัวอยู่ที่ไหน
โปรไฟล์ จำนวนเงิน และพอร์ตที่กรอก **เก็บในเบราว์เซอร์ของแต่ละคนเท่านั้น** ไม่ถูกส่งขึ้น GitHub
ใช้ Export JSON เพื่อสำรอง และปุ่ม "ล้างข้อมูลทั้งหมด" ท้ายหน้าเมื่อใช้เครื่องร่วมกับคนอื่น

---

## ใช้บนเครื่องตัวเอง
1. ติดตั้ง Python 3 (https://www.python.org) ถ้ายังไม่มี
2. ดับเบิลคลิก `start.bat` ครั้งแรก → ไฟล์ `sec-config.json` จะถูกสร้าง → ใส่คีย์ → เปิด `start.bat` ใหม่
3. Mac/Linux: `python3 sec_server.py`
4. ปิดหน้าต่างดำเมื่อเลิกใช้

ทดลองสร้างชุดข้อมูลแบบ GitHub บนเครื่อง: `py sec_build.py` (ได้โฟลเดอร์ `data/` ซึ่งไม่ถูก commit)

เซิร์ฟเวอร์รับเฉพาะการเชื่อมต่อจากเครื่องตัวเองและปฏิเสธคำขอจากเว็บไซต์อื่น — **อย่าแก้ `HOST` เป็น `0.0.0.0`**

---

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Fetch data แดง: "ไม่พบ API Key" | ยังไม่ได้ตั้ง Secret `SEC_API_KEY` หรือสะกดผิด → ทำขั้นตอน 2 แล้ว Run workflow |
| "API Key ใช้ไม่ได้ (401/403)" | คีย์ผิด / ยังไม่ได้ Subscribe API Product → ตรวจในเว็บ ก.ล.ต. แล้ว Update secret |
| "ใช้ API ครบ … ครั้งแล้ว" | ข้อมูลมากกว่างบที่ตั้ง → เพิ่ม `SEC_MAX_CALLS` หรือใช้ `DATA_MODE = watchlist` (เว็บยังใช้ข้อมูลรอบก่อน) |
| ข้อความ 429 ใน log | เรียก API ถี่/เกินโควตา → ลดความถี่ (cron) หรือใช้โหมด watchlist |
| deploy แดง | ยังไม่ได้ตั้ง Pages Source เป็น GitHub Actions → ขั้นตอน 3 แล้ว Re-run |
| deploy เขียวแต่ "Report data problems" แดง | เว็บขึ้นแล้ว (ด้วยข้อมูลรอบก่อนถ้ามี) แต่ดึงข้อมูลรอบนี้ไม่สำเร็จ → ดู log Fetch data |
| อีเมลแจ้ง scheduled workflow ถูกปิด | repo ไม่มีความเคลื่อนไหว 60 วัน → Actions → เลือกงาน → **Enable workflow** |
| ค่าบางช่องว่าง/ดูแปลก | ข้อมูลจริงอาจเขียนต่างจากเอกสาร → แก้ในฟอร์ม และแจ้งชื่อกองเพื่อปรับตัวแปลงข้อมูล |

---

## ความปลอดภัย
- คีย์อยู่ใน GitHub Secrets / `sec-config.json` เท่านั้น ไม่เคยอยู่ในหน้าเว็บ ไฟล์ข้อมูล หรือ log
- งานของ Actions เริ่มได้จาก schedule / push ของคุณ / ปุ่ม Run เท่านั้น — Pull Request จากคนอื่น (fork) เข้าถึง Secrets ไม่ได้
- Actions ถูกล็อกเวอร์ชันด้วย commit SHA และได้สิทธิ์ขั้นต่ำ (เขียน branch `data` และ deploy Pages เท่านั้น)
- มีงบจำนวนครั้งเรียก API ต่อรอบ กันโควตาของคีย์หมดโดยไม่ตั้งใจ
- หน้าเว็บมี Content Security Policy ไม่โหลดสคริปต์ภายนอก และกรองข้อมูลทุกช่องก่อนแสดง (รวมข้อมูลจาก ก.ล.ต.)
- ถ้าคีย์หลุด: Regenerate คีย์ในบัญชี SEC Open API แล้วอัปเดต Secret และ `sec-config.json`
- repo, branch `data` และ log ของ Actions เป็นสาธารณะ (ไม่มีคีย์หรือข้อมูลส่วนตัว)
- ข้อมูลกองทุนทั้งหมดจะถูกเผยแพร่บนเว็บของคุณ — **ตรวจเงื่อนไขการใช้งานของ SEC Open Data เรื่องการเผยแพร่ต่อ/การอ้างอิงแหล่งที่มาก่อนเปิดใช้**
