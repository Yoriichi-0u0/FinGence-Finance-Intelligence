import type { FC } from 'react';
import type { ProcessingContext } from '@/lib/demo/pipeline';

/** Retired presentation exports retained for compatibility; neither renders a notice. */
export function DemoBanner() { return null; }
export const CompactDemoNotice: FC<{ context: ProcessingContext | null }> = () => null;
