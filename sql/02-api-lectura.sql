begin;
do $$begin
  if not exists(select 1 from public.rekids_sandbox_marker where marker='SYNTHETIC_REKIDS_API_SANDBOX_V1')
    or exists(select 1 from information_schema.tables where table_schema='public' and table_name not in('rekids_sandbox_marker','sucursales','prendas')) then
    raise exception 'Solo se instala en la base mínima de datos ficticios; no se permite una aplicación existente';
  end if;
end $$;
-- Etapa 1: solo lectura comercial. No crea credenciales ni publica prendas.
create schema rekids_integrations;
revoke all on schema rekids_integrations from public,anon,authenticated,service_role;

-- Sin configuración explícita del entorno físico, también el RPC falla cerrado.
-- Staging requiere otra base con datos ficticios; no es un scope sobre producción.
create table rekids_integrations.configuration (
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in('test','production')),
  enabled boolean not null default false
);

create table rekids_integrations.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 3 and 120),
  environment text not null check(environment in('test','production')),
  token_sha256 text not null unique check(token_sha256 ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check(scopes <@ array['branches:read','catalog:read']::text[]),
  branches uuid[] not null check(cardinality(branches)>0),
  expires_at timestamptz not null, revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table rekids_integrations.catalog (
  product_id uuid primary key references public.prendas(id),
  published boolean not null default false,
  title text not null check(length(title) between 2 and 200),
  category text not null check(length(category) between 1 and 100),
  size text, brand text, condition text not null check(length(condition) between 1 and 120),
  -- Solo URLs comerciales revisadas: no se copia foto_url ni un bucket privado.
  photos jsonb not null default '[]'::jsonb check(jsonb_typeof(photos)='array'),
  version bigint not null default 1 check(version>0),
  updated_at timestamptz not null default clock_timestamp()
);
create table rekids_integrations.rate_buckets (
  client_id uuid primary key references rekids_integrations.clients(id),
  minute timestamptz not null, requests integer not null
);
create table rekids_integrations.audit (
  id bigint generated always as identity primary key,
  request_id uuid not null, client_id uuid not null references rekids_integrations.clients(id),
  operation text not null, branch_id uuid, status integer not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index integration_audit_time on rekids_integrations.audit(occurred_at);
alter table rekids_integrations.clients enable row level security;
alter table rekids_integrations.configuration enable row level security;
alter table rekids_integrations.catalog enable row level security;
alter table rekids_integrations.rate_buckets enable row level security;
alter table rekids_integrations.audit enable row level security;
revoke all on all tables in schema rekids_integrations from public,anon,authenticated,service_role;
revoke all on all sequences in schema rekids_integrations from public,anon,authenticated,service_role;

create function rekids_integrations.validate_catalog() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare photo jsonb;
begin
  if jsonb_array_length(new.photos)>12 then raise exception 'Hasta 12 fotos comerciales';end if;
  for photo in select value from jsonb_array_elements(new.photos) loop
    if jsonb_typeof(photo)<>'object' or (photo - array['id','url','primary'])<>'{}'::jsonb
      or coalesce(photo->>'id','') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(photo->>'url','') !~ '^https://[^/@?#[:space:]]+/[^?#[:space:]]*$'
      or coalesce(jsonb_typeof(photo->'primary'),'')<>'boolean'
      or length(coalesce(photo->>'url',''))>2048 then
      raise exception 'Fotos: solo id, URL HTTPS comercial revisada y primary';
    end if;
  end loop;
  if tg_op='UPDATE' then new.version:=old.version+1;end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger integration_catalog_validate before insert or update on rekids_integrations.catalog
for each row execute function rekids_integrations.validate_catalog();

-- Reacciona a stock/precio/código sin modificar la prenda ni datos financieros.
create function rekids_integrations.touch_product() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if row(old.precio,old.estado_ciclo,old.sucursal_actual,old.codigo,old.codigo_anterior)
    is distinct from row(new.precio,new.estado_ciclo,new.sucursal_actual,new.codigo,new.codigo_anterior) then
    update rekids_integrations.catalog set updated_at=clock_timestamp() where product_id=new.id;
  end if;
  return new;
end $$;
create trigger integration_product_changed after update of precio,estado_ciclo,sucursal_actual,codigo,codigo_anterior
on public.prendas for each row execute function rekids_integrations.touch_product();
revoke all on all functions in schema rekids_integrations from public,anon,authenticated,service_role;

-- Única puerta de datos: el Bearer de integración NO es una sesión de personal.
-- SECURITY DEFINER justificado por tablas privadas. Antes de leer: hash de token
-- de 256 bits, entorno, vigencia, scopes y sucursal. No consulta proveedoras/pagos.
create function public.integration_catalog_read(
  p_token text,p_environment text,p_operation text,p_branch uuid default null,
  p_product uuid default null,p_after uuid default null,p_limit integer default 50,
  p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  client rekids_integrations.clients%rowtype;
  result jsonb; entries jsonb; next_id uuid; v_count integer;
  v_status integer:=200; v_code text; v_scope text;
  v_minute timestamptz:=date_trunc('minute',clock_timestamp());
begin
  if p_environment is null or p_environment not in('test','production')
    or not exists(select 1 from rekids_integrations.configuration c where c.environment=p_environment and c.enabled)
    or p_token is null or length(p_token)<>72
    or p_token !~ '^rk_(test|live)_[0-9a-f]{64}$'
    or (p_environment='test' and p_token not like 'rk_test_%')
    or (p_environment='production' and p_token not like 'rk_live_%') then
    return jsonb_build_object('status',401,'code','UNAUTHORIZED');
  end if;
  select * into client from rekids_integrations.clients c
    where c.token_sha256=encode(extensions.digest(p_token,'sha256'),'hex')
      and c.environment=p_environment and c.revoked_at is null and c.expires_at>clock_timestamp();
  if not found then return jsonb_build_object('status',401,'code','UNAUTHORIZED');end if;

  insert into rekids_integrations.rate_buckets as b(client_id,minute,requests)
    values(client.id,v_minute,1) on conflict(client_id) do update
    set minute=v_minute,requests=case when b.minute=v_minute then least(b.requests+1,61) else 1 end
    returning requests into v_count;
  v_scope:=case p_operation when 'branches' then 'branches:read' when 'products' then 'catalog:read' when 'product' then 'catalog:read' end;
  if v_count>60 then v_status:=429;v_code:='RATE_LIMITED';
  elsif p_request_id is null or p_limit is null or p_limit not between 1 and 100 or v_scope is null then
    v_status:=400;v_code:='INVALID_REQUEST';
  elsif not(v_scope=any(client.scopes)) then v_status:=403;v_code:='SCOPE_DENIED';
  elsif p_operation='products' and (p_branch is null or not(p_branch=any(client.branches))) then
    v_status:=403;v_code:='SCOPE_DENIED';
  elsif p_operation='product' and p_product is null then v_status:=400;v_code:='INVALID_REQUEST';
  else
    if p_operation='branches' then
      select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.nombre)order by s.id),'[]')) into result
        from public.sucursales s where s.id=any(client.branches) and s.activa;
    else
      with page as (
        select p.id,jsonb_build_object(
          'id',p.id,'code',p.codigo,'legacy_code',p.codigo_anterior,'branch_id',p.sucursal_actual,
          'name',c.title,'category',c.category,'size',c.size,'brand',c.brand,'condition',c.condition,
          'price',p.precio::numeric(14,2)::text,'currency','BOB',
          'availability',case when p.estado_ciclo='disponible' then 'available' else 'unavailable' end,
          'photos',c.photos,'updated_at',c.updated_at,'version',c.version) item
        from rekids_integrations.catalog c join public.prendas p on p.id=c.product_id
        join public.sucursales s on s.id=p.sucursal_actual and s.activa
        where c.published and p.sucursal_actual=any(client.branches)
          and p.estado_ciclo in('disponible','vendida','reservada','en_transito')
          and p.precio>0
          and (p_operation<>'products' or p.sucursal_actual=p_branch)
          and (p_operation<>'product' or p.id=p_product)
          and (p_operation<>'products' or p_after is null or p.id>p_after)
        order by p.id limit (p_limit+1)
      ), numbered as (select *,row_number()over(order by id) n from page)
      select coalesce(jsonb_agg(item order by id)filter(where n<=p_limit),'[]'),
        (array_agg(id order by id)filter(where n=p_limit))[1],count(*)
        into entries,next_id,v_count from numbered;
      if p_operation='product' then
        if jsonb_array_length(entries)=0 then v_status:=404;v_code:='NOT_FOUND';
        else result:=entries->0;end if;
      else
        result:=jsonb_build_object('items',entries,'next_after',case when v_count>p_limit then next_id else null end);
      end if;
    end if;
  end if;
  -- Nunca guardar token, hash, nombres, código escaneado ni datos de personas.
  insert into rekids_integrations.audit(request_id,client_id,operation,branch_id,status)
    values(coalesce(p_request_id,gen_random_uuid()),client.id,left(coalesce(p_operation,''),30),p_branch,v_status);
  if v_status<>200 then return jsonb_build_object('status',v_status,'code',v_code);end if;
  return jsonb_build_object('status',200,'data',result);
end $$;
revoke all on function public.integration_catalog_read(text,text,text,uuid,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.integration_catalog_read(text,text,text,uuid,uuid,uuid,integer,uuid) to anon;

commit;
