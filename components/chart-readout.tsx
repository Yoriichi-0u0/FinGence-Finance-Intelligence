import styles from './financial-chart.module.css';
import { groupDigits } from '@/lib/poc-anomalies/format';
export const financialMoney = (currency: string, value: string) => `${currency === 'MYR' ? 'RM' : currency} ${groupDigits(value)}`;
export const financialColors = ['var(--fc-teal)', 'var(--fc-blue)', 'var(--fc-net)'];
export function ChartReadout({ title, items, hint }: { title?: string; items: { label: string; value: string; color: string }[]; hint: string }) {
    return <div className={styles.readout} aria-live="polite">{title && items.length ? <div className={styles.tooltip} role="tooltip"><strong>{title}</strong>{items.map(item => <span key={item.label}><i style={{ background: item.color }} aria-hidden="true" /><span>{item.label}</span><b>{item.value}</b></span>)}</div> : <p>{hint}</p>}</div>;
}
