-- Vault Cards : schéma initial. Un seul utilisateur, accès réservé au rôle authenticated.

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  deck text not null,
  source_path text not null,
  front text not null check (length(front) between 1 and 500),
  back text not null check (length(back) between 1 and 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index cards_updated_at_idx on public.cards (updated_at);
create index cards_source_path_idx on public.cards (source_path);

create table public.notes (
  source_path text primary key,
  content_hash text not null,
  processed_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key,
  card_id uuid not null references public.cards (id),
  rating smallint not null check (rating between 1 and 3),
  reviewed_at timestamptz not null,
  inserted_at timestamptz not null default now()
);
create index reviews_inserted_at_idx on public.reviews (inserted_at);
create index reviews_card_id_idx on public.reviews (card_id);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
-- Fonction de trigger uniquement : personne ne l'appelle directement (le déclenchement
-- d'un trigger ne vérifie pas EXECUTE). Postgres accorde EXECUTE à PUBLIC par défaut.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
create trigger cards_set_updated_at before update on public.cards
  for each row execute function public.set_updated_at();

alter table public.cards enable row level security;
alter table public.notes enable row level security;
alter table public.reviews enable row level security;

-- Point de départ sans aucun droit : les privilèges par défaut du schéma public
-- (truncate, references, trigger, maintain) sont retirés avant les grants explicites.
revoke all on public.cards, public.notes, public.reviews from anon, authenticated, service_role;

-- App (utilisateur connecté) : lit les cartes, lit et ajoute des reviews. Rien d'autre.
grant select on public.cards to authenticated;
grant select, insert on public.reviews to authenticated;
create policy "authenticated read cards" on public.cards for select to authenticated using (true);
create policy "authenticated read reviews" on public.reviews for select to authenticated using (true);
create policy "authenticated insert reviews" on public.reviews for insert to authenticated with check (true);

-- Outil local (clé secrète) : lecture et écriture complètes, RLS contournée par service_role.
grant select, insert, update, delete on public.cards, public.notes, public.reviews to service_role;

-- Aucun accès anonyme (déjà retiré plus haut ; aucun grant à anon dans ce fichier).
