-- Tags : correctifs relevés à la relecture de #79 (#94). Ne modifie pas 20261021000000_free_tags (déjà appliquée).
--
-- 1. Le trigger cards_tags_sync se déclenche aussi quand `deleted_at` change : une carte ACTIVE restaurée qui porte un
--    nom absent de `tags` l'y crée. Un brouillon restauré ne crée toujours rien (seulement à sa validation).
-- 2. Normalisation serveur alignée exactement sur le client (shared/tags.ts, normalizeTagName), dans le même ordre :
--    NFC, espaces de bord retirés, puis espaces internes réduits à un seul. « Espace » = la liste explicite ci-dessous,
--    identique au `\s` / `trim()` de JavaScript ; ni `btrim` (espace ASCII seul) ni le `\s` de Postgres (qui, selon la
--    locale, compte aussi U+0085 et U+001C–U+001F) ne correspondaient. Le test tools/cards/tags.test.ts vérifie que
--    cette liste et celle du client sont les mêmes.
-- 3. Caractères de contrôle (U+0000–U+001F, U+007F–U+009F) refusés côté serveur, comme côté client : contrainte
--    cards_tags_check (23514) et contrainte du registre `tags`. Après normalisation, tabulations et retours à la ligne
--    sont devenus des espaces : seuls les contrôles « invisibles » restent, et ils sont refusés.
-- Limites inchangées : 1 à 40 caractères par nom, 5 tags par carte au plus. Les données existantes ont été vérifiées
-- (aucun nom ne change avec la nouvelle normalisation, aucun caractère de contrôle) : les contraintes recréées valident.
-- Droits : aucun pour anon ; tags reste en lecture seule pour authenticated et service_role (création par le trigger).

-- Normalisation d'un nom (fonction pure). Exécutable par les auteurs d'écritures sur `cards` (une contrainte check
-- s'évalue avec leurs droits), jamais par anon.
create function public.tag_name_normalize(p_name text) returns text
language sql immutable strict set search_path = '' as $$
  select regexp_replace(
    regexp_replace(
      normalize(p_name, nfc),
      '^[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
      '', 'g'),
    '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')
$$;
revoke execute on function public.tag_name_normalize(text) from public, anon;
grant execute on function public.tag_name_normalize(text) to authenticated, service_role;

-- Liste valide : chaque nom non nul, de 1 à 40 caractères, déjà normalisé, sans caractère de contrôle ; pas de doublon
-- de casse. `create or replace` garde les droits existants (authenticated, service_role ; pas anon).
create or replace function public.tag_names_valid(p_tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(
    t is not null
    and char_length(t) between 1 and 40
    and t = public.tag_name_normalize(t)
    and t !~ '[\u0000-\u001f\u007f-\u009f]'
  ), true)
  and count(distinct lower(t)) = count(*)
  from unnest(p_tags) as t
$$;

-- Contraintes recréées pour être validées sur les lignes existantes avec les nouvelles règles.
alter table public.cards drop constraint cards_tags_check;
alter table public.cards add constraint cards_tags_check check (
  cardinality(tags) <= 5 and public.tag_names_valid(tags)
);
alter table public.tags drop constraint tags_name_check;
alter table public.tags add constraint tags_name_check check (public.tag_names_valid(array[name]));

-- Trigger : même logique que #79, avec la normalisation alignée. SECURITY DEFINER (seul moyen de créer un tag),
-- search_path vide, non exécutable directement par les rôles de l'API.
create or replace function public.cards_tags_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_key text;
  v_canon text;
  v_keys text[] := '{}';
  v_out text[] := '{}';
begin
  foreach v_name in array coalesce(new.tags, '{}') loop
    v_name := public.tag_name_normalize(v_name);
    v_key := lower(v_name);
    if v_key = any (v_keys) then continue; end if;
    v_keys := v_keys || v_key;
    select t.name into v_canon from public.tags t where lower(t.name) = v_key;
    v_out := v_out || coalesce(v_canon, v_name);
  end loop;
  new.tags := v_out;
  -- Nom invalide (vide, trop long, caractère de contrôle) ou plus de 5 tags : laissé tel quel, refusé ensuite par
  -- cards_tags_check (23514), rien n'est créé. Brouillon ou carte supprimée : rien n'est créé.
  if new.status = 'active' and new.deleted_at is null and cardinality(v_out) <= 5 and public.tag_names_valid(v_out) then
    insert into public.tags (name) select unnest(v_out) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.cards_tags_sync() from public, anon, authenticated;

drop trigger cards_tags_sync on public.cards;
create trigger cards_tags_sync before insert or update of tags, status, deleted_at on public.cards
  for each row execute function public.cards_tags_sync();
