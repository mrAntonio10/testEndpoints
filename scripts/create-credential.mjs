import {randomBytes,randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function makeCredential(now=new Date()) {
  const token='rk_test_'+randomBytes(32).toString('hex');
  const client_id=randomUUID();const expires_at=new Date(now.getTime()+30*86400000).toISOString();
  const hash=createHash('sha256').update(token).digest('hex');
  const sql=`-- Solo el SQL contiene el hash. El token permanece en el archivo privado local.
begin;
do $$begin
  if not exists(select 1 from public.rekids_sandbox_marker where marker='SYNTHETIC_REKIDS_API_SANDBOX_V1')
    or not exists(select 1 from rekids_integrations.configuration where environment='test')
    or exists(select 1 from rekids_integrations.configuration where environment<>'test') then
    raise exception 'Solo se puede emitir acceso para un sandbox de datos ficticios';
  end if;
end $$;
insert into rekids_integrations.clients(id,name,environment,token_sha256,scopes,branches,expires_at)
values('${client_id}','Desarrollador web — sandbox','test','${hash}',array['branches:read','catalog:read'],
array['10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000002'::uuid],'${expires_at}');
update rekids_integrations.configuration set enabled=true where environment='test';
commit;
`;
  return {credential:{client_id,token,expires_at,environment:'test'},sql};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const folder=path.join(root,'.secrets');
  try {
    process.umask(0o077);
    fs.mkdirSync(folder,{recursive:true,mode:0o700});
    const files=['sandbox-credential.json','04-credential.sql'].map(f=>path.join(folder,f));
    if(files.some(f=>fs.existsSync(f)))throw Error('Ya existen archivos de credencial. No se sobrescribieron; revisá o revocá el acceso anterior antes de regenerar.');
    const {credential,sql}=makeCredential();
    fs.writeFileSync(files[0],JSON.stringify(credential,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.writeFileSync(files[1],sql,{mode:0o600,flag:'wx'});
    console.log('Generado acceso de pruebas por 30 días. Token guardado en .secrets/sandbox-credential.json (no se muestra en consola).');
    console.log('Ejecutar .secrets/04-credential.sql en el proyecto VACÍO de sandbox ya instalado. No compartir el archivo de credencial ni subirlo a Git/hosting.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
