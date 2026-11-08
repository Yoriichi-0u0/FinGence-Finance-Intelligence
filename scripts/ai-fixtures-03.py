"""One-time held-out source authoring. Does not read or generate answer labels."""
from pathlib import Path
from io import BytesIO
import csv,json,hashlib
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import pypdfium2 as pdfium
OUT=Path(__file__).resolve().parents[1]/'public/samples/ai-ingestion-increment-03'
if (OUT/'manifest.json').exists():raise SystemExit('Refusing to overwrite held-out source bytes')
OUT.mkdir(parents=True,exist_ok=True)
H=['Transaction ID','Transaction Date','Posting Date','Amount','Currency','Reference']
def csv_file(name,title,headers,rows):
 with (OUT/name).open('w',newline='') as f:csv.writer(f).writerows([[title],headers,*rows])
def excel(name,title,headers,rows):
 w=Workbook();s=w.active;s.title='Source'
 for row in [[title],headers,*rows]:s.append(row)
 w.save(OUT/name)
def document(rows):
 b=BytesIO(); c=canvas.Canvas(b,pagesize=(900,300),invariant=1);c.setFont('Helvetica-Bold',12);c.drawString(25,275,'BANK STATEMENT - SYNTHETIC - NOT CLIENT DATA'); c.setFont('Helvetica',11)
 widths=[140,150,150,190,90,130]; x=25; top=240; data=[H,*rows]
 for width in [0,*widths]:x+=width;c.line(x,top-len(data)*40,x,top)
 for n,row in enumerate(data):
  c.line(25,top-n*40,875,top-n*40);x=30
  for width,value in zip(widths,row):c.drawString(x,top-n*40-25,value);x+=width
 c.line(25,top-len(data)*40,875,top-len(data)*40);c.save();return b.getvalue()
def image(pdf):
 d=pdfium.PdfDocument(pdf);im=d[0].render(scale=2).to_pil().convert('RGB');d.close();return im
csv_file('h01.csv','BANK STATEMENT',H,[['0000701','2026-10-23','2026-10-24','9007199254740995.07','MYR','000091'],['0000702','2026-10-24','2026-10-25','-31.20','USD','000092']])
excel('h02.xlsx','GENERAL LEDGER',['Transaction ID','Transaction Date','Debit','Credit','Currency','Account Code'],[['0000801','23/10/2026','131.05','0','MYR','000210'],['0000802','24/10/2026','0','17.03','MYR','000310']])
for n in range(3,7):
 rows=[[f'00009{n}1','2026-10-23','2026-10-24','271.19','MYR',f'0000{n}1'],[f'00009{n}2','2026-10-24','2026-10-25','-42.08','MYR',f'0000{n}2']];pdf=document(rows)
 if n==3:(OUT/'h03.pdf').write_bytes(pdf)
 elif n==4:
  b=BytesIO();c=canvas.Canvas(b,pagesize=(900,300),invariant=1);c.drawImage(ImageReader(image(pdf)),0,0,width=900,height=300);c.save();(OUT/'h04.pdf').write_bytes(b.getvalue())
 elif n==5:image(pdf).save(OUT/'h05.png')
 else:image(pdf).save(OUT/'h06.jpg',quality=94)
csv_file('h07.csv','BANK STATEMENT',['Transaction ID','Transaction Date','Money In','Money Out','Currency'],[['0001001','2026-10-23','50.00','0','MYR'],['0001002','2026-10-24','0','12.50','MYR']])
excel('h08.xlsx','TRANSACTION TABLE',['Transaction ID','Transaction Date','Amount','Currency','Other'],[['0001101','2026-10-23','75.00','MYR','Fee MYR 2.00']])
files={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(OUT.iterdir()) if p.is_file()}
(OUT/'manifest.json').write_text(json.dumps({'version':'synthetic-inputs-0.3','notice':'SYNTHETIC ONLY; NOT CLIENT DATA','files':files},indent=2)+'\n');print(json.dumps({'files':len(files),'labelsReadOrWritten':False}))
