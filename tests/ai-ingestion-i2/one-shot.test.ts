import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QuotaLedger } from '../../lib/server/ai-ingestion/increment-03/quota';

const now = Date.UTC(2026, 9, 29);
const sha = 'a'.repeat(64);
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'fg-i2-approval-'));
  const approvals = join(dir, 'i2-authorizations'); mkdirSync(approvals, { mode: 0o700 });
  const id = randomUUID();
  const record = { version:'v2-i2-authorization-0.1', id, sourceSha256:sha, provider:'LIVE_GROQ', model:'openai/gpt-oss-20b', expiresAt:now+60000 };
  const file = join(approvals, `${id}.json`);
  writeFileSync(file, JSON.stringify(record), { mode:0o600 });
  return {dir, approvals, id, record, file, ledger:new QuotaLedger(dir, () => now)};
}
describe('durable one-shot reservation', () => {
  it('consumes the source-bound authorization once, including after a completed reservation', () => {
    const s=setup(); const reservation=s.ledger.reserve(100,{authorizationId:s.id,sourceSha256:sha});
    s.ledger.finish(reservation,'COMPLETED',{inputTokens:25,outputTokens:25});
    expect(()=>s.ledger.reserve(100,{authorizationId:s.id,sourceSha256:sha})).toThrow('ONE_SHOT_CONSUMED');
    expect(s.ledger.summary().attempts).toBe(1);
    expect(readFileSync(join(s.approvals,`${s.id}.consumed`),'utf8')).toContain(s.id);
  });
  it.each(['RESERVED','UNKNOWN'] as const)('blocks %s prior dispatches without consuming approval', state => {
    const s=setup(); const prior=s.ledger.reserve(10); if(state==='UNKNOWN')s.ledger.finish(prior,'UNKNOWN');
    expect(()=>s.ledger.reserve(100,{authorizationId:s.id,sourceSha256:sha})).toThrow(/QUOTA_(IN_FLIGHT|UNKNOWN)/);
    expect(()=>readFileSync(join(s.approvals,`${s.id}.consumed`))).toThrow();
  });
  it('rejects wrong source, expired or missing approvals', () => {
    const s=setup(); expect(()=>s.ledger.reserve(100,{authorizationId:s.id,sourceSha256:'b'.repeat(64)})).toThrow('ONE_SHOT_INVALID');
    writeFileSync(s.file,JSON.stringify({...s.record,expiresAt:now-1}));
    expect(()=>s.ledger.reserve(100,{authorizationId:s.id,sourceSha256:sha})).toThrow('ONE_SHOT_INVALID');
    expect(()=>s.ledger.reserve(100,{authorizationId:randomUUID(),sourceSha256:sha})).toThrow('ONE_SHOT_INVALID');
    expect(s.ledger.summary().attempts).toBe(0);
  });
  it('rejects symlinked authorization files', () => {
    const s=setup(),other=randomUUID();symlinkSync(s.file,join(s.approvals,`${other}.json`));
    expect(()=>s.ledger.reserve(100,{authorizationId:other,sourceSha256:sha})).toThrow('ONE_SHOT_INVALID');
  });
});
