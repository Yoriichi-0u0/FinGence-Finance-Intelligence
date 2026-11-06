// Local-only recovery laboratory. No database URL, dotenv file or existing target input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyArchive(file, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || sha256(fs.readFileSync(file)) !== expected) throw new Error('Backup checksum mismatch');
}
export function requireFresh(directory) {
  if (fs.existsSync(directory)) throw new Error('Recovery destination already exists');
}
export function minimalEnvironment(temp, bin) {
  const system = process.env.SystemRoot || 'C:\\Windows';
  return { SystemRoot: system, WINDIR: system, COMSPEC: path.join(system, 'System32', 'cmd.exe'),
    PATH: [bin, path.dirname(process.execPath), 'C:/Program Files/Git/cmd', path.join(system, 'System32')].join(path.delimiter),
    TEMP: temp, TMP: temp, PGPASSFILE: path.join(temp, 'empty-pgpass'),
    PGSERVICEFILE: path.join(temp, 'empty-service'), PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGTZ: 'UTC' };
}
const sqlString = value => "'" + value.replaceAll('\\', '/').replaceAll("'", "''") + "'";

export class RecoveryLab {
  constructor(bin = process.env.DB03_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin') {
    this.bin = path.resolve(bin);
    for (const name of ['initdb','pg_ctl','pg_dump','pg_restore','pg_basebackup','pg_verifybackup']) {
      if (!fs.existsSync(path.join(this.bin, name + '.exe'))) throw new Error(`Required PostgreSQL tool missing: ${name}`);
    }
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'fingence-db03-'));
    this.token = randomUUID();
    fs.writeFileSync(path.join(this.root, 'db03-owner.json'), JSON.stringify({ token: this.token }));
    fs.writeFileSync(path.join(this.root, 'empty-pgpass'), '');
    fs.writeFileSync(path.join(this.root, 'empty-service'), '');
    this.env = minimalEnvironment(this.root, this.bin);
    this.clusters = [];
    this.targets = new WeakSet();
    this.commands = [];
    this.archive = this.child('wal-archive'); fs.mkdirSync(this.archive);
  }
  child(name) {
    if (!/^[a-z0-9.-]+$/.test(name)) throw new Error('Invalid laboratory resource name');
    return path.join(this.root, name);
  }
  assertOwned(file) {
    const marker = JSON.parse(fs.readFileSync(path.join(this.root, 'db03-owner.json'), 'utf8'));
    if (marker.token !== this.token) throw new Error('Laboratory ownership marker mismatch');
    const rel = path.relative(this.root, path.resolve(file));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Resource outside laboratory');
  }
  command(tool, args, { failureExpected = false, detachedHandles = false } = {}) {
    const start = performance.now();
    const result = spawnSync(path.join(this.bin, tool + '.exe'), args, {
      env: this.env, cwd: this.root, shell: false, windowsHide: true,
      encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024,
      stdio: detachedHandles ? 'ignore' : 'pipe',
    });
    const entry = { tool, args: args.map(a => String(a).replaceAll(this.root, '$LAB')),
      durationMs: performance.now() - start, exitCode: result.status, signal: result.signal,
      failureExpected, stdout: result.stdout || '', stderr: (result.stderr || '').replaceAll(this.root, '$LAB') };
    this.commands.push(entry);
    if (result.error || result.signal || result.status === null) throw new Error(`${tool} could not complete; diagnostics: ${this.root}`);
    if ((result.error || result.status !== 0) && !failureExpected) throw new Error(`${tool} failed (${result.status}); diagnostics: ${this.root}`);
    return entry;
  }
  async port() {
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
  }
  async createCluster(name) {
    const data = this.child(name); requireFresh(data);
    this.command('initdb', ['-D',data,'-U','db03_owner','-A','trust','--no-locale','--encoding=UTF8','--wal-segsize=1']);
    const cluster = { name, data, port: await this.port(), started: false, pools: [] };
    this.clusters.push(cluster);
    fs.appendFileSync(path.join(data, 'postgresql.conf'), '\n' + [
      "listen_addresses='127.0.0.1'", `port=${cluster.port}`, "timezone='UTC'", "shared_buffers='16MB'",
      'max_connections=12', 'max_wal_senders=4', "wal_level='replica'", 'fsync=on', 'synchronous_commit=on',
      ...(name === 'source' ? ["archive_mode='on'", "archive_library='basic_archive'", `basic_archive.archive_directory=${sqlString(this.archive)}`] : ["archive_mode='off'"]),
    ].join('\n') + '\n');
    await this.start(cluster);
    return cluster;
  }
  async start(cluster) {
    if (!this.clusters.includes(cluster)) throw new Error('Unowned cluster');
    this.assertOwned(cluster.data);
    // Mark before pg_ctl, so partial startup is still stopped during cleanup.
    cluster.started = true;
    this.command('pg_ctl', ['-D',cluster.data,'-l',this.child(cluster.name + '.log'),'-o',`-h 127.0.0.1 -p ${cluster.port}`,'-w','-t','45','start'], { detachedHandles: true });
  }
  async pool(cluster, database = 'postgres') {
    if (!this.clusters.includes(cluster) || !cluster.started) throw new Error('Unowned or stopped cluster');
    const pool = new Pool({ host:'127.0.0.1', port:cluster.port, user:'db03_owner', database, ssl:false,
      max:4, connectionTimeoutMillis:5000, statement_timeout:10000,
      options:"-c timezone=UTC -c datestyle=ISO,MDY" });
    pool.on('error', () => {}); cluster.pools.push(pool);
    const actual = (await pool.query('SHOW data_directory')).rows[0].data_directory;
    if (path.resolve(actual).toLowerCase() !== path.resolve(cluster.data).toLowerCase()) throw new Error('Connected to unexpected cluster');
    return pool;
  }
  async freshDatabase(cluster, name) {
    if (!/^db03_[a-z0-9_]+$/.test(name)) throw new Error('Invalid disposable database name');
    const admin = await this.pool(cluster);
    await admin.query(`CREATE DATABASE ${name}`); // No IF NOT EXISTS, DROP or overwrite.
    const target = { cluster, name, pool: await this.pool(cluster,name), claimed:false };
    this.targets.add(target); return target;
  }
  async logicalDump(cluster, file) {
    if (!this.clusters.includes(cluster) || !cluster.started) throw new Error('Unowned source cluster');
    this.assertOwned(file); requireFresh(file);
    const result = this.command('pg_dump', ['--host=127.0.0.1',`--port=${cluster.port}`,'--username=db03_owner','--dbname=postgres',
      '--no-password','--format=custom',`--file=${file}`]);
    return { ...result, bytes:fs.statSync(file).size, sha256:sha256(fs.readFileSync(file)) };
  }
  async logicalRestore(target, archive, checksum, extra = []) {
    if (!this.targets.has(target) || target.claimed) throw new Error('Restore requires an unused laboratory-created target');
    this.assertOwned(archive); verifyArchive(archive, checksum);
    const tables = (await target.pool.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')")).rows[0].n;
    if (tables !== 0) throw new Error('Restore target is not empty');
    target.claimed = true;
    return this.command('pg_restore', ['--host=127.0.0.1',`--port=${target.cluster.port}`,'--username=db03_owner',`--dbname=${target.name}`,
      '--no-password','--exit-on-error','--single-transaction',...extra,archive], { failureExpected:extra.length>0 });
  }
  baseBackup(source, name) {
    if (!this.clusters.includes(source) || !source.started) throw new Error('Unowned source cluster');
    const dest = this.child(name); requireFresh(dest);
    const result = this.command('pg_basebackup', ['--host=127.0.0.1',`--port=${source.port}`,'--username=db03_owner','--no-password',
      `--pgdata=${dest}`,'--format=plain','--wal-method=stream','--checkpoint=fast','--manifest-checksums=SHA256']);
    return { dest, result };
  }
  verifyBase(directory, failureExpected = false) {
    this.assertOwned(directory);
    return this.command('pg_verifybackup', [directory], { failureExpected });
  }
  copyFresh(source, name) {
    this.assertOwned(source);
    const destination = this.child(name); requireFresh(destination);
    fs.cpSync(source,destination,{ recursive:true, errorOnExist:true, force:false, dereference:false });
    return destination;
  }
  async recover(base, name, restorePoint) {
    const start = performance.now(), data = this.copyFresh(base,name);
    const cluster = { name, data, port:await this.port(), started:false, pools:[] }; this.clusters.push(cluster);
    const archivePath = this.archive.replaceAll('\\','/');
    if (/["%&|<>^!\r\n]/.test(archivePath)) throw new Error('Archive path is unsafe for PostgreSQL restore_command');
    // PostgreSQL requires a shell restore_command. Only fixed copy syntax, its own
    // %f/%p placeholders and a validated, generated laboratory path are used.
    const restoreCommand = `copy /B /Y "${this.archive}\\%f" "%p"`;
    const encodedCommand = "'" + restoreCommand.replaceAll('\\','\\\\').replaceAll("'","''") + "'";
    fs.appendFileSync(path.join(data,'postgresql.auto.conf'), '\n' + [
      `port=${cluster.port}`, "listen_addresses='127.0.0.1'", "archive_mode='off'", "archive_library=''", "primary_conninfo=''",
      `restore_command=${encodedCommand}`,
      "recovery_target_action='promote'", "recovery_target_timeline='current'",
      restorePoint ? `recovery_target_name=${sqlString(restorePoint)}` : "recovery_target='immediate'",
    ].join('\n') + '\n');
    fs.writeFileSync(path.join(data,'recovery.signal'),'');
    await this.start(cluster);
    // pg_ctl can report readiness during hot-standby replay. Recovery is not
    // operationally complete until promotion has actually finished.
    const probe=await this.pool(cluster);const deadline=Date.now()+5000;
    while((await probe.query('SELECT pg_is_in_recovery() recovering')).rows[0].recovering) {
      if(Date.now()>=deadline)throw new Error(`Recovery target did not finish promotion; diagnostics: ${this.root}`);
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    return { cluster, durationMs:performance.now()-start };
  }
  treeSize(directory) {
    this.assertOwned(directory);
    let bytes=0,files=0;
    const visit = dir => { for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
      if(item.isSymbolicLink()) throw new Error('Unexpected external storage link');
      const file=path.join(dir,item.name); if(item.isDirectory())visit(file);else{files++;bytes+=fs.statSync(file).size;}
    } }; visit(directory); return { bytes, files };
  }
  async cleanup(success) {
    const failures=[];
    for(const cluster of [...this.clusters].reverse()) {
      for(const pool of cluster.pools) { try { await pool.end(); } catch { failures.push(`pool:${cluster.name}`); } }
      if(cluster.started && fs.existsSync(path.join(cluster.data,'postmaster.pid'))) {
        try { this.command('pg_ctl',['-D',cluster.data,'-m','fast','-w','-t','20','stop'],{detachedHandles:true}); }
        catch { failures.push(`stop:${cluster.name}`); }
      }
    }
    if(success && failures.length===0) {
      this.assertOwned(this.archive);
      const child=path.relative(os.tmpdir(),this.root);
      if(!child.startsWith('fingence-db03-') || child.includes('..') || path.isAbsolute(child) || /[\\/]/.test(child)) throw new Error('Unsafe cleanup target');
      fs.rmSync(this.root,{recursive:true});
      return { removed:true, failures:[] };
    }
    return { removed:false, diagnostics:this.root, failures };
  }
}
