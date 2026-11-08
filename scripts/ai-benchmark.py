"""Compare extraction only. Ground truth never enters inference or the verifier."""
import json,subprocess,os,hashlib,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
labels=json.loads((ROOT/'tests/fixtures/ai-ingestion/ground-truth.json').read_text())
out=ROOT/'.ai-local/benchmarks';out.mkdir(parents=True,exist_ok=True)
results=[]
for name in ['statement-digital.pdf','statement-scan.pdf','statement-mixed.pdf','statement.png','statement.jpg','unreadable.png']:
    expected=labels['imageRows'] if name.endswith(('.png','.jpg')) else labels['rows']
    for engine in ['pdfplumber','docling']:
        path=ROOT/'public/samples/ai-ingestion'/name
        env={**os.environ,'OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','TOKENIZERS_PARALLELISM':'false'}
        started=time.monotonic()
        try:
            run=subprocess.run([str(ROOT/'.venv-ai/bin/python'),str(ROOT/'scripts/ai-extract.py'),str(path),'--engine',engine,'--repeat','3'],capture_output=True,text=True,timeout=120,env=env)
            (out/f'{engine}-{name}.log').write_text(run.stderr)
            if run.returncode:raise RuntimeError(run.stderr.splitlines()[-1] if run.stderr else 'extractor failed')
            data=json.loads(run.stdout);(out/f'{engine}-{name}.json').write_text(json.dumps(data,indent=2))
            texts=[i['text'] for i in data['items']]; target=[v for r in expected for v in r]
            # Global presence is NOT positional accuracy and may reuse repeated strings.
            exact=sum(v in texts for v in target)
            joined='\n'.join(texts); presence=sum(v in joined for v in target)
            rows={}
            for i in data['items']:
                if i['row'] is not None and not i['header']:rows.setdefault((i['table'],i['row']),{})[i['column']]=i['text']
            remaining=list(rows.values()); correct_rows=0; positioned=0
            for expected_row in expected:
                # Match by exact unique transaction identifier once, then compare each named column.
                match=next((r for r in remaining if r.get(labels['headers'][0])==expected_row[0]),None)
                if match is not None:
                    remaining.remove(match)
                    fields=sum(match.get(h)==value for h,value in zip(labels['headers'],expected_row))
                    positioned+=fields; correct_rows+=fields==len(expected_row)
            result={'file':name,'engine':engine,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'exactValuePresence':exact,'expectedFields':len(target),'substringPresence':presence,'positionedExactFields':positioned,'exactTableRows':correct_rows,'expectedRows':len(expected),'regions':len(data['items']),'coverage':data['coverage'],**data['metrics']}
        except Exception as e:result={'file':name,'engine':engine,'error':type(e).__name__,'detail':str(e)[:200],'elapsedSeconds':round(time.monotonic()-started,2)}
        results.append(result);print(json.dumps(result),flush=True)
        (ROOT/'docs/research/extraction-benchmark.json').parent.mkdir(parents=True,exist_ok=True)
        (ROOT/'docs/research/extraction-benchmark.json').write_text(json.dumps({'syntheticOnly':True,'inferenceCalls':0,'method':'3 sequential extractions per process. Global presence is not positional accuracy. Positioned fields use one-to-one exact transaction-ID row matching and named columns. Latency and process peak RSS are measured. NOT LLM interpretation accuracy. Model weights already cached.','results':results},indent=2)+'\n')
