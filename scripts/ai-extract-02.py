"""0.2 local Docling evidence adapter. Reuses 0.1 primitives; never inference labels."""
import sys, json, runpy, contextlib, importlib.metadata
from pathlib import Path
from io import BytesIO
base=runpy.run_path(str(Path(__file__).with_name('ai-extract.py')))

def extract(path):
    from PIL import Image
    from pypdf import PdfReader
    from docling.document_converter import DocumentConverter, PdfFormatOption, ImageFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
    from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
    raw=Path(path).read_bytes(); pdf=raw.startswith(b'%PDF-'); warnings=[]
    if len(raw)>10*1024*1024:raise ValueError('byte limit')
    expected=len(PdfReader(BytesIO(raw)).pages) if pdf else 1
    if expected<1 or expected>4:raise ValueError('page limit')
    Image.MAX_IMAGE_PIXELS=12_000_000
    if not pdf:
        with Image.open(BytesIO(raw)) as image:
            if image.width*image.height>12_000_000:raise ValueError('pixel limit')
            if min(image.size)<200:warnings.append('Unreadable/low-resolution source.')
    options=PdfPipelineOptions();options.do_ocr=True;options.ocr_options=RapidOcrOptions()
    options.accelerator_options=AcceleratorOptions(num_threads=2,device=AcceleratorDevice.CPU)
    with contextlib.redirect_stdout(sys.stderr):
        converter=DocumentConverter(allowed_formats=[InputFormat.PDF,InputFormat.IMAGE],format_options={InputFormat.PDF:PdfFormatOption(pipeline_options=options),InputFormat.IMAGE:ImageFormatOption(pipeline_options=options)})
        result=converter.convert(path,max_num_pages=4)
    doc=result.document; complete=base['conversion_complete'](result.status,result.errors,list(doc.pages),expected)
    if not complete:warnings.append('Incomplete conversion or missing original pages.')
    items=[]; table_pages=set()
    for n,table in enumerate(doc.tables):
        if len(table.prov)!=1:complete=False;warnings.append('Ambiguous multipage table geometry.');continue
        prov=table.prov[0];page=prov.page_no;size=doc.pages[page].size;table_pages.add(page)
        for cell in table.data.table_cells:
            if cell.end_col_offset_idx-cell.start_col_offset_idx!=1 or cell.end_row_offset_idx-cell.start_row_offset_idx!=1:complete=False;warnings.append('Ambiguous merged table cell.')
            items.append(base['item'](cell.text,'docling-table-02',page=page,row=cell.start_row_offset_idx+1,column=str(cell.start_col_offset_idx),table='table:'+str(n),box=cell.bbox.to_top_left_origin(size.height).as_tuple() if cell.bbox else None,width=size.width,height=size.height,coordinateSystem='TOP_LEFT_POINTS' if pdf else 'TOP_LEFT_PIXELS'))
    for text in doc.texts:
        for p in text.prov:
            size=doc.pages[p.page_no].size;box=p.bbox.to_top_left_origin(size.height).as_tuple()
            # A table's outer rectangle does not prove a text region was emitted.
            # Deduplicate only matching literal text contained in an actual cell.
            represented=any(i['method']=='docling-table-02' and i['page']==p.page_no and i['box'] is not None and ' '.join(i['text'].split())==' '.join(text.text.split()) and i['box'][0]-1<=box[0] and i['box'][1]-1<=box[1] and i['box'][2]+1>=box[2] and i['box'][3]+1>=box[3] for i in items)
            if represented:continue
            items.append(base['item'](text.text,'docling-context-02',page=p.page_no,box=box,width=size.width,height=size.height,coordinateSystem='TOP_LEFT_POINTS' if pdf else 'TOP_LEFT_PIXELS'))
    if table_pages!=set(range(1,expected+1)):complete=False;warnings.append('Incomplete financial table coverage on source pages.')
    if len(items)>2000:raise ValueError('evidence limit')
    return {'items':items,'warnings':list(dict.fromkeys(warnings)),'coverage':'TABLE_ROWS' if complete else 'REGIONS_ONLY','extractor':'Docling '+importlib.metadata.version('docling-slim')+' / RapidOCR, context adapter 0.2'}

if __name__=='__main__':
    try:print(json.dumps(extract(sys.argv[1]),allow_nan=False))
    except Exception as exc:
        print(json.dumps({'error':type(exc).__name__,'message':'Bounded extraction failed; no records accepted.'}),file=sys.stderr);sys.exit(1)
