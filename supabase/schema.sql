-- Aerion, discovery persistence.
--
-- Run this once in the Supabase SQL editor. It is idempotent, so running it
-- again is safe.
--
-- One table, on purpose. A discovery is a single atomic research result: the
-- measured sites, the contacts found, the score, the sizing, the money case and
-- the drafted message all belong to the same moment against the same live
-- sources. Splitting them across five tables would let them drift apart, and a
-- half-updated research record is worse than none. The queryable columns are
-- lifted out for listing and filtering; the whole record is kept in `payload` so
-- a saved discovery can be re-rendered exactly as it was produced.

create table if not exists public.discoveries (
  id              text primary key,
  created_at      timestamptz not null default now(),
  place           text not null default '',
  pack_id         text not null default '',
  operator        text not null default '',
  country         text not null default '',
  area_km2        double precision not null default 0,
  feature_count   integer not null default 0,
  named_contacts  integer not null default 0,
  icp_total       double precision,
  payload         jsonb not null
);

create index if not exists discoveries_created_at_idx on public.discoveries (created_at desc);
create index if not exists discoveries_operator_idx   on public.discoveries (lower(operator));
create index if not exists discoveries_pack_idx       on public.discoveries (pack_id);

-- Row level security stays on, and no policy is created for the anon key.
--
-- Writes and reads both go through the server, using the service role key, which
-- bypasses these policies. That key never reaches a browser. Leaving RLS enabled
-- with no anon policy means that if the anon key ever did leak into client code,
-- it would read nothing rather than the whole research corpus.
alter table public.discoveries enable row level security;
