'use client';
import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggle } from './theme';
import { ProductShowcase } from './product-showcase';
import { DemoVideo } from './demo-video';
import { ArrowRight, Play } from 'lucide-react';

export function OverviewWelcome() {
    return <div className="fg-landing-root" id="welcome-top">
        <header className="fg-topbar"><Link href="/" className="fg-brand" aria-label="FinGence home"><Image src="/branding/FinGence_Logo_96.png" width={32} height={32} alt="" unoptimized /><span>FinGence 2.0</span></Link><div className="fg-top-controls"><ThemeToggle /><Link href="/sign-in" className="fg-demo-profile">Sign In</Link></div></header>
            <div className="fg-landing">
                <section className="fg-hero" aria-labelledby="welcome-title">
                    <div className="fg-horizon" aria-hidden="true" />
                    <div className="fg-hero-content">
                    <span className="fg-badge">Financial Reconciliation Platform</span>
                    <h2 id="welcome-title"><>Understand Your Finances.<br /><span>Reconcile with Confidence.</span></></h2>
                    <p className="fg-description">FinGence 2.0 helps you compare bank and ledger transactions, review unmatched records, explore cash movement and generate financial reports in one workspace.</p>
                    <div className="ov-onboarding-actions"><Link href="/sign-up" className="ov-button ov-primary">Sign Up<ArrowRight size={16} aria-hidden="true" /></Link><a className="ov-button" href="#demo-video"><span className="fg-play"><Play size={14} aria-hidden="true" /></span>See How It Works</a></div>
                    <p className="ov-onboarding-note">Public demonstration · no sign-in or account creation required. Enter your workspace, then choose documents on Data.</p>
                    </div>
                </section>
                <section className="fg-section" aria-labelledby="explore-title"><p className="fg-kicker">ONE CONNECTED WORKSPACE</p><h2 id="explore-title">Explore FinGence</h2><p>Discover the tools that help you understand and review your financial information.</p><ProductShowcase /></section>
                <section className="fg-section fg-video-section" id="demo-video" tabIndex={-1} aria-labelledby="demo-title"><p className="fg-kicker">THE PRODUCT IN ACTION</p><h2 id="demo-title">See How FinGence Works</h2><p>Watch how FinGence processes financial documents, performs reconciliation and presents financial insights.</p><DemoVideo /></section>
                <section className="fg-section" aria-labelledby="steps-title"><p className="fg-kicker">FROM DOCUMENTS TO CLARITY</p><h2 id="steps-title">How FinGence Works</h2><div className="fg-steps">{[
                    ['Choose Your Documents', 'Start with fictional sample documents or supported test bank and ledger files.'],
                    ['Verify and Reconcile', 'FinGence checks source evidence, validates records and compares bank and ledger transactions.'],
                    ['Explore Financial Insights', 'View reconciliation results, review exceptions, analyse cash movement and access available reports.'],
                ].map(([title, text], i) => <article key={title}><span>0{i + 1}</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
                <section className="fg-final"><div><h2>Your next step toward financial clarity.</h2><p>Explore fictional samples or choose supported test documents.</p></div><a href="#welcome-top" className="ov-button ov-primary" onClick={event=>{event.preventDefault();window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}}>Try Now<ArrowRight size={16} aria-hidden="true" /></a></section>
            </div>
    </div>;
}
