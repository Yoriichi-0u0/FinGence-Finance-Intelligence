 'use client';
import Link from 'next/link';
import {UserRound} from 'lucide-react';
import styles from './demo-profile.module.css';
/** Guest navigation only: no authenticated identity or session claim. */
export function DemoProfile(){return <details className={styles.menu} onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary className="fg-demo-profile" aria-label="Demo guest menu"><UserRound size={18} aria-hidden="true"/><span>Demo</span></summary><nav aria-label="Demo guest navigation"><small>Public demo · no account</small><Link href="/sign-in">Sign In</Link><Link href="/">Back to Welcome</Link></nav></details>;}
