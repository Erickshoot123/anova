begin;
create table public.prospectos (
  id uuid primary key,
  fecha timestamptz not null default now(),
  respuestas jsonb not null,
  evaluaciones jsonb not null,
  minimo integer not null,
  estado text not null,
  causas jsonb not null,
  negocio text,
  telefono text
);
alter table public.prospectos enable row level security;
revoke all on public.prospectos from public, anon, authenticated;
grant select, insert, update on public.prospectos to service_role;
commit;
