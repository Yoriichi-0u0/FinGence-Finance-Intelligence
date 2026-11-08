import 'server-only';
import { localAccessAllowed } from '../ai-ingestion/service';
import { m3LocalEnabled } from '../financial-m3/runtime';
/** The M5 flag is checked first, so disabled launchers never evaluate the M3/M4 gates. M4 requires M3. */
export function m5LocalEnabled() { return process.env.FINGENCE_M5_LOCAL === '1' && process.env.FINGENCE_M4_LOCAL === '1' && m3LocalEnabled(); }
export function m5RequestAllowed(request: Request) { return m5LocalEnabled() && localAccessAllowed(request); }
