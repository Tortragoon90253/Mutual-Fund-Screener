# โปรแกรมคัดกรองกองทุน & วางแผนการลงทุน

คัดกรองกองทุนรวม/ETF ตามเกณฑ์ 8 ข้อ (อ้างอิงคลิป Money Matters EP.337) จัดพอร์ต และคาดการณ์ผลลัพธ์รายปีแบบลงทุนก้อนเดียว / DCA
ดึงข้อมูล Fund Fact Sheet จาก [SEC Open API](https://secopendata.sec.or.th) ได้ 2 แบบ

| แบบ | เปิดอย่างไร | ข้อมูล ก.ล.ต. | ต้องมีอะไร |
|---|---|---|---|
| **บนเครื่องตัวเอง** | ดับเบิลคลิก `start.bat` → `http://127.0.0.1:8765` | ค้นหาได้ทุกกองแบบสด | Python 3 + API Key ใน `sec-config.json` |
| **เว็บ GitHub Pages** | `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/` | เฉพาะกองใน `watchlist.txt` อัปเดตทุกวัน 03:00 | บัญชี GitHub + API Key ใน GitHub Secrets |

> เครื่องมือนี้เพื่อการศึกษา ไม่ใช่คำแนะนำการลงทุน

---

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ | ขึ้น GitHub? |
|---|---|---|
| `index.html`, `app.js`, `vendor/chart.umd.min.js` | หน้าโปรแกรม | ✅ |
| `sec_server.py`, `start.bat` | เซิร์ฟเวอร์บนเครื่อง (ถือคีย์แทนหน้าเว็บ) | ✅ (ไม่มีคีย์) |
| `sec_build.py`, `watchlist.txt` | สคริปต์ที่ GitHub Actions ใช้สร้าง `data/funds.json` | ✅ |
| `.github/workflows/update-fund-data.yml` | ตั้งเวลาดึงข้อมูล + deploy เว็บ | ✅ |
| `data/funds.json` | ข้อมูลกองทุนที่ดึงมา (Actions สร้างให้) | ✅ สาธารณะ |
| `sec-config.json` | **API Key ของคุณ** | ❌ ถูกกันไว้ใน `.gitignore` |
| `sec-config.example.json` | แม่แบบว่างสำหรับเครื่องใหม่ | ✅ |

---

## ตั้งค่า GitHub Pages ครั้งแรก

### 1. สร้าง repository
1. เข้า https://github.com แล้วล็อกอิน (สมัครฟรีถ้ายังไม่มี)
2. มุมขวาบน **+** → **New repository**
3. **Repository name**: เช่น `fund-screener`
4. เลือก **Public** (จำเป็นสำหรับ GitHub Pages แบบฟรี)
5. **ไม่ต้อง** ติ๊ก Add README / .gitignore / license (ปล่อยว่าง)
6. กด **Create repository** — จดที่อยู่ repo เช่น `https://github.com/<ชื่อผู้ใช้>/fund-screener.git`

### 2. ใส่ API Key เป็น Secret (ทำก่อนอัปโหลดโค้ด)
1. ในหน้า repo → **Settings** → เมนูซ้าย **Secrets and variables** → **Actions**
2. **New repository secret**
   - Name: `SEC_API_KEY` · Secret: Primary key → **Add secret**
3. **New repository secret** อีกครั้ง
   - Name: `SEC_API_KEY_SECONDARY` · Secret: Secondary key → **Add secret**

Secret ถูกเข้ารหัส ไม่มีใครเห็นค่า (รวมถึงคุณเองหลังบันทึก) และถูกซ่อนเป็น `***` ใน log อัตโนมัติ

### 3. เปิด GitHub Pages
1. **Settings** → **Pages**
2. **Source** เลือก **GitHub Actions**
3. ถ้ายังเลือกไม่ได้เพราะ repo ยังว่าง ให้ข้ามไปทำขั้นตอน 4 ก่อน แล้วค่อยกลับมาตั้งค่านี้ จากนั้นไปที่ Actions → งานที่ล้มเหลว → **Re-run all jobs**

### 4. อัปโหลดโค้ด
เปิด PowerShell หรือ Terminal ในโฟลเดอร์นี้ แล้วรันทีละบรรทัด (แทน `<ชื่อผู้ใช้>` และชื่อ repo)

```bash
git add -A
git status
git commit -m "Initial commit: fund screener"
git remote add origin https://github.com/<ชื่อผู้ใช้>/fund-screener.git
git push -u origin main
```

- หลัง `git status` **ต้องไม่เห็น `sec-config.json`** ในรายการ ถ้าเห็นให้หยุดและอย่า commit
- ตอน `git push` ครั้งแรกจะมีหน้าต่างให้ล็อกอิน GitHub ในเบราว์เซอร์
- **อย่าใช้ปุ่ม "Upload files" บนเว็บ GitHub** เพราะไม่อ่าน `.gitignore` อาจอัปโหลดไฟล์คีย์ขึ้นไปได้

### 5. ตรวจผล
1. แท็บ **Actions** → จะเห็นงาน **Update fund data & deploy site** กำลังรัน (ประมาณ 1–3 นาที)
2. ✅ เขียว = สำเร็จ → กดเข้าไปงาน **deploy** จะมีลิงก์เว็บ หรือดูที่ **Settings → Pages**
3. ❌ แดง → กดเข้าไปดูขั้นตอนที่ผิด (ดูหัวข้อ "แก้ปัญหา")
4. เปิดเว็บ → แท็บ ② ข้อมูลกองทุน → กด **ค้นหา** (ช่องว่าง) จะเห็นกองทั้งหมดใน watchlist → กด **เพิ่ม**

---

## ใช้งานประจำ

### เพิ่ม/ลบกองที่ติดตาม
1. ในหน้า repo คลิก `watchlist.txt` → ไอคอนดินสอ ✏️ (Edit)
2. เพิ่มชื่อย่อกองบรรทัดละ 1 กอง (รูปแบบอธิบายไว้ในไฟล์)
3. **Commit changes** → Actions จะรันและอัปเดตเว็บเองภายในไม่กี่นาที
4. ถ้าชื่อผิด งานยังผ่าน แต่จะมีคำเตือนสีเหลืองในหน้า Actions พร้อมชื่อที่ใกล้เคียง

### สั่งอัปเดตข้อมูลทันที
**Actions** → **Update fund data & deploy site** → **Run workflow** → **Run workflow**

### แก้ไฟล์บนเครื่องแล้วอัปโหลดซ้ำ
Actions จะ commit `data/funds.json` เข้า repo ทุกครั้งที่ข้อมูลเปลี่ยน จึงต้องดึงของล่าสุดก่อน push:

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

## ใช้บนเครื่องตัวเอง (ค้นหาได้ทุกกอง)
1. ติดตั้ง Python 3 (https://www.python.org) ถ้ายังไม่มี
2. คัดลอก `sec-config.example.json` เป็น `sec-config.json` แล้วใส่คีย์ (หรือรัน `start.bat` ครั้งแรก ไฟล์จะถูกสร้างให้)
3. ดับเบิลคลิก `start.bat` (Mac/Linux: `python3 sec_server.py`)
4. ปิดหน้าต่างดำเมื่อเลิกใช้

เซิร์ฟเวอร์รับเฉพาะการเชื่อมต่อจากเครื่องตัวเอง และปฏิเสธคำขอจากเว็บไซต์อื่น — **อย่าแก้ `HOST` เป็น `0.0.0.0`**

---

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Actions แดงที่ **Fetch data from SEC Open API** ข้อความ "ไม่พบ API Key" | ยังไม่ได้ตั้ง Secret `SEC_API_KEY` หรือสะกดชื่อผิด → ทำขั้นตอน 2 แล้ว Run workflow |
| ข้อความ "API Key ใช้ไม่ได้ (401/403)" | คีย์ผิด / หมดอายุ / ยังไม่ได้ Subscribe API Product → ตรวจในเว็บ ก.ล.ต. แล้วแก้ Secret (Update secret) |
| Actions แดงที่ **deploy** | ยังไม่ได้ตั้ง Pages Source เป็น GitHub Actions → ทำขั้นตอน 3 แล้ว Re-run jobs |
| งาน deploy เขียวแต่มี "Report data problems" แดง | เว็บขึ้นแล้วแต่ดึงข้อมูลไม่สำเร็จ → ดู log ขั้นตอน Fetch data |
| เว็บยังไม่มีข้อมูลกอง | ดู `data/funds.json` ใน repo ว่ามีหรือยัง และดูคำเตือนในหน้า Actions |
| อีเมลแจ้งว่า scheduled workflow ถูกปิด | GitHub ปิดงานตั้งเวลาเมื่อ repo ไม่มีความเคลื่อนไหว 60 วัน → Actions → เลือกงาน → **Enable workflow** |
| ค่าบางช่องว่าง/ดูแปลก | ข้อมูลจริงของ ก.ล.ต. อาจเขียนต่างจากเอกสาร → กรอก/แก้ในฟอร์ม และแจ้งชื่อกองเพื่อปรับตัวแปลงข้อมูล |

---

## ความปลอดภัย
- คีย์อยู่ใน GitHub Secrets / `sec-config.json` เท่านั้น ไม่เคยถูกส่งไปหน้าเว็บ
- ถ้าคีย์หลุด: สร้างคีย์ใหม่ (Regenerate) ในบัญชี SEC Open API แล้วอัปเดต Secret และ `sec-config.json`
- หน้าเว็บมี Content Security Policy ไม่โหลดสคริปต์จากเว็บภายนอก และกรองข้อมูลที่นำเข้าทุกช่อง
- Actions ถูกล็อกเวอร์ชันด้วย commit SHA และให้สิทธิ์ขั้นต่ำเท่าที่จำเป็น
- repo เป็นสาธารณะ: โค้ด, `data/funds.json` และ log ของ Actions ใครก็เห็นได้ (ไม่มีข้อมูลส่วนตัวหรือคีย์)
- ข้อมูลกองทุนเป็นข้อมูลเปิดของ ก.ล.ต. — ตรวจเงื่อนไขการใช้งานของ SEC Open Data เรื่องการเผยแพร่ต่อด้วย
