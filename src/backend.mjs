import { renderPostgresBackend } from './render-pg-backend.mjs';

export function sandboxBackend(env=process.env, transport=fetch) {
  const enabled=env.REKIDS_SANDBOX_ENABLED==='true';
  if (!enabled) return {enabled:false,environment:'test',read:async()=>{throw Error('Disabled')}};
  if ((env.RENDER_DATABASE_URL || env.DATABASE_URL) && !env.SUPABASE_STAGING_REF) {
    return renderPostgresBackend(env);
  }
  const ref=env.SUPABASE_STAGING_REF ?? '';
  const key=env.SUPABASE_ANON_KEY ?? '';
  if (!/^[a-z0-9]{20}$/.test(ref)) throw Error('Configurar la referencia del proyecto aislado de pruebas.');
  let legacy=false;
  if (key.startsWith('eyJ')) {
    try {legacy=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon';} catch { /* rejected below */ }
  }
  if (!legacy && !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) throw Error('Se requiere clave pública anon/publishable; no se aceptan secretos o service_role.');
  const endpoint=`https://${ref}.supabase.co/rest/v1/rpc/integration_catalog_read`;
  return {enabled:true,environment:'test',read:async args=>{
    if(args.p_environment!=='test') throw Error('Sandbox only');
    const headers={'Content-Type':'application/json',apikey:key};
    if(legacy) headers.Authorization=`Bearer ${key}`;
    const response=await transport(endpoint,{method:'POST',headers,body:JSON.stringify({...args,p_environment:'test'}),signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw Error('Sandbox backend unavailable');
    return response.json();
  }};
}
