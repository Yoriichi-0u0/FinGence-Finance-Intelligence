import 'server-only';
import { m3LocalEnabled } from '../financial-m3/runtime';
import { m5LocalEnabled } from '../tenant-admin-m5/flags';
import { pocLocalEnabled } from '../poc-reconciliation/runtime';
/**
 * The browser-only synthetic demo is the default experience (hosted and plain local). Any local
 * authenticated mode keeps its own server-backed workspaces, so the two never mix on one page.
 */
export function syntheticDemoEnabled() { return !m3LocalEnabled() && !m5LocalEnabled() && !pocLocalEnabled(); }
