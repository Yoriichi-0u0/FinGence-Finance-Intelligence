import { redirect } from 'next/navigation';

/** Keep old bookmarks and selected source links working under the unified chatbot route. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const values = await searchParams;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (Array.isArray(value)) for (const item of value) query.append(key, item);
        else if (value !== undefined) query.set(key, value);
    }
    redirect(`/chatbot${query.size ? `?${query.toString()}` : ''}`);
}
