-- Tags libres et modifiables (#79). Remplace la liste fixe de 8 slugs (#26).
--
-- Modèle : `cards.tags` reste un text[], mais de NOMS de tags (plus de liste fixe), et une table `tags` sert de
-- registre (id stable, nom unique insensible à la casse, création, liste, compteurs, renommage plus tard).
-- Pourquoi pas une table de liaison card_tags : le tag voyage AVEC la carte. L'app hors ligne n'a qu'une file d'envoi
-- (les cartes), la synchro des cartes reste en une ligne par carte (pas de liaisons à supprimer / tombstones à tirer),
-- un brouillon peut porter des noms de tags qui n'existent pas encore, et deux appareils qui créent hors ligne le même
-- nom fusionnent naturellement (même clé). Le registre est tenu par un trigger côté serveur, pas par les clients.
--
-- Règle de création (trigger cards_tags_sync, avant insert/update de tags ou status) :
--   1. chaque nom est normalisé (NFC, espaces de bord retirés, espaces internes réduits à un), dédoublonné sans tenir
--      compte de la casse, et remplacé par l'orthographe d'un tag existant de même clé (« ia & agents » → « IA & agents ») ;
--   2. si la carte est ACTIVE et vivante, les noms absents de `tags` y sont créés (on conflict do nothing : idempotent,
--      fusion par nom). Un brouillon (`status = 'draft'`) ne crée jamais de tag : ses nouveaux noms ne sont créés qu'à
--      la validation (passage à active), et jamais s'ils ont été retirés avant.
-- Limites : 5 tags par carte au plus (une carte relève de peu de thèmes ; au-delà, le tag ne trie plus rien et la
-- rangée de bulles déborde), 1 à 40 caractères par nom (tient dans une bulle sur iPhone).

-- 1. Registre des tags.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (
    char_length(name) between 1 and 40
    and name = regexp_replace(btrim(normalize(name, nfc)), '\s+', ' ', 'g')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Unicité insensible à la casse (lower gère les accents : « SÉCURITÉ » = « sécurité ») ; les espaces sont déjà normalisés.
create unique index tags_name_key on public.tags (lower(name));
create index tags_updated_at_idx on public.tags (updated_at);
create trigger tags_set_updated_at before update on public.tags
  for each row execute function public.set_updated_at();

alter table public.tags enable row level security;
revoke all on public.tags from anon, authenticated, service_role;
-- App : lecture seule de la table. Elle crée des tags en écrivant les tags d'une carte qu'elle a le droit de modifier
-- (trigger ci-dessous) : pas d'insert direct, donc ni tag orphelin ni nom non normalisé.
grant select on public.tags to authenticated;
create policy "authenticated read tags" on public.tags for select to authenticated using (true);
-- Outil local (clé secrète) : lecture (liste des tags existants pour l'IA) ; il crée ses tags via les cartes, comme l'app.
grant select on public.tags to service_role;

-- 2. Les 8 slugs deviennent 8 tags nommés par leur libellé (ancien shared/tags.ts), sans perte. Toutes les cartes
-- (vivantes, supprimées, brouillons) : seul `tags` change ; ids et reviews intacts (progression conservée).
insert into public.tags (name) values
  ('IA & agents'), ('Dev & outils'), ('Sécurité'), ('Marketing & vente'),
  ('Argent & business'), ('Mental & psycho'), ('Productivité'), ('Culture');

alter table public.cards drop constraint cards_tags_check;

update public.cards c set tags = (
  select coalesce(array_agg(m.label order by t.ord), '{}')
  from unnest(c.tags) with ordinality as t(slug, ord)
  join (values
    ('ia', 'IA & agents'), ('dev', 'Dev & outils'), ('securite', 'Sécurité'), ('marketing', 'Marketing & vente'),
    ('argent', 'Argent & business'), ('mental', 'Mental & psycho'), ('productivite', 'Productivité'), ('culture', 'Culture')
  ) as m(slug, label) on m.slug = t.slug
)
where cardinality(c.tags) > 0;

-- 3. Nouvelle contrainte : 0 à 5 noms valides et normalisés, sans doublon de casse (filet de sécurité : le trigger
-- normalise avant). Les cartes manual/inbox gardent « au moins 1 tag » (contraintes de forme existantes).
create function public.tag_names_valid(p_tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(
    char_length(t) between 1 and 40 and t = regexp_replace(btrim(normalize(t, nfc)), '\s+', ' ', 'g')
  ), true)
  and count(distinct lower(t)) = count(*)
  from unnest(p_tags) as t
$$;
-- Une contrainte check s'évalue avec les droits de l'auteur de l'écriture : app et outil doivent pouvoir l'exécuter.
-- Fonction pure (aucune lecture de table) : l'exposer en RPC à authenticated ne révèle rien ; anon n'y a pas accès.
revoke execute on function public.tag_names_valid(text[]) from public, anon;
grant execute on function public.tag_names_valid(text[]) to authenticated, service_role;

alter table public.cards add constraint cards_tags_check check (
  cardinality(tags) <= 5 and public.tag_names_valid(tags)
);

-- 4. Trigger : normalisation + création des tags des cartes actives. SECURITY DEFINER : l'app (authenticated) n'a pas
-- le droit d'insérer dans `tags` directement ; seul ce trigger le fait, pour les noms d'une carte qu'elle a pu écrire.
create function public.cards_tags_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_key text;
  v_canon text;
  v_keys text[] := '{}';
  v_out text[] := '{}';
begin
  foreach v_name in array coalesce(new.tags, '{}') loop
    v_name := regexp_replace(btrim(normalize(v_name, nfc)), '\s+', ' ', 'g');
    v_key := lower(v_name);
    if v_key = any (v_keys) then continue; end if;
    v_keys := v_keys || v_key;
    select t.name into v_canon from public.tags t where lower(t.name) = v_key;
    v_out := v_out || coalesce(v_canon, v_name);
  end loop;
  new.tags := v_out;
  -- Nom vide ou trop long, ou plus de 5 tags : laissé tel quel, refusé ensuite par cards_tags_check (23514), rien n'est créé.
  if new.status = 'active' and new.deleted_at is null and cardinality(v_out) <= 5 and public.tag_names_valid(v_out) then
    insert into public.tags (name) select unnest(v_out) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.cards_tags_sync() from public, anon, authenticated;
create trigger cards_tags_sync before insert or update of tags, status on public.cards
  for each row execute function public.cards_tags_sync();

-- 5. Modification par l'utilisateur de TOUTES les cartes (décision #73) : front, back, tags, deleted_at (déjà accordés
-- par colonne en #54) et status (#55), désormais aussi sur les cartes `vault`. /flashcards peut écraser une retouche
-- (accepté). Jamais source, id, inbox_id, deck, source_path, source_title ni updated_at (aucun grant), jamais de delete.
-- Une carte vault ne peut pas passer en brouillon (cards_draft_source_check + cards_forbid_redraft).
drop policy "authenticated update app cards" on public.cards;
create policy "authenticated update cards" on public.cards
  for update to authenticated
  using (source in ('vault', 'manual', 'inbox'))
  with check (source in ('vault', 'manual', 'inbox'));

-- Aucun droit pour anon (rien n'est accordé à anon dans ce fichier).
