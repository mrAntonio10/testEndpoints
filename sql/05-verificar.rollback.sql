begin;
do $$begin
  assert exists(select 1 from public.rekids_sandbox_marker where marker='SYNTHETIC_REKIDS_API_SANDBOX_V1'),'Falta marcador sandbox';
  assert exists(select 1 from rekids_integrations.configuration where environment='test' and enabled),'Sandbox no habilitado';
  assert (select count(*)=6 from public.prendas),'Deben existir seis prendas ficticias';
  assert not exists(select 1 from information_schema.tables where table_schema='public' and table_name in('mamas','mamas_datos_bancarios','pagos_banco','pagos_qr','liquidaciones','ventas')),'No debe contener tablas privadas';
  assert not has_schema_privilege('anon','rekids_integrations','usage');
  assert not has_schema_privilege('authenticated','rekids_integrations','usage');
  assert not has_table_privilege('anon','public.prendas','select');
  assert not has_table_privilege('anon','rekids_integrations.clients','select');
  assert has_function_privilege('anon','public.integration_catalog_read(text,text,text,uuid,uuid,uuid,integer,uuid)','execute');
  assert not has_function_privilege('authenticated','public.integration_catalog_read(text,text,text,uuid,uuid,uuid,integer,uuid)','execute');
  assert not exists(select 1 from rekids_integrations.clients where environment<>'test' or not(scopes<@array['branches:read','catalog:read']::text[]));
end $$;
select 'Sandbox de datos ficticios y privilegios verificados' as resultado;
rollback;
