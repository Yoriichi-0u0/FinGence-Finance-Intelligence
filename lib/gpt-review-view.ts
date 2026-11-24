import {z} from 'zod';
/** Opaque evidence token is used for optimistic concurrency, never displayed as financial evidence. */
export const gptReviewView=z.object({version:z.literal('website-gpt-review/1'),evidenceId:z.string().regex(/^[a-f0-9]{64}$/),accountingEffect:z.literal('NONE'),items:z.array(z.object({ordinal:z.number().int().min(0).max(99),decision:z.enum(['PENDING','APPROVE','REJECT']),canApprove:z.boolean(),canReject:z.boolean()}).strict()).max(100)}).strict();
export type GPTReviewView=z.infer<typeof gptReviewView>;
export const gptReviewResult=z.object({version:z.literal('website-gpt-review/1'),ordinal:z.number().int().min(0).max(99),decision:z.enum(['APPROVE','REJECT']),financialOutcome:z.literal('UNRESOLVED'),accountingEffect:z.literal('NONE')}).strict();
