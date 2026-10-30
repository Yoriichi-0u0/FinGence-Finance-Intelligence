"""Freeze new synthetic M4 inputs and independently specified source truth. Never reads model outputs."""
from pathlib import Path
from io import BytesIO
import csv,json,hashlib
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'synthetic/m4';GOLD=ROOT/'tests/fixtures/ai-ingestion-m4'
if (OUT/'manifest.json').exists() or (GOLD/'gold.json').exists():raise SystemExit('Frozen M4 corpus already exists; refusing overwrite')
OUT.mkdir(parents=True,exist_ok=True);GOLD.mkdir(parents=True,exist_ok=True)
conventions={'dateOrder':'ISO','numberFormat':'plain','dateBasis':'transaction_date','monetaryMode':'signed_amount'}
cases={}
def record(name,headers,rows,kind,roles,accepted,conv=conventions,label=None,prohibited=False):
 cases[name]={'caseId':name.split('.')[0],'sourceSha256':None,'headers':headers,'roles':roles,'rows':rows,'documentKind':kind,'conventions':conv,'accepted':accepted,'prohibitedAcceptance':prohibited,'allowedAssumptions':[],'context':[] if label is None else [{'text':label,'ruleId':'context.document-label','disposition':'SUPPORTING_METADATA'}]}
def financial(i,date,amount,currency):return {'source_transaction_id':i,'transaction_date':date,'source_amount':amount,'currency':currency,'monetary_basis':'source_signed_amount'}
h=['Ccy','Date','Amount','Txn ID'];rows=[['MYR','2026-11-01','316.25','000901'],['MYR','2026-11-02','-11.50','000902']]
with (OUT/'m401.csv').open('w',newline='')as f:csv.writer(f).writerows([['BANK STATEMENT'],h,*rows])
record('m401.csv',h,rows,'BANK_STATEMENT',['currency','transaction_date','amount','transaction_id'],[financial('000901','2026-11-01','316.25','MYR'),financial('000902','2026-11-02','-11.5','MYR')],label='BANK STATEMENT')
h=['Credit amount','Txn date','Txn no','Debit amount','Currency'];rows=[['0','2026-11-03','000911','45.60','MYR'],['9.10','2026-11-04','000912','0','MYR']];w=Workbook();s=w.active;s.title='Sheet A'
for row in [['GENERAL LEDGER'],h,*rows]:s.append(row)
w.save(OUT/'m402.xlsx');record('m402.xlsx',h,rows,'GENERAL_LEDGER',['credit','transaction_date','transaction_id','debit','currency'],[{'source_transaction_id':'000911','transaction_date':'2026-11-03','debit':'45.6','credit':'0','currency':'MYR','monetary_basis':'debit_credit'},{'source_transaction_id':'000912','transaction_date':'2026-11-04','debit':'0','credit':'9.1','currency':'MYR','monetary_basis':'debit_credit'}],conv={**conventions,'monetaryMode':'debit_credit'},label='GENERAL LEDGER')
def document(headers,rows,label):
 width=980;height=280;left=24;top=210;step=42;widths=[(width-48)/len(headers)]*len(headers);b=BytesIO();c=canvas.Canvas(b,pagesize=(width,height),invariant=1);c.setFont('Helvetica-Bold',13);c.drawString(left,250,label);c.setFont('Helvetica',11)
 for n,row in enumerate([headers,*rows]):
  c.line(left,top-n*step,width-left,top-n*step);x=left+5
  for value,colwidth in zip(row,widths):c.drawString(x,top-n*step-25,value);x+=colwidth
 c.line(left,top-(len(rows)+1)*step,width-left,top-(len(rows)+1)*step)
 for n in range(len(headers)+1):x=left+sum(widths[:n]);c.line(x,top-(len(rows)+1)*step,x,top)
 c.save();pdf=b.getvalue();d=pdfium.PdfDocument(pdf);image=d[0].render(scale=2).to_pil().convert('RGB');d.close();return pdf,image
h=['Date','Ref','Transaction Amount','Currency','Txn ID'];rows=[['2026-11-05','S-401','77.30','MYR','000921'],['2026-11-06','S-402','-2.05','USD','000922']];label='BANK STATEMENT - SYNTHETIC - NOT CLIENT DATA';pdf,image=document(h,rows,label);(OUT/'m403.pdf').write_bytes(pdf);record('m403.pdf',h,rows,'BANK_STATEMENT',['transaction_date','reference','amount','currency','transaction_id'],[financial('000921','2026-11-05','77.3','MYR'),financial('000922','2026-11-06','-2.05','USD')],label=label)
rows=[['2026-11-07','S-411','61.20','MYR','000931'],['2026-11-08','S-412','-4.75','MYR','000932']];_,image=document(h,rows,label);b=BytesIO();c=canvas.Canvas(b,pagesize=(980,280),invariant=1);c.drawImage(ImageReader(image),0,0,width=980,height=280);c.save();(OUT/'m404.pdf').write_bytes(b.getvalue());record('m404.pdf',h,rows,'BANK_STATEMENT',['transaction_date','reference','amount','currency','transaction_id'],[financial('000931','2026-11-07','61.2','MYR'),financial('000932','2026-11-08','-4.75','MYR')],label=label)
h=['Currency','Txn ID','Date','Amount','LiquidityTier'];rows=[['MYR','000941','2026-11-09','28.40','1'],['MYR','000942','2026-11-10','-3.20','2']];_,image=document(h,rows,'TRANSACTION TABLE');image.save(OUT/'m405.png');record('m405.png',h,rows,'TRANSACTION_TABLE',['currency','transaction_id','transaction_date','amount','unknown'],[],label='TRANSACTION TABLE',prohibited=True)
h=['Txn ID','Date','Money In','Money Out','Currency'];rows=[['000951','2026-11-11','90.00','0','MYR'],['000952','2026-11-12','0','7.20','MYR']];_,image=document(h,rows,'BANK STATEMENT');image.save(OUT/'m406.jpg',quality=95);record('m406.jpg',h,rows,'BANK_STATEMENT',['transaction_id','transaction_date','bank_in','bank_out','currency'],[],conv=None,label='BANK STATEMENT',prohibited=True)
files={}
for name,gold in cases.items():b=(OUT/name).read_bytes();gold['sourceSha256']=hashlib.sha256(b).hexdigest();files[name]={'sha256':gold['sourceSha256'],'bytes':len(b)}
(OUT/'manifest.json').write_text(json.dumps({'version':'m4-synthetic-inputs-v1','notice':'SYNTHETIC; opaque IDs; no labels in runtime manifest','files':files},indent=2)+'\n')
(GOLD/'gold.json').write_text(json.dumps({'version':'m4-heldout-labels-v1','method':'Source-authored truth frozen before provider/control execution; no model output used; held out from live provider, not a claim of blind developer testing.','cases':cases},indent=2)+'\n')
print('Frozen six M4 documents and separate labels. No inference executed.')
