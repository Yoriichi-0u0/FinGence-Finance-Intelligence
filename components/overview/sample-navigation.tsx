'use client';
import { DemoModule } from '@/components/demo/modules';
export function SampleOverview({ context }: { context: Parameters<typeof DemoModule>[0]['context'] }) { return <DemoModule view="overview" context={context} />; }
