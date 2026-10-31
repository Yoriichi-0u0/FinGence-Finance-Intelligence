import C1DataWorkspace from '@/components/ingestion/c1-data-workspace';
export const metadata = { title: 'C1 ingestion (legacy)' };
/** The original C1 ingestion page, kept reachable (not in navigation) until the replacement is fully verified. */
export default function Page() { return <C1DataWorkspace />; }
