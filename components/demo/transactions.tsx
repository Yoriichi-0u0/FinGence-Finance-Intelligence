'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { toCents } from '@/lib/poc-anomalies/source';
import { cashTotals } from '@/lib/poc-insights/model';
import { money, outflow, SourceStrip } from './shared';
import { defaultFilters, dateFilterError, exploreRecords, recordMatches, signedDisplay, transactionPage, transactionRecords, TRANSACTION_PAGE_SIZE, type ExplorerRecord, type SourceTab } from './transaction-explorer';
import styles from './transactions.module.css';

const signedAmountClass = (value:string) => { const cents=toCents(value); return cents>0n?styles.incoming:cents<0n?styles.outgoing:undefined; };

export default function Transactions({ c }: { c: ProcessingContext | null }) {
    const [tab, setTab] = useState<SourceTab>('bank'), [filters, setFilters] = useState(defaultFilters), [page, setPage] = useState(0);
    const [selected, setSelected] = useState<ExplorerRecord | null>(null);
    const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
    const records = c ? transactionRecords(c, tab) : [], filtered = exploreRecords(records, filters), paging = transactionPage(page, filtered.length);
    const error = dateFilterError(filters), start = paging.page * TRANSACTION_PAGE_SIZE;
    // Preserve the existing bank-only filtered summary, even while Ledger is selected.
    const totals = c ? cashTotals(c.outputs.bankRows.filter(r => recordMatches({ ...r, id: r.rowId }, filters))) : null;
    const currency = c?.scope?.currency ?? 'MYR';
    const update = (patch: Partial<typeof filters>) => { setFilters({ ...filters, ...patch }); setPage(0); };
    const open = (r: ExplorerRecord, button: HTMLElement) => { trigger.current = button; setSelected(r); dialog.current?.showModal(); };
    const changeTab = (t: SourceTab) => { setTab(t); setPage(0); };
    return <div className={styles.explorer}>
        <PageHeader title="Transactions" description="Explore verified bank and general ledger records." />
        <div className={styles.context}>{c ? <SourceStrip compact context={c} /> : <p>No verified financial evidence available.</p>}{c?.outputs.history.accepted && <p>Verified history scope: {c.outputs.history.months[0]} to {c.outputs.history.months.at(-1)} · {c.outputs.history.months.length} observed months</p>}</div>
        <div className={styles.summary} aria-label="Bank source summary">
            {[{ label: 'Bank Cash In', value: totals ? money(currency, totals.credits) : '—', detail: `${totals?.creditRows ?? '—'} credit records · incoming magnitude`, Icon: ArrowDownLeft }, { label: 'Bank Cash Out', value: totals ? outflow(currency, totals.debits) : '—', detail: `${totals?.debitRows ?? '—'} debit records · outgoing magnitude`, Icon: ArrowUpRight }, { label: 'Net Signed Movement', value: totals ? money(currency, signedDisplay(totals.net)) : '—', detail: `${totals?.rows ?? '—'} of ${c?.outputs.bankRows.length ?? 0} bank records`, Icon: ArrowLeftRight }].map(({ label, value, detail, Icon }) => <article key={label}><span><Icon size={17} aria-hidden="true" />{label}</span><strong>{value}</strong><small>{detail}</small></article>)}
        </div>
        <p className={styles.scope}>Bank source only · current search, direction and date filters. These cards stay bank-scoped in both tabs. Cash movement is not revenue, expenses or profit.</p>
        <section className={styles.panel} aria-label="Transaction explorer">
            <div className={styles.tabRow}><div role="tablist" aria-label="Transaction source">{(['bank', 'ledger'] as const).map(t => <button key={t} id={`transaction-tab-${t}`} role="tab" type="button" aria-selected={tab === t} aria-controls="transaction-records" tabIndex={tab === t ? 0 : -1} onClick={() => changeTab(t)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'bank' : e.key === 'End' ? 'ledger' : tab === 'bank' ? 'ledger' : 'bank'; changeTab(next); document.getElementById(`transaction-tab-${next}`)?.focus(); } }}>{t === 'bank' ? 'Bank Statement' : 'General Ledger'}</button>)}</div><span>{records.length} source records</span></div>
            <div className={styles.filters}>
                <label className={styles.search}>Search records<div><Search aria-hidden="true" size={16} /><input value={filters.search} onChange={e => update({ search: e.target.value })} placeholder="Reference, description or counterparty" /><button type="button" aria-label="Clear search" disabled={!filters.search} onClick={() => update({ search: '' })}><X size={16} aria-hidden="true" /></button></div></label>
                <label>Direction<select aria-label="Direction" value={filters.direction} onChange={e => update({ direction: e.target.value })}><option value="">All</option><option value="Credit">Cash In</option><option value="Debit">Cash Out</option></select></label>
                <label>From date<input type="date" aria-label="From date" value={filters.from} aria-invalid={!!error} aria-describedby={error ? 'transaction-date-error' : undefined} onChange={e => update({ from: e.target.value })} /></label>
                <label>To date<input type="date" aria-label="To date" value={filters.to} aria-invalid={!!error} aria-describedby={error ? 'transaction-date-error' : undefined} onChange={e => update({ to: e.target.value })} /></label>
                <label>Sort by<select aria-label="Sort by" value={filters.sort} onChange={e => update({ sort: e.target.value as typeof filters.sort })}><option value="newest">Newest Date</option><option value="oldest">Oldest Date</option><option value="highest">Highest Signed Amount</option><option value="lowest">Lowest Signed Amount</option></select></label>
                <button type="button" onClick={() => { setFilters(defaultFilters); setPage(0); }}>Reset Filters</button>
            </div>
            {error && <p role="alert" id="transaction-date-error" className={styles.error}>{error}</p>}
            <div role="tabpanel" id="transaction-records" aria-labelledby={`transaction-tab-${tab}`} tabIndex={0}>
                <div className={styles.tableScroll}><table><caption className="sr-only">{tab === 'bank' ? 'Bank statement records' : 'General ledger cash entries'}</caption><thead><tr>{['Date', 'Record / reference', 'Description', 'Counterparty', 'Signed Amount', 'Details'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.slice(start, start + TRANSACTION_PAGE_SIZE).map(r => <tr key={r.key} onClick={e => { const b = e.currentTarget.querySelector('button'); if (b) open(r, b); }}><td>{r.date}</td><td><strong>{r.id}</strong><small>{r.reference || 'Not supplied'}</small></td><td><span className={styles.description}>{r.description || 'Not supplied'}</span></td><td>{r.counterparty || 'Not supplied'}</td><td className={signedAmountClass(r.signedAmount)}>{money(r.currency, signedDisplay(r.signedAmount))}</td><td><button type="button" aria-label={`View details for ${r.id}`} onClick={e => { e.stopPropagation(); open(r, e.currentTarget); }}>View Details</button></td></tr>)}</tbody></table></div>
                {!filtered.length && <div className={styles.empty}><h2>{error ? 'Correct the date range' : !records.length ? `No ${tab === 'bank' ? 'BANK' : 'LEDGER'} records available` : 'No matching records'}</h2><p>{error ? 'The table will update when the date range is valid.' : records.length ? 'Adjust your search, direction or inclusive date range, or reset filters.' : 'No records are available from this source in the current processing context.'}</p>{!records.length && <Link href="/data">Inspect documents on Data</Link>}</div>}
            </div>
            <nav className={styles.pager} aria-label="Transaction pagination"><p role="status">{filtered.length ? `${start + 1}–${Math.min(start + TRANSACTION_PAGE_SIZE, filtered.length)} of ${filtered.length}` : '0 matching records'} · Page {paging.page + 1} of {paging.pages}</p><button type="button" disabled={paging.page === 0} onClick={() => setPage(paging.page - 1)}>Previous</button><button type="button" disabled={paging.page + 1 >= paging.pages} onClick={() => setPage(paging.page + 1)}>Next</button></nav>
        </section>
        <dialog ref={dialog} className={styles.dialog} aria-labelledby="transaction-detail-title" onClose={() => { setSelected(null); trigger.current?.focus(); }}>
            <header><div><span>READ ONLY · SOURCE RECORD</span><h2 id="transaction-detail-title">Transaction Details</h2></div><button type="button" autoFocus aria-label="Close transaction details" onClick={() => dialog.current?.close()}><X aria-hidden="true" size={20} /></button></header>
            {selected ? <><p className={`${styles.detailAmount} ${signedAmountClass(selected.signedAmount)??''}`}>{money(selected.currency, signedDisplay(selected.signedAmount))}</p><dl>{Object.entries({ 'Record identifier': selected.id, 'Record reference': selected.reference, 'Source role': selected.source === 'bank' ? 'BANK · Bank Statement' : 'LEDGER · General Ledger', 'Transaction date': selected.date, 'Full source description': selected.description, 'Counterparty': selected.counterparty, 'Currency': selected.currency, 'Source transaction identifier': selected.sourceTransactionId, 'Source identifier': selected.sourceId, 'Source fingerprint (SHA-256)': selected.fingerprint, 'Source row': selected.sourceRow, 'Evidence identifiers': selected.evidenceIds.join('\n'), 'Processing identifier': c?.processingId ?? null }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === null || value === '' ? 'Not supplied by the record contract' : value}</dd></div>)}</dl><p>No transaction status or confidence is inferred. Open <Link href="/reconciliation">Reconciliation</Link> to review matching evidence.</p></> : <p>Record details unavailable.</p>}
        </dialog>
    </div>;
}
