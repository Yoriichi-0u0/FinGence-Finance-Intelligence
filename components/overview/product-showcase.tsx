'use client';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, FileSpreadsheet, FileText, ShieldCheck, ChartNoAxesCombined } from 'lucide-react';
const modules = [
 ['Data Processing','Provide and verify supported bank and ledger documents.'],
 ['Transactions','Explore transaction records from verified sources.'],
 ['Reconciliation','Compare bank and ledger entries and inspect unmatched records.'],
 ['Analytics','Understand cash movement and financial trends.'],
 ['Forecasting','Explore available cash movement projections when sufficient verified history exists.'],
 ['Reports','Review financial summaries and source evidence.'],
];
function Preview({ index }: { index: number }) {
 if(index===0) return <div className="fg-documents"><div><FileSpreadsheet size={24}/><span>Bank statement</span></div><div><FileText size={24}/><span>General ledger</span></div><small><ShieldCheck size={14}/>Source verification workflow</small></div>;
 if(index===1) return <div className="fg-mini-table"><div>Date<span>Reference</span><span>Source</span></div>{[0,1,2].map(i=><div key={i}><i/><i/><i/></div>)}</div>;
 if(index===2) return <div className="fg-mini-matches"><span>Match states · preview</span><div><i/>Matched</div><div><i/>Needs review</div><div><i/>Unmatched</div></div>;
 if(index===3 || index===4) return <svg viewBox="0 0 260 110" aria-hidden="true"><path d="M10 90H250M10 60H250M10 30H250" stroke="currentColor" opacity=".15"/>{index===4&&<rect x="160" y="10" width="90" height="80" fill="currentColor" opacity=".08"/>}<path d={index===3?'M10 78L45 60L80 72L115 37L150 52L190 25L245 35':'M10 80L45 73L80 78L115 54L160 49'} fill="none" stroke="currentColor" strokeWidth="3"/>{index===4&&<path d="M160 49L190 37L220 40L250 20" stroke="currentColor" strokeWidth="3" strokeDasharray="5 5" fill="none"/>}</svg>;
 return <div className="fg-mini-report"><FileText size={23}/><strong>Report outline</strong><i/><i/><div><ChartNoAxesCombined size={25}/><span>Source evidence</span></div></div>;
}
export function ProductShowcase() {
 const [active,setActive]=useState(2);
 const move=(direction:number)=>setActive(value=>(value+direction+modules.length)%modules.length);
 return <div className="fg-showcase" role="region" aria-label="FinGence module showcase" aria-roledescription="carousel" tabIndex={0} onKeyDown={event=>{if(event.key==='ArrowRight'){event.preventDefault();move(1);}if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}if(event.key==='Home'){event.preventDefault();setActive(0);}if(event.key==='End'){event.preventDefault();setActive(5);}}}>
 <div className="fg-showcase-window"><div className="fg-showcase-track" style={{transform:`translateX(calc(50% - (var(--showcase-card) + 24px) * ${active} - var(--showcase-card) / 2))`}}>{modules.map(([title,description],index)=><article key={title} className={`fg-product fg-showcase-card${index===active?' is-centered':''}`} aria-label={`${title}, ${index+1} of 6`}><div className={`fg-product-art fg-preview-${index}`}><Preview index={index}/></div><small className="fg-preview-label">Illustrative interface preview</small><h3>{title}</h3><p>{description}</p></article>)}</div></div>
 <div className="fg-showcase-controls"><button type="button" className="ov-button" aria-label="Previous feature" onClick={()=>move(-1)}><ArrowLeft size={18}/></button><p aria-live="polite" aria-atomic="true">{modules[active][0]} <span>· {active+1} / 6</span></p><button type="button" className="ov-button" aria-label="Next feature" onClick={()=>move(1)}><ArrowRight size={18}/></button></div>
 </div>;
}
