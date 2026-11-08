import {expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {Pool} from 'pg';

it('accepts a replacement pool connection while the destroyed connection is closing',async()=>{
 const db=await PGlite.create();
 const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:2});await socket.start();
 const endpoint=new URL(`postgres://postgres@${socket.getServerConn()}/postgres`);
 const pool=new Pool({host:endpoint.hostname,port:Number(endpoint.port),user:'postgres',database:'postgres',max:1,connectionTimeoutMillis:1500});
 try{for(let n=0;n<40;n++){const c=await pool.connect();expect((await c.query('SELECT 17::int value')).rows[0].value).toBe(17);c.release(true);}}
 finally{await pool.end();const deadline=Date.now()+1500;while(socket.getStats().activeConnections>0&&Date.now()<deadline)await new Promise(r=>setImmediate(r));expect(socket.getStats().activeConnections).toBe(0);await socket.stop();await db.close();}
},15000);
