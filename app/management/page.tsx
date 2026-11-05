import { notFound } from 'next/navigation';
import { ManagementConsole } from '@/components/management/console';
import { managementEnabled } from '@/lib/server/processing/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Management' };
/** Management (Technical): server processing jobs, flagged items and the pause switch. Absent unless the server enables it. */
export default function Page() {
    if (!managementEnabled()) notFound();
    return <ManagementConsole />;
}
