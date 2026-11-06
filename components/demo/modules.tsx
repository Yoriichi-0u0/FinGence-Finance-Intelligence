'use client';
import Transactions from './transactions';
import Reconciliation from './reconciliation';
import Analytics from './analytics';
import { OverviewDashboard, workspaceDescription } from '@/components/overview/dashboard';
import {cashTotals} from '@/lib/poc-insights/model';
import type {ProcessingContext} from '@/lib/demo/pipeline';
import {SourceStrip} from './shared';
import Anomalies from './anomalies';
import Forecasting from './forecasting';
import Reports from './reports';
import Ask from './finance-questions';
export type DemoView = 'overview' | 'transactions' | 'reconciliation' | 'analytics' | 'anomalies' | 'forecasting' | 'reports' | 'ask';
type Ready = ProcessingContext & { scope: NonNullable<ProcessingContext['scope']>; outputs: ProcessingContext['outputs'] & { reconciliation: NonNullable<ProcessingContext['outputs']['reconciliation']>; totals: NonNullable<ProcessingContext['outputs']['totals']>; forecast: NonNullable<ProcessingContext['outputs']['forecast']>; report: NonNullable<ProcessingContext['outputs']['report']> } };
export const isReady = (c: ProcessingContext | null): c is Ready => !!c?.scope && (c.status === 'COMPLETED' || c.status === 'COMPLETED_WITH_EXCEPTIONS') && !!c.outputs.reconciliation && !!c.outputs.totals && !!c.outputs.forecast && !!c.outputs.report;

function Overview({ c, navigation }: { c: Ready; navigation?: React.ReactNode }) {
    const o = c.outputs;
    const rows=o.history.accepted?o.history.rows:o.bankRows, observed=o.history.accepted?o.history.months:c.scope.months;
    const months=observed.map(period=>({period,...cashTotals(rows.filter(r=>r.period===period))}));
    return <OverviewDashboard currency={c.scope.currency} description={workspaceDescription(c.scope.businessName, c.scope.period)} navigation={navigation} processing={<SourceStrip compact context={c} />} bank={o.totals.net} bankTotals={o.totals} reconciliation={o.reconciliation} months={months} anomalies={o.anomalies.length} resolution={o.resolution} anomaliesFlagged={o.anomalyResolution?.flagged} />;
}

export function DemoModule({ view, context, overviewNavigation }: { view: DemoView; context: Ready | null; overviewNavigation?: React.ReactNode }) {
    switch (view) {
        case 'overview': return context ? <Overview c={context} navigation={overviewNavigation} /> : null;
        case 'transactions': return <Transactions key={context?.processingId ?? 'empty'} c={context} />;
        case 'reconciliation': return <Reconciliation key={context?.processingId ?? 'empty'} c={context} />;
        case 'analytics': return <Analytics key={context?.processingId ?? 'empty'} c={context} />;
        case 'anomalies': return <Anomalies key={context?.processingId ?? 'empty'} c={context} />;
        case 'forecasting': return <Forecasting key={context?.processingId ?? 'empty'} c={context} />;
        case 'reports': return <Reports key={context?.processingId ?? 'empty'} c={context} />;
        case 'ask': return <Ask key={context?.processingId ?? 'empty'} c={context} />;
    }
}
