"""Bounded local extraction; stdout is structured evidence, never AI interpretation."""
import argparse, json, sys, time, statistics, resource, platform
from pathlib import Path
from io import BytesIO
import contextlib
import importlib.metadata

def item(text, method, **kw):
    base=dict(value=text,text=text,page=None,sheet=None,row=None,column=None,address=None,box=None,width=None,height=None,coordinateSystem=None,table=None,header=False,confidence=None,method=method)
    base.update(kw); return base

def conversion_complete(status, errors, page_numbers, expected_pages):
    """Fail closed on partial conversion, errors or dropped/duplicated source pages."""
    return getattr(status,'value',status)=='success' and not errors and set(page_numbers)==set(range(1,expected_pages+1)) and len(page_numbers)==expected_pages

def ocr(im, page):
    from rapidocr import RapidOCR
    import numpy as np
    with contextlib.redirect_stdout(sys.stderr):
        engine=RapidOCR(params={'Global.log_level':'error','EngineConfig.onnxruntime.intra_op_num_threads':2,'EngineConfig.onnxruntime.inter_op_num_threads':2})
        result=engine(np.array(im.convert('RGB')))
    output=[]
    if result.txts is not None:
        for text,box,score in zip(result.txts,result.boxes,result.scores):
            xs=[float(p[0]) for p in box]; ys=[float(p[1]) for p in box]
            output.append(item(text,'rapidocr-onnx',page=page,box=[min(xs),min(ys),max(xs),max(ys)],width=im.width,height=im.height,coordinateSystem='TOP_LEFT_PIXELS',confidence=float(score)))
    return output

def extract(path, engine):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS=12_000_000
    raw=Path(path).read_bytes()
    if len(raw)>10*1024*1024: raise ValueError('File limit exceeded')
    warnings=[]; items=[]; covered=True
    expected_pages=1
    if raw.startswith(b'%PDF-'):
        from pypdf import PdfReader
        expected_pages=len(PdfReader(BytesIO(raw)).pages)
        if expected_pages<1 or expected_pages>4: raise ValueError('Page limit exceeded')
    if not raw.startswith(b'%PDF-'):
        with Image.open(BytesIO(raw)) as preflight:
            if preflight.width*preflight.height>12_000_000: raise ValueError('Pixel limit exceeded')
            if min(preflight.size)<200: warnings.append('Unreadable/low-resolution image; numeric fidelity is ambiguous.')
    if engine=='docling':
        from docling.document_converter import DocumentConverter, PdfFormatOption, ImageFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
        from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
        options=PdfPipelineOptions(); options.do_ocr=True; options.ocr_options=RapidOcrOptions()
        options.accelerator_options=AcceleratorOptions(num_threads=2,device=AcceleratorDevice.CPU)
        with contextlib.redirect_stdout(sys.stderr):
            converter=DocumentConverter(allowed_formats=[InputFormat.PDF,InputFormat.IMAGE], format_options={InputFormat.PDF:PdfFormatOption(pipeline_options=options),InputFormat.IMAGE:ImageFormatOption(pipeline_options=options)})
            result=converter.convert(path,max_num_pages=4)
        doc=result.document
        if not conversion_complete(result.status,result.errors,list(doc.pages),expected_pages):
            covered=False; warnings.append('Incomplete document conversion or source page coverage; no financial acceptance permitted.')
        table_pages={p.page_no for table in doc.tables for p in table.prov}
        if any(page_no not in table_pages for page_no in doc.pages):
            covered=False; warnings.append('Incomplete table coverage on one or more pages; review required.')
        for t,table in enumerate(doc.tables):
            page=table.prov[0].page_no if table.prov else None
            page_size=doc.pages[page].size if page in doc.pages else None
            labels={cell.start_col_offset_idx:cell.text for cell in table.data.table_cells if cell.start_row_offset_idx==0}
            for cell in table.data.table_cells:
                if cell.end_col_offset_idx-cell.start_col_offset_idx>1 or cell.end_row_offset_idx-cell.start_row_offset_idx>1:
                    covered=False; warnings.append('Ambiguous merged table cells are outside the synthetic layout policy.')
                bbox=cell.bbox.to_top_left_origin(page_size.height).as_tuple() if cell.bbox and page_size else None
                # Explicit narrow synthetic layout policy: each table has one header row.
                items.append(item(cell.text,'docling-table',page=page,row=cell.start_row_offset_idx+1,column=labels.get(cell.start_col_offset_idx),table=f'table:{t}',header=cell.start_row_offset_idx==0,box=bbox,width=page_size.width if page_size else None,height=page_size.height if page_size else None,coordinateSystem='TOP_LEFT_POINTS' if raw.startswith(b'%PDF-') else 'TOP_LEFT_PIXELS'))
        if not items:
            covered=False; warnings.append('No structured table coverage; text regions require review.')
            for text in doc.texts:
                for p in text.prov:
                    size=doc.pages[p.page_no].size
                    items.append(item(text.text,'docling-text',page=p.page_no,box=list(p.bbox.to_top_left_origin(size.height).as_tuple()),width=size.width,height=size.height,coordinateSystem='TOP_LEFT_POINTS' if raw.startswith(b'%PDF-') else 'TOP_LEFT_PIXELS'))
        return dict(items=items,warnings=warnings,coverage='TABLE_ROWS' if covered else 'REGIONS_ONLY',extractor='docling '+importlib.metadata.version('docling-slim'))
    if raw.startswith(b'%PDF-'):
        import pdfplumber, pypdfium2 as pdfium
        with pdfplumber.open(BytesIO(raw)) as pdf:
            if len(pdf.pages)>4: raise ValueError('Page limit exceeded')
            for page_no,page in enumerate(pdf.pages,1):
                tables=page.find_tables()
                if tables:
                    for t,table in enumerate(tables):
                        values=table.extract(); labels=values[0] if values else []
                        for r,row in enumerate(table.rows):
                            for col,bbox in enumerate(row.cells):
                                if bbox is None: continue
                                text=values[r][col] or ''
                                items.append(item(text,'pdfplumber-table',page=page_no,row=r+1,column=labels[col] if col<len(labels) else str(col),table=f'page:{page_no}:table:{t}',header=r==0,box=list(bbox),width=page.width,height=page.height,coordinateSystem='TOP_LEFT_POINTS'))
                elif (words:=page.extract_words()):
                    covered=False
                    for w in words: items.append(item(w['text'],'pdfplumber-text',page=page_no,box=[w['x0'],w['top'],w['x1'],w['bottom']],width=page.width,height=page.height,coordinateSystem='TOP_LEFT_POINTS'))
                else:
                    covered=False
                    document=pdfium.PdfDocument(raw); im=document[page_no-1].render(scale=2).to_pil()
                    items.extend(ocr(im,page_no)); document.close()
    else:
        covered=False
        with Image.open(BytesIO(raw)) as im:
            if im.width*im.height>12_000_000: raise ValueError('Pixel limit exceeded')
            im.load()
            if min(im.size)<200: warnings.append('Unreadable/low-resolution image; numeric fidelity is ambiguous.')
            items=ocr(im,1)
    if not covered: warnings.append('OCR/text regions are candidates only; complete table row coverage is not verified.')
    return dict(items=items,warnings=warnings,coverage='TABLE_ROWS' if covered else 'REGIONS_ONLY',extractor='pdfplumber '+importlib.metadata.version('pdfplumber')+' / RapidOCR '+importlib.metadata.version('rapidocr'))

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('path'); parser.add_argument('--engine',choices=['pdfplumber','docling'],default='pdfplumber'); parser.add_argument('--repeat',type=int,choices=[1,3],default=1); args=parser.parse_args()
    try:
        elapsed=[]
        for _ in range(args.repeat):
            started=time.perf_counter(); result=extract(args.path,args.engine); elapsed.append(round((time.perf_counter()-started)*1000,2))
        result['metrics']={'runsMs':elapsed,'coldMs':elapsed[0],'warmMedianMs':statistics.median(elapsed[1:]) if len(elapsed)>1 else None,'peakRssMiB':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1048576 if platform.system()=='Darwin' else 1024),2)}
        print(json.dumps(result,allow_nan=False))
    except Exception as exc:
        print(json.dumps({'error':type(exc).__name__,'message':'Local extraction failed. No AI inference or financial acceptance occurred.'}),file=sys.stderr);sys.exit(1)
