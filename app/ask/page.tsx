import { redirect } from 'next/navigation';

/** Keep old bookmarks working while directing everyone to the unified chatbot. */
export default function Page() { redirect('/chatbot'); }
