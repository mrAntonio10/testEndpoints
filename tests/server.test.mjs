import test from 'node:test';
import assert from 'node:assert/strict';
import {createSandboxServer} from '../server.mjs';
import {sandboxBackend} from '../src/backend.mjs';
import {makeCredential} from '../scripts/create-credential.mjs';
const token='rk_test_'+'1'.repeat(64),a='10000000-0000-4000-8000-000000000001';
async function serve(deps,fn){
  const s=createSandboxServer(deps);await new Promise(r=>s.listen(0,'127.0.0.1',r));
  try{await fn(`http://127.0.0.1:${s.address().port}`);}finally{await new Promise(r=>s.close(r));}
}
test('gateway cerrado por defecto, sin base ni secretos configurados',async()=>{
  await serve(sandboxBackend({}),async base=>{
    const r=await fetch(base+'/integrations/v1/branches');assert.equal(r.status,503);assert.equal((await r.json()).code,'INTEGRATION_NOT_ENABLED');
    const h=await fetch(base+'/health');assert.deepEqual(await h.json(),{service:'rekids-api-sandbox',environment:'test',configured:false});
  });
});
test('no requiere ni acepta service_role, solo publica rutas de lectura',async()=>{
  for(const key of ['sb_secret_PRIVATE', 'admin', ''])assert.throws(()=>sandboxBackend({REKIDS_SANDBOX_ENABLED:'true',SUPABASE_STAGING_REF:'a'.repeat(20),SUPABASE_ANON_KEY:key}));
  const jwt=['eyJ',Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),'x'].join('.');
  assert.throws(()=>sandboxBackend({REKIDS_SANDBOX_ENABLED:'true',SUPABASE_STAGING_REF:'a'.repeat(20),SUPABASE_ANON_KEY:jwt}));
  await serve({enabled:true,environment:'test',read:async()=>({status:200,data:{items:[{id:a,name:'DEMO',secret:'no exponer'}]}})},async base=>{
    let r=await fetch(base+'/integrations/v1/branches',{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200);assert.deepEqual(await r.json(),{items:[{id:a,name:'DEMO'}]});
    assert.match(r.headers.get('cache-control'),/no-store/);
    r=await fetch(base+'/integrations/v1/branches');assert.equal(r.status,401);
    r=await fetch(base+'/integrations/v1/branches',{method:'POST',headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,405);
    for(const route of ['/rest/v1/mamas','/integrations/v1/orders','/admin','/api/pagos'])assert.equal((await fetch(base+route)).status,404);
  });
});
test('credencial nueva solo test, aleatoria, hash SQL y vencimiento de 30 días',()=>{
  const one=makeCredential(new Date('2026-11-23T00:00:00Z')),two=makeCredential(new Date('2026-11-23T00:00:00Z'));
  assert.match(one.credential.token,/^rk_test_[a-f0-9]{64}$/);assert.notEqual(one.credential.token,two.credential.token);
  assert.equal(one.credential.expires_at,'2026-12-23T00:00:00.000Z');assert.ok(!one.sql.includes(one.credential.token));
  assert.match(one.sql,/branches:read','catalog:read/);assert.doesNotMatch(one.sql,/sales:|service_role|admin'/);
});
test('el backend impone test y no reenvía la integración a otra ruta o proveedor',async()=>{
  const backend=sandboxBackend({REKIDS_SANDBOX_ENABLED:'true',SUPABASE_STAGING_REF:'a'.repeat(20),SUPABASE_ANON_KEY:'sb_publishable_'+'x'.repeat(20)},async(url,options)=>{
    assert.equal(url,'https://'+'a'.repeat(20)+'.supabase.co/rest/v1/rpc/integration_catalog_read');
    assert.equal(JSON.parse(options.body).p_environment,'test');assert.equal(options.headers.Authorization,undefined);
    return new Response(JSON.stringify({status:200,data:{items:[]}}));
  });
  assert.deepEqual(await backend.read({p_environment:'test'}),{status:200,data:{items:[]}});
  await assert.rejects(backend.read({p_environment:'production'}));
});
