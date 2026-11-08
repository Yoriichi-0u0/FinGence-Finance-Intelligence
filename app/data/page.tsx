import { syntheticDemoEnabled } from '@/lib/server/demo/mode';
import DemoDataWorkspace from '@/components/demo/data-workspace';
import C1DataWorkspace from '@/components/ingestion/c1-data-workspace';
/** Synthetic demo: one-action document processing. Local authenticated modes keep the original C1 page here. */
export default function Page() { return syntheticDemoEnabled() ? <DemoDataWorkspace /> : <C1DataWorkspace />; }
