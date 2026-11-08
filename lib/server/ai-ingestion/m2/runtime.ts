import 'server-only';
import { resolve } from 'node:path';
import { openLocalDatabase } from '../v2-i1/local-db';
import { createM2Identity } from './identity';
import { createM2Pipeline, installM2Schema } from './pipeline';
export function m2LocalEnabled() { return process.env.NODE_ENV === 'development' && !process.env.VERCEL && process.env.FINGENCE_AI_LOCAL === '1' && process.env.FINGENCE_V2_I1_LOCAL === '1' && process.env.FINGENCE_M2_LOCAL === '1'; }
async function open() { if (!m2LocalEnabled())
    throw new Error('LOCAL_ONLY'); const database = await openLocalDatabase(resolve('.local/m2-database-v1')); try {
    await installM2Schema(database);
}
catch (error) {
    await database.close();
    throw error;
} return { database, identity: createM2Identity(database), pipeline: createM2Pipeline(database) }; }
const state = globalThis as typeof globalThis & {
    fingenceM2?: ReturnType<typeof open>;
};
export function m2Runtime() { if (!m2LocalEnabled())
    throw new Error('LOCAL_ONLY'); return state.fingenceM2 ??= open(); }
export async function closeM2Runtime() { const current = state.fingenceM2; delete state.fingenceM2; if (current)
    await (await current).database.close(); }
