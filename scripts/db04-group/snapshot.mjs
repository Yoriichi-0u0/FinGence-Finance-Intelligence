// Synthetic laboratory snapshots only. Financial numerics stay PostgreSQL text.
const schemas=['public','fingence_db04_group_synthetic','fingence_reconciliation'];
// Role OIDs differ between fresh clusters; compare actual role names and permissions.
const grantee="CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END";
const acl=(column,kind,owner)=>`(SELECT jsonb_agg(jsonb_build_array(${grantee},pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY ${grantee},pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)::text FROM aclexplode(coalesce(${column},acldefault('${kind}',${owner}))) a)`;
export async function snapshotGroupSynthetic(pool){
 const tables=(await pool.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind='r' ORDER BY n.nspname,c.relname",[schemas])).rows;
 const rows={};
 for(const t of tables){const name=`${t.nspname}.${t.relname}`;if(!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(name))throw Error('Unexpected local snapshot identifier');rows[name]=(await pool.query(`SELECT to_jsonb(t)::text AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);}
 const query=async sql=>(await pool.query(sql,[schemas])).rows;
 const schema={
  namespaces:await query(`SELECT n.nspname,pg_get_userbyid(n.nspowner) AS owner,${acl('n.nspacl','n','n.nspowner')} AS acl FROM pg_namespace n WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname`),
  tables:await query(`SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,${acl('c.relacl','r','c.relowner')} AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind='r' ORDER BY n.nspname,c.relname`),
  columns:await query(`SELECT n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=ANY($1::text[]) AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`),
  constraints:await query(`SELECT n.nspname,c.relname,x.conname,pg_get_constraintdef(x.oid) AS definition,x.convalidated,x.condeferrable,x.condeferred FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname,c.relname,x.conname`),
  functions:await query(`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,${acl('p.proacl','f','p.proowner')} AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname,p.proname,arguments`),
  triggers:await query(`SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname`),
  indexes:await query('SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,tablename,indexname'),
  policies:await query('SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,tablename,policyname'),
 };
 return {rows,schema};
}
