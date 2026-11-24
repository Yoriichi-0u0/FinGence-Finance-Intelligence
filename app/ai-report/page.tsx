import { DemoGate } from '@/components/demo/gate';

export const metadata = { title: 'AI report' };

/** The AI report: the same processed run as every page, written up like a quarterly or annual report. */
export default function Page() {
    return <DemoGate view="ai-report" />;
}
