'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { KPI_STORAGE_KEY, readKpiPreference, validKpis, type KpiId } from './kpi-metrics';

let sessionValue: string | undefined;
const eventName = 'fingence-kpi-layout';
export function kpiPreferenceSnapshot() {
 if(sessionValue!==undefined)return sessionValue;
 try { return localStorage.getItem(KPI_STORAGE_KEY); } catch { return null; }
}
function subscribe(update: () => void) {
 const stored=(event: StorageEvent)=>{if(event.key===KPI_STORAGE_KEY||event.key===null){sessionValue=undefined;update();}};
 window.addEventListener('storage',stored);window.addEventListener(eventName,update);
 return ()=>{window.removeEventListener('storage',stored);window.removeEventListener(eventName,update);};
}
export function saveKpiPreference(ids: readonly KpiId[]) {
 if(!validKpis(ids))return;
 sessionValue=JSON.stringify(ids);
 try {localStorage.setItem(KPI_STORAGE_KEY,sessionValue);} catch { /* Layout remains usable in this tab. */ }
 window.dispatchEvent(new Event(eventName));
}
export function useKpiPreference() {
 const raw=useSyncExternalStore(subscribe,kpiPreferenceSnapshot,()=>null);
 return useMemo(()=>readKpiPreference(raw),[raw]);
}
