import { describe, expect, it } from 'vitest';
import { atLeast, canManage, grantable, viewable } from '../../components/workspace/context';

/** "Switch view" and the role ladder in the browser: a preview only ever goes down, never up. */
describe('switch view', () => {
    it('offers your own role and those below it, never a higher one', () => {
        expect(viewable('SUPERADMIN')).toEqual(['SUPERADMIN', 'ADMIN', 'FINANCE']);
        expect(viewable('ADMIN')).toEqual(['ADMIN', 'FINANCE']);
        expect(viewable('FINANCE')).toEqual(['FINANCE']);
    });
    it('a previewed role decides the navigation and what the Team page offers', () => {
        expect([atLeast('FINANCE', 'ADMIN'), atLeast('ADMIN', 'ADMIN'), atLeast(undefined, 'ADMIN')]).toEqual([false, true, false]);
        expect(grantable('ADMIN')).toEqual(['FINANCE']);
        expect(grantable('SUPERADMIN')).toEqual(['FINANCE', 'ADMIN']);
        expect([canManage('ADMIN', 'FINANCE'), canManage('ADMIN', 'ADMIN'), canManage('SUPERADMIN', 'SUPERADMIN')]).toEqual([true, false, false]);
    });
});
