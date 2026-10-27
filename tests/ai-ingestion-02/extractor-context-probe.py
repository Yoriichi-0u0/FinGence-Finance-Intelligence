"""Deterministic adapter-result probe; stubs are not an OCR accuracy test."""
import sys, types, runpy, importlib.metadata
from types import SimpleNamespace as N

def module(name, **attrs):
    result=types.ModuleType(name); result.__dict__.update(attrs); sys.modules[name]=result

class Box:
    def __init__(self, coordinates): self.coordinates=coordinates
    def to_top_left_origin(self, height): return self
    def as_tuple(self): return self.coordinates

class Options: pass
class Config:
    def __init__(self, **kwargs): pass
class Converter:
    def __init__(self, **kwargs): pass
    def convert(self, *args, **kwargs): return conversion

cells=[]
for row, values in enumerate([["Transaction Date","Amount","Currency"],["2026-10-19","12.50","MYR"]]):
    for col, value in enumerate(values):
        cells.append(N(text=value,start_col_offset_idx=col,end_col_offset_idx=col+1,start_row_offset_idx=row,end_row_offset_idx=row+1,bbox=Box((col*100,100+row*20,(col+1)*100,120+row*20))))
table=N(prov=[N(page_no=1,bbox=Box((0,90,400,250)))],data=N(table_cells=cells))
financial_context=N(text="Service Charge MYR 5.00",prov=[N(page_no=1,bbox=Box((10,180,200,200)))])
duplicate=N(text="12.50",prov=[N(page_no=1,bbox=Box((120,123,160,138)))])
unrepresented_duplicate=N(text="12.50",prov=[N(page_no=1,bbox=Box((10,210,60,230)))])
conversion=N(status="success",errors=[],document=N(tables=[table],texts=[financial_context,duplicate,unrepresented_duplicate],pages={1:N(size=N(width=500,height=700))}))
module("PIL",Image=N()); module("pypdf",PdfReader=lambda raw:N(pages=[None])); module("docling")
module("docling.document_converter",DocumentConverter=Converter,PdfFormatOption=Config,ImageFormatOption=Config)
module("docling.datamodel"); module("docling.datamodel.base_models",InputFormat=N(PDF="PDF",IMAGE="IMAGE"))
module("docling.datamodel.pipeline_options",PdfPipelineOptions=Options,RapidOcrOptions=Options)
module("docling.datamodel.accelerator_options",AcceleratorOptions=Config,AcceleratorDevice=N(CPU="CPU"))
importlib.metadata.version=lambda name:"stub-probe"
adapter=runpy.run_path("scripts/ai-extract-02.py")
output=adapter["extract"]("public/samples/ai-ingestion-increment-02/precision.pdf")
context=[i for i in output["items"] if i["method"]=="docling-context-02"]
assert financial_context.text in [i["text"] for i in context], "Unrepresented financial context was discarded"
assert [i["text"] for i in context].count("12.50")==1, "Only text proven inside its exact source cell may be suppressed"
assert any(i["text"]=="12.50" and i["box"]==(10,210,60,230) for i in context)
print("PASS: unrepresented context retained; only matching text and cell geometry deduplicated")
