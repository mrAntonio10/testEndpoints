import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=(process.env.API_BASE_URL ?? '').replace(/\/$/,'');
if(!base.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw Error('Configurar API_BASE_URL HTTPS de SU sandbox; localhost solo para verificación local.');
const credential=JSON.parse(fs.readFileSync(process.env.REKIDS_CREDENTIAL_FILE ?? '.secrets/sandbox-credential.json','utf8'));
if(credential.environment!=='test' || !/^rk_test_[a-f0-9]{64}$/.test(credential.token))throw Error('Se requiere una credencial test generada para este sandbox.');
const headers={Authorization:`Bearer ${credential.token}`};
async function call(route,options={}){
  const r=await fetch(base+route,{headers,...options,signal:AbortSignal.timeout(15000)});
  return {status:r.status,data:await r.json(),headers:r.headers};
}
try {
  assert.equal((await call('/integrations/v1/branches',{headers:{}})).status,401,'Sin token debe rechazar');
  const branches=await call('/integrations/v1/branches');assert.equal(branches.status,200);assert.equal(branches.data.items.length,2);
  assert.deepEqual(branches.data.items.map(x=>x.id).sort(),['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002']);
  const list=await call('/integrations/v1/products?branch_id=10000000-0000-4000-8000-000000000001&limit=1');
  assert.equal(list.status,200);assert.equal(list.data.items.length,1);assert.ok(list.data.next_cursor);
  const second=await call('/integrations/v1/products?branch_id=10000000-0000-4000-8000-000000000001&cursor='+encodeURIComponent(list.data.next_cursor));
  assert.equal(second.status,200);assert.equal(second.data.items.length,1);assert.equal(second.data.next_cursor,null);
  assert.notEqual(list.data.items[0].id,second.data.items[0].id);
  assert.equal((await call('/integrations/v1/products?branch_id=10000000-0000-4000-8000-000000000003')).status,403);
  assert.equal((await call('/integrations/v1/products/20000000-0000-4000-8000-000000000005')).status,404);
  assert.equal((await call('/integrations/v1/products/20000000-0000-4000-8000-000000000006')).status,404);
  assert.equal((await call('/integrations/v1/products',{method:'POST'})).status,405);
  assert.equal((await call('/integrations/v1/orders')).status,404);
  for(const item of [...list.data.items,...second.data.items]){
    assert.deepEqual(Object.keys(item).sort(),['id','code','legacy_code','branch_id','name','category','size','brand','condition','price','currency','availability','photos','updated_at','version'].sort());
    assert.equal(item.branch_id,'10000000-0000-4000-8000-000000000001');
  }
  assert.match(list.headers.get('cache-control'),/no-store/);
  console.log('Smoke aprobado: autenticación, catálogo, cursor, aislamiento, ocultos, rechazo de escrituras y proyección comercial. No se registraron ventas ni pagos.');
}catch(error){console.error('Smoke falló:',error.message);process.exitCode=1;}
