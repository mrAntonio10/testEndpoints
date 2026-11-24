begin;
do $$begin
  if not exists(select 1 from public.rekids_sandbox_marker where marker='SYNTHETIC_REKIDS_API_SANDBOX_V1')
    or exists(select 1 from public.prendas) or exists(select 1 from public.sucursales) then
    raise exception 'No es una instalación nueva de sandbox vacía; no se cargaron datos.';
  end if;
end $$;
insert into public.sucursales(id,nombre) values
('10000000-0000-4000-8000-000000000001','DEMO La Paz — datos ficticios'),
('10000000-0000-4000-8000-000000000002','DEMO Santa Cruz — datos ficticios'),
('10000000-0000-4000-8000-000000000003','DEMO Control sin acceso');
insert into public.prendas(id,codigo,codigo_anterior,sucursal_actual,precio,estado_ciclo) values
('20000000-0000-4000-8000-000000000001','DEMO-LP-001','DEMO-ANT-01','10000000-0000-4000-8000-000000000001',55,'disponible'),
('20000000-0000-4000-8000-000000000002','DEMO-LP-002','DEMO-ANT-01','10000000-0000-4000-8000-000000000001',35,'vendida'),
('20000000-0000-4000-8000-000000000003','DEMO-SC-001',null,'10000000-0000-4000-8000-000000000002',40,'disponible'),
('20000000-0000-4000-8000-000000000004','DEMO-SC-002',null,'10000000-0000-4000-8000-000000000002',65,'reservada'),
('20000000-0000-4000-8000-000000000005','DEMO-OCULTA',null,'10000000-0000-4000-8000-000000000001',20,'disponible'),
('20000000-0000-4000-8000-000000000006','DEMO-CONTROL',null,'10000000-0000-4000-8000-000000000003',25,'disponible');
insert into rekids_integrations.catalog(product_id,title,category,size,brand,condition,published) values
('20000000-0000-4000-8000-000000000001','DEMO Vestido azul','Vestidos','6','Marca ficticia','Excelente',true),
('20000000-0000-4000-8000-000000000002','DEMO Polera vendida','Poleras','4','Marca ficticia','Bueno',true),
('20000000-0000-4000-8000-000000000003','DEMO Zapatos','Zapatos','28',null,'Excelente',true),
('20000000-0000-4000-8000-000000000004','DEMO Abrigo reservado','Abrigos','8',null,'Bueno',true),
('20000000-0000-4000-8000-000000000005','DEMO No publicar','Ropa','6',null,'Bueno',false),
('20000000-0000-4000-8000-000000000006','DEMO Fuera del alcance','Ropa','4',null,'Bueno',true);
insert into rekids_integrations.configuration(environment,enabled)values('test',false);
commit;
