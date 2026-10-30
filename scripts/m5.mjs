// Local M5 launcher and OS-owner organization tool. Never runs on Vercel/Production; no hosted database.
// Stop `pnpm m5:dev` before organization commands: only one process may open the local PGlite directory.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
if (process.env.VERCEL || process.env.NODE_ENV === 'production' || !process.versions.node.startsWith('24.'))
    throw Error('LOCAL_NODE_24_REQUIRED');
Object.assign(process.env, { NODE_ENV: 'development', FINGENCE_AI_LOCAL: '1', FINGENCE_V2_I1_LOCAL: '1', FINGENCE_M2_LOCAL: '1', FINGENCE_M3_LOCAL: '1', FINGENCE_M4_LOCAL: '1', FINGENCE_M5_LOCAL: '1' });
if (existsSync('.venv-ai/bin/python'))
    process.env.FINGENCE_AI_PYTHON ??= '.venv-ai/bin/python';
const port = '3185', command = process.argv[2];
/** The one-time link goes to an owner-only file, never to stdout, shell history or logs. */
function saveEnrollmentLink(invitationId, code) {
    const folder = resolve('.local/m5-enrollment');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stat = lstatSync(folder);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
        throw Error('ENROLLMENT_FOLDER_UNSAFE');
    const file = join(folder, `${invitationId}.url`);
    writeFileSync(file, `http://127.0.0.1:${port}/enroll#code=${code}\n`, { mode: 0o600, flag: 'wx' });
    return file;
}
if (command === 'serve') {
    // The browser never receives provider dispatch authority, even if such variables exist in this shell.
    const require = createRequire(import.meta.url), env = { ...process.env, FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED: '', FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED: '', FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED: '' };
    const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', port], { env, stdio: 'inherit' });
    for (const s of ['SIGINT', 'SIGTERM'])
        process.on(s, () => child.kill(s));
    child.on('exit', c => { process.exitCode = c ?? 1; });
}
else if (command === 'organization' && ['create', 'recover-admin', 'activate', 'deactivate'].includes(process.argv[3])) {
    await import('./ai-runtime-03.mjs');
    const { m5Runtime } = await import('../lib/server/tenant-admin-m5/runtime.ts');
    const { closeM2Runtime } = await import('../lib/server/ai-ingestion/m2/runtime.ts');
    const { bootstrapOrganization, issueRecoveryAdmin, setOrganizationActive } = await import('../lib/server/tenant-admin-m5/service.ts');
    const action = process.argv[3], env = process.env;
    try {
        const { database } = await m5Runtime();
        if (action === 'create' || action === 'recover-admin') {
            const issued = action === 'create'
                ? await bootstrapOrganization(database, { name: env.M5_ORGANIZATION_NAME ?? '', adminEmail: env.M5_ADMIN_EMAIL ?? '' })
                : await issueRecoveryAdmin(database, { organizationId: env.M5_ORGANIZATION_ID ?? '', adminEmail: env.M5_ADMIN_EMAIL ?? '', confirmation: env.M5_RECOVERY_CONFIRM ?? '' });
            const file = saveEnrollmentLink(issued.invitationId, issued.code);
            console.log(JSON.stringify({ organizationId: issued.organizationId, invitationId: issued.invitationId, expiresAt: issued.expiresAt, enrollmentLinkFile: file, note: 'Single-use Admin enrollment link (0600). Open it in the browser, then delete the file.' }, null, 2));
        }
        else {
            await setOrganizationActive(database, env.M5_ORGANIZATION_ID ?? '', action === 'activate');
            console.log(JSON.stringify({ organizationId: env.M5_ORGANIZATION_ID, active: action === 'activate', note: action === 'activate' ? 'No membership or session was reinstated.' : 'All memberships, sessions and pending enrollment codes were revoked.' }, null, 2));
        }
    }
    catch (error) {
        // Only fixed codes are printed: no SQL detail, address or secret.
        console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'M5_ORGANIZATION_COMMAND_FAILED');
        process.exitCode = 1;
    }
    finally {
        await closeM2Runtime();
    }
}
else {
    console.error('Usage: pnpm m5:dev | pnpm m5:organization create|recover-admin|activate|deactivate');
    process.exitCode = 1;
}
