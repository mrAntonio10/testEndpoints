-- Ejecutar SOLO en un nuevo proyecto Supabase vacío del desarrollador.
begin;
do $$begin
  if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in('r','p','f','m'))
    or exists(select 1 from pg_catalog.pg_namespace where nspname='rekids_integrations') then
    raise exception 'Instalación cancelada: se requiere una base vacía; no se modifica una aplicación existente.';
  end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$begin
  if to_regprocedure('extensions.digest(text,text)')is null then
    raise exception 'Falta pgcrypto en el esquema extensions. No se crearon tablas; revisar configuración de Supabase.';
  end if;
end $$;
create table public.rekids_sandbox_marker (
  marker text primary key check(marker='SYNTHETIC_REKIDS_API_SANDBOX_V1')
);
insert into public.rekids_sandbox_marker values('SYNTHETIC_REKIDS_API_SANDBOX_V1');
create table public.sucursales(id uuid primary key,nombre text not null,activa boolean not null default true);
create table public.prendas (
  id uuid primary key,codigo text not null unique,codigo_anterior text,
  sucursal_actual uuid not null references public.sucursales(id),
  precio numeric(14,2) not null check(precio>0),
  estado_ciclo text not null check(estado_ciclo in('disponible','vendida','reservada','en_transito','retirada'))
);
alter table public.rekids_sandbox_marker enable row level security;
alter table public.sucursales enable row level security;
alter table public.prendas enable row level security;
revoke all on public.rekids_sandbox_marker,public.sucursales,public.prendas from public,anon,authenticated,service_role;
commit;
