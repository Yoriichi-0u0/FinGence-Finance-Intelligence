import type { DemoStatus } from './context';
import { Check } from 'lucide-react';
import styles from './data-workflow.module.css';

/** Selection is readiness only; only an actual verified result makes Results available. */
export function processingWorkflow(status: DemoStatus, completed: boolean, selected: number, quarantined = false) {
    const failed = status === 'failed' || quarantined;
    return { current: status === 'processing' || failed ? 1 : status === 'ready' && completed ? 2 : 0, failed, selected };
}
export function DataWorkflow({ status, completed, selected, quarantined }: { status: DemoStatus; completed: boolean; selected: number; quarantined: boolean }) {
    const state = processingWorkflow(status, completed, selected, quarantined);
    const descriptions = [selected ? `${selected} selected · validation runs during processing` : 'Choose supported documents', state.failed ? 'Processing needs attention' : state.current === 1 ? 'Running document checks' : state.current === 2 ? 'Processing run completed' : 'Verify and process documents', state.current === 2 ? 'Verified outputs available · exceptions may need review' : 'Awaiting verified outputs'];
    return <section className={styles.workflow} aria-label="Financial Processing Workflow"><ol>{['Documents', 'Processing', 'Results'].map((label, i) => <li key={label} aria-current={state.current === i ? 'step' : undefined} data-state={state.current === i ? state.failed ? 'failed' : 'active' : state.current > i ? state.current === 1 ? 'ready' : 'complete' : 'future'}><span className={styles.circle} aria-hidden="true">{state.current > i && state.current === 2 ? <Check size={17} /> : i + 1}</span><div><h2>{label}</h2><p>{descriptions[i]}</p></div></li>)}</ol></section>;
}
