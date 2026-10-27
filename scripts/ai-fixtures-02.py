"""Author ONLY Increment 02 synthetic sources. Does not read/write evaluation truth."""
from pathlib import Path
from io import BytesIO
import csv,json,hashlib
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import ImageFilter
import pypdfium2 as pdfium
from pypdf import PdfReader,PdfWriter
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/samples/ai-ingestion-increment-02'
OUT.mkdir(parents=True,exist_ok=True)
# Fail rather than silently replacing an already reviewed source set.
if (OUT/'manifest.json').exists():raise SystemExit('Sources already exist; do not regenerate reviewed bytes.')
bank_h=['Transaction Code','Transaction Date','Posting Date','Amount','Currency','Transaction Narrative','Reference']
bank_r=[['000001','2026-10-19','2026-10-20','-1250.05','MYR','Supplier payment','000100'],['000002','2026-10-20','2026-10-21','20.00','MYR','Adjustment','000101'],['000003','2026-10-21','2026-10-22','0.00','USD','Zero value','']]
datasets={
 'bank-narrative':('BANK STATEMENT',bank_h,bank_r),
 'ledger-dmy':('GENERAL LEDGER',['Transaction ID','Transaction Date','DR Value','CR Value','Currency','Account Code','Reference'],[['0010','19/10/2026','100.05','0','MYR','000400','R1'],['0020','20/10/2026','0','25.01','MYR','000500','R2']]),
 'bank-direction':('BANK STATEMENT',['Transaction ID','Transaction Date','Amount','Direction','Currency','Reference'],[['00001','2026-10-19','12.50','DEBIT','MYR','B1'],['00002','2026-10-20','10','CREDIT','MYR','B2']]),
 'metadata':('TRANSACTION TABLE',['Txn No','Txn Date','Amount','CCY','Payment Narrative','Department','Internal Note'],[['000009','2026-10-19','25.05','MYR','Travel','Operations','Reviewed by clerk'],['000010','2026-10-20','-3.25','MYR','Correction','Finance','Pending filing']]),
 'bank-movements':('BANK STATEMENT',['Transaction Date','Money In','Payment Out','Currency'],[['2026-10-19','0','17.25','MYR'],['2026-10-20','25','0','MYR']]),
 'invoice':('INVOICE',['Item','Quantity','Unit Price','Total'],[['Services','2','50','100'],['Materials','1','25','25']]),
 'receipt':('RECEIPT',['Item','Quantity','Unit Price','Total'],[['Office supplies','1','18.50','18.50']]),
 'ambiguous':('TRANSACTION TABLE',['Transaction Date','Amount','Currency'],[['01/02/2026','1,234','MYR']]),
 'unknown-fee':('TRANSACTION TABLE',['Transaction Date','Amount','Currency','Service Charge'],[['2026-10-19','100','MYR','5.00']]),
 'precision':('BANK STATEMENT',bank_h,[['00000001234','2026-10-19','2026-10-20','9007199254740993.01','MYR','Exact source','000001']]),
 'validation-errors':('TRANSACTION TABLE',['Transaction ID','Transaction Date','Amount','Currency'],[['000001','2026-10-19','10.00','MYR'],['000002','2026-10-20','not-a-number','MYR'],['000003','2026-10-21','','MYR'],['000004','2026-13-01','12','MYR']]),
}
def spreadsheet(name,ext):
 title,headers,rows=datasets[name]
 if ext=='csv':
  with (OUT/f'{name}.csv').open('w',newline='') as f:csv.writer(f).writerows([[title],headers,*rows])
 else:
  wb=Workbook();ws=wb.active;ws.title='Financial document'
  for row in [[title],headers,*rows]:ws.append(row)
  wb.save(OUT/f'{name}.xlsx')
def digital(name,rows_per_page=10):
 title,headers,rows=datasets[name];widths=[max(len(str(row[n])) for row in [headers,*rows])*6.4+20 for n in range(len(headers))];width=max(650,sum(widths)+50);height=300
 b=BytesIO();c=canvas.Canvas(b,pagesize=(width,height),invariant=1)
 for start in range(0,len(rows),rows_per_page):
  c.setFont('Helvetica-Bold',12);c.drawString(25,height-28,title+' - SYNTHETIC - NOT CLIENT DATA');c.setFont('Helvetica',10)
  data=[headers,*rows[start:start+rows_per_page]];top=height-65;row_h=36
  x=25
  for w in [0,*widths]:
   x+=w;c.line(x,top-len(data)*row_h,x,top)
  for n,row in enumerate(data):
   c.line(25,top-n*row_h,width-25,top-n*row_h);x=30
   for w,value in zip(widths,row):c.drawString(x,top-n*row_h-23,str(value));x+=w
  c.line(25,top-len(data)*row_h,width-25,top-len(data)*row_h);c.showPage()
 c.save();return b.getvalue()
def images(pdf):
 doc=pdfium.PdfDocument(pdf);result=[page.render(scale=2).to_pil().convert('RGB') for page in doc];doc.close();return result
def raster_pdf(pdf):
 src=PdfReader(BytesIO(pdf));b=BytesIO();c=canvas.Canvas(b,pagesize=(float(src.pages[0].mediabox.width),300),invariant=1)
 for im in images(pdf):c.drawImage(ImageReader(im),0,0,width=float(src.pages[0].mediabox.width),height=300);c.showPage()
 c.save();return b.getvalue()
for name in ['bank-narrative','ledger-dmy','bank-direction','metadata','ambiguous']:
 for ext in ['csv','xlsx']:spreadsheet(name,ext)
spreadsheet('bank-movements','csv');spreadsheet('invoice','xlsx');spreadsheet('unknown-fee','csv');spreadsheet('precision','csv');spreadsheet('validation-errors','csv')
for name in ['bank-movements','invoice','receipt','precision']:(OUT/f'{name}.pdf').write_bytes(digital(name))
images(digital('unknown-fee'))[0].save(OUT/'unknown-fee.png')
photo=images(digital('receipt'))[0];photo=photo.rotate(2.0,resample=2,expand=True,fillcolor='white');photo.save(OUT/'receipt-photo.png')
pdf=digital('bank-narrative',2);scan=raster_pdf(pdf);(OUT/'scan-bank.pdf').write_bytes(scan)
writer=PdfWriter();writer.add_page(PdfReader(BytesIO(pdf)).pages[0]);writer.add_page(PdfReader(BytesIO(scan)).pages[1]);b=BytesIO();writer.write(b);(OUT/'mixed-bank.pdf').write_bytes(b.getvalue())
low=images(pdf)[0].resize((240,110)).filter(ImageFilter.GaussianBlur(2.2));low.save(OUT/'low-quality.png');low.save(OUT/'low-quality.jpg',quality=30)
(OUT/'corrupt.pdf').write_bytes(b'%PDF-1.7\nTRUNCATED SYNTHETIC DOCUMENT\n')
files={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(OUT.iterdir()) if p.is_file()}
assert len(files)==26,len(files)
(OUT/'manifest.json').write_text(json.dumps({'version':'synthetic-inputs-0.2','notice':'SYNTHETIC TEST DOCUMENTS ONLY - NOT CLIENT DATA','files':files},indent=2)+'\n')
print(json.dumps({'syntheticFiles':len(files),'groundTruthReadOrWritten':False}))
