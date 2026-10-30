"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Database,
  FileText,
  Filter,
  Landmark,
  Search,
} from "lucide-react";
import { Drawer } from "@/components/overlay";
import { EmptyState, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { formatSignedCurrency } from "@/lib/formatters";
import { transactions } from "@/lib/mock-data";
import type { Transaction, TransactionSource, TransactionStatus } from "@/lib/types";

const categories = ["All categories", ...Array.from(new Set(transactions.map((item) => item.category)))];
const statuses: Array<"All statuses" | TransactionStatus> = [
  "All statuses",
  "Matched",
  "Suggested",
  "Unmatched",
  "Anomaly",
  "Review",
];
const sources: Array<"All sources" | TransactionSource> = ["All sources", "Bank", "Ledger"];

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState("All categories");
  const [status, setStatus] = useState<(typeof statuses)[number]>("All statuses");
  const [source, setSource] = useState<(typeof sources)[number]>("All sources");
  const [selected, setSelected] = useState<Transaction | null>(null);

  const filteredTransactions = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return transactions.filter((transaction) => {
      const matchesQuery =
        !query ||
        [transaction.description, transaction.reference, transaction.category, transaction.account, transaction.id]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return (
        matchesQuery &&
        (category === "All categories" || transaction.category === category) &&
        (status === "All statuses" || transaction.status === status) &&
        (source === "All sources" || transaction.source === source)
      );
    });
  }, [category, deferredSearch, source, status]);

  function clearFilters() {
    setSearch("");
    setCategory("All categories");
    setStatus("All statuses");
    setSource("All sources");
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Search, review and trace normalized ledger and bank activity."
        actions={<span className="text-sm font-medium text-[var(--muted)]">1,986 normalized records</span>}
      />

      <Panel>
        <div className="border-b border-[var(--border)] p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_repeat(3,minmax(150px,0.35fr))]">
            <label className="relative block">
              <span className="sr-only">Search transactions</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search description, reference or ID"
                className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-white pl-10 pr-3 text-sm placeholder:text-slate-400 hover:border-[var(--border-strong)]"
              />
            </label>
            <label>
              <span className="sr-only">Category filter</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm">
                {categories.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Status filter</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as (typeof statuses)[number])} className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm">
                {statuses.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Source filter</span>
              <select value={source} onChange={(event) => setSource(event.target.value as (typeof sources)[number])} className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm">
                {sources.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5"><Filter aria-hidden="true" size={14} /> Showing {filteredTransactions.length} prototype records</span>
            <button type="button" onClick={clearFilters} className="font-semibold text-[var(--teal)] hover:text-[var(--teal-dark)]">Clear filters</button>
          </div>
        </div>

        {filteredTransactions.length ? (
          <div className="thin-scrollbar overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead className="bg-[var(--surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr>
                  {[
                    "Date",
                    "Description",
                    "Reference",
                    "Category",
                    "Account",
                    "Amount",
                    "Source",
                    "Status",
                  ].map((heading) => (
                    <th key={heading} scope="col" className={`px-4 py-3 font-semibold ${heading === "Amount" ? "text-right" : ""}`}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredTransactions.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-3.5 text-[var(--muted-strong)]">{transaction.date}</td>
                    <td className="px-4 py-3.5">
                      <button type="button" onClick={() => setSelected(transaction)} className="text-left font-semibold text-[var(--ink)] hover:text-[var(--teal)] hover:underline">
                        {transaction.description}
                        <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">{transaction.id}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] text-[var(--muted-strong)]">{transaction.reference}</td>
                    <td className="px-4 py-3.5">{transaction.category}</td>
                    <td className="px-4 py-3.5 text-[var(--muted-strong)]">{transaction.account}</td>
                    <td className={`whitespace-nowrap px-4 py-3.5 text-right font-semibold ${transaction.amount >= 0 ? "text-[var(--green)]" : "text-[var(--ink)]"}`}>
                      {formatSignedCurrency(transaction.amount)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-[var(--muted-strong)]">
                        {transaction.source === "Bank" ? <Landmark aria-hidden="true" size={14} /> : <FileText aria-hidden="true" size={14} />}
                        {transaction.source}
                      </span>
                    </td>
                    <td className="px-4 py-3.5"><StatusBadge status={transaction.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No transactions match these filters" description="Clear one or more filters, or try a broader reference or vendor search." />
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
          <span>Prototype page 1 of 166</span>
          <span>12 records per page</span>
        </div>
      </Panel>

      {selected ? (
        <Drawer title="Transaction details" description={`${selected.id} · ${selected.date}`} onClose={() => setSelected(null)}>
          <div className="p-5 sm:p-6">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{selected.description}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{selected.reference} · {selected.category}</p>
                </div>
                <StatusBadge status={selected.status} />
              </div>
              <p className={`mt-5 text-3xl font-semibold tracking-[-0.04em] ${selected.amount >= 0 ? "text-[var(--green)]" : "text-[var(--ink)]"}`}>
                {formatSignedCurrency(selected.amount)}
              </p>
            </div>

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Transaction information</h3>
              <dl className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
                {[
                  ["Account", selected.account],
                  ["Source", selected.source],
                  ["Date", selected.date],
                  ["Category", selected.category],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-6 py-3">
                    <dt className="text-[var(--muted)]">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Matching information</h3>
              <div className="mt-3 rounded-lg border border-[var(--border)] p-4 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {selected.status === "Matched" ? <Database aria-hidden="true" size={17} className="text-[var(--green)]" /> : <AlertTriangle aria-hidden="true" size={17} className="text-[var(--amber)]" />}
                  {selected.note}
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">Prototype explanation generated from local mock matching factors.</p>
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Source information</h3>
              <div className="mt-3 flex items-center gap-3 rounded-lg bg-[var(--teal-soft)] p-4 text-sm text-[var(--teal-dark)]">
                {selected.amount >= 0 ? <ArrowDownLeft aria-hidden="true" size={19} /> : <ArrowUpRight aria-hidden="true" size={19} />}
                Imported from {selected.source === "Bank" ? "bank-statement-aug-2026.csv" : "general-ledger-aug-2026.xlsx"}
              </div>
            </section>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
