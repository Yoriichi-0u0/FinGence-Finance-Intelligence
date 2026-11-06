"use client";
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, ArrowUpRight } from 'lucide-react';
import { useNavigationItems } from './context';
import { moveNavigationIndex, searchNavigation } from './routes';
export function NavigationSearch() {
    const items = useNavigationItems(), pathname = usePathname();
    const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
    const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), optionRefs = useRef<(HTMLAnchorElement | null)[]>([]);
    const listId = useId();
    const matches = searchNavigation(items, query);
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.key.toLowerCase() === 'k') {
                event.preventDefault(); input.current?.focus(); setOpen(true); setActive(-1);
            }
        };
        const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setActive(-1); } };
        document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside);
        return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
    }, []);
    function close() { setOpen(false); setActive(-1); setQuery(''); }
    return <div className="nav-search" ref={root} key={pathname} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); } }}>
        <Search size={16} aria-hidden="true" />
        <input ref={input} role="combobox" aria-label="Search navigation" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && active >= 0 && active < matches.length ? `${listId}-${active}` : undefined} placeholder="Search modules…" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); }} onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); setOpen(true);
                const next = moveNavigationIndex(active, event.key, matches.length); setActive(next);
                optionRefs.current[next]?.scrollIntoView({ block: 'nearest' });
            } else if (event.key === 'Enter' && open && matches.length) { event.preventDefault(); optionRefs.current[active < 0 ? 0 : active]?.click(); }
        }} />
        <kbd aria-hidden="true">Ctrl K</kbd>
        {open && <div className="nav-search-dropdown"><p className="nav-search-caption">GO TO MODULE</p><div role="listbox" id={listId} aria-label="Navigation suggestions">{matches.length ? matches.map((item, index) => <Link href={item.href} tabIndex={-1} key={item.href} id={`${listId}-${index}`} ref={element => { optionRefs.current[index] = element; }} role="option" aria-selected={index === active} className="nav-search-option" onPointerDown={event => event.preventDefault()} onClick={close} onPointerMove={() => setActive(index)}><item.icon size={18} aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowUpRight size={14} aria-hidden="true" /></Link>) : <p role="status" className="nav-search-empty">No modules found. Try “upload”, “matching” or “report”.</p>}</div><p className="nav-search-footer">↑ ↓ to choose · Enter to open · Esc to close</p></div>}
    </div>;
}
