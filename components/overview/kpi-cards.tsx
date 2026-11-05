'use client';
import { useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_KPIS, KPI_METRICS, moveKpi, type KpiId, type KpiSource } from './kpi-metrics';
import { KPI_ACCENTS } from './kpi-accents';
import { useKpiGlow } from './kpi-glow';
import styles from './kpi-accents.module.css';
import { saveKpiPreference, useKpiPreference } from './kpi-preference';

export function KpiCards({source}: {source: KpiSource | null}) {
 const glow=useKpiGlow();
 const selected=useKpiPreference(), [draft,setDraft]=useState<KpiId[]>([...DEFAULT_KPIS]);
 const dialog=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement>(null), title=useId(), description=useId();
 const close=()=>{dialog.current?.close();trigger.current?.focus();};
 return <div className="ov-kpi-section">
  <div className="ov-kpi-toolbar"><button ref={trigger} type="button" className="ov-button" onClick={()=>{setDraft([...selected]);dialog.current?.showModal();}}><SlidersHorizontal size={16} aria-hidden="true"/>Customize Cards</button></div>
  <section className="ov-metrics" aria-label="Financial summary">{selected.map(id=>{
   const metric=KPI_METRICS.find(m=>m.id===id)!;
   const value=source ? metric.read(source) : null;
   const Icon=metric.icon;
   return <article className={`ov-card ov-metric ${styles.card}`} key={id} data-kpi={id} style={{'--kpi-light':KPI_ACCENTS[id][0],'--kpi-dark':KPI_ACCENTS[id][1]} as CSSProperties} {...glow}><div className="ov-metric-top"><span>{!source&&'emptyLabel' in metric ? metric.emptyLabel : metric.label}</span>{source&&<span className="ov-icon"><Icon size={18} aria-hidden="true"/></span>}</div><p className="ov-value">{value ?? '—'}</p><p className="ov-muted">{!source ? 'No data available' : value===null ? `Unavailable · ${metric.detail}` : metric.detail}</p></article>;
  })}</section>
  <dialog ref={dialog} className="ov-kpi-dialog" aria-labelledby={title} aria-describedby={description} onCancel={event=>{event.preventDefault();close();}}>
   <h2 id={title}>Customize KPI Cards</h2><p id={description}>Choose four distinct metrics. Move cards left or right to change their order. Changes are saved when you apply.</p>
   <ol className="ov-kpi-choices">{draft.map((id,index)=>{
    const metric=KPI_METRICS.find(m=>m.id===id)!;
    return <li key={index}><label htmlFor={`${title}-${index}`}>Position {index+1}</label><div className="ov-kpi-choice-row"><select id={`${title}-${index}`} value={id} onChange={event=>{const next=event.target.value as KpiId;if(!draft.includes(next)&&KPI_METRICS.some(m=>m.id===next))setDraft(draft.map((item,i)=>i===index?next:item));}}>{KPI_METRICS.map(m=>{const position=draft.indexOf(m.id);return <option key={m.id} value={m.id} disabled={position!==-1&&position!==index}>{'emptyLabel' in m ? m.emptyLabel : m.label}{position!==-1&&position!==index ? ` (selected in position ${position+1})` : ''}</option>;})}</select><button type="button" className="ov-button" disabled={index===0} aria-label={`Move card ${index+1} left`} onClick={()=>setDraft(moveKpi(draft,index,-1))}><ArrowLeft size={16}/></button><button type="button" className="ov-button" disabled={index===3} aria-label={`Move card ${index+1} right`} onClick={()=>setDraft(moveKpi(draft,index,1))}><ArrowRight size={16}/></button></div><p className="ov-muted">{metric.definition}</p></li>;
   })}</ol>
   <p className="ov-muted">Metrics selected in another position are disabled to prevent duplicates. Only metric IDs and their order are saved in this browser. If storage is blocked, changes remain available until this page is reloaded.</p>
   <div className="ov-kpi-dialog-actions"><button type="button" className="ov-button" onClick={()=>setDraft([...DEFAULT_KPIS])}>Reset to Default</button><span/><button type="button" className="ov-button" onClick={close}>Cancel</button><button type="button" className="ov-button ov-primary" onClick={()=>{saveKpiPreference(draft);close();}}>Apply Changes</button></div>
  </dialog>
 </div>;
}
