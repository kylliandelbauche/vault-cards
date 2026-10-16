-- Boîte de réception IA (#55) : l'app dépose un texte collé ou un fichier ; /flashcards (Mac, clé secrète) le traite
-- et insère des cartes en brouillon (`status = 'draft'`, `source = 'inbox'`) que l'utilisateur accepte ou rejette.
-- Pipeline : 1. l'app envoie le fichier dans le bucket privé `inbox` (`<uid>/<id>`, insertion seule) ;
-- 2. RPC create_inbox_item : vérifie l'objet réellement stocké (type, taille), le quota, puis crée la ligne `pending`.
-- L'IA ne touche jamais la base : l'outil valide son JSON avant d'écrire.

-- Limites (aussi dans src/lib/inbox.ts et tools/cards/inbox.ts) : 30 Mo par fichier, 10 Mo par image,
-- 100 000 caractères par texte collé, 10 éléments en attente (pending + processing) au plus.

create table public.inbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('text', 'file')),
  text text check (text is null or char_length(text) between 1 and 100000),
  storage_path text check (storage_path is null or char_length(storage_path) between 1 and 200),
  filename text check (filename is null or char_length(filename) between 1 and 255),
  mime text check (mime is null or mime in (
    'application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp'
  )),
  size bigint check (size is null or size between 1 and 31457280),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  error text check (error is null or char_length(error) between 1 and 300),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  -- Un texte n'a ni fichier ni métadonnées ; un fichier n'a pas de texte et toutes ses métadonnées.
  constraint inbox_kind_shape_check check (
    (kind = 'text' and text is not null and storage_path is null and filename is null and mime is null and size is null)
    or (kind = 'file' and text is null and storage_path is not null and filename is not null and mime is not null and size is not null)
  ),
  constraint inbox_image_size_check check (mime is null or mime not like 'image/%' or size <= 10485760),
  -- Message d'erreur court, seulement pour un élément en erreur.
  constraint inbox_error_status_check check (error is null or status = 'error')
);
create index inbox_status_idx on public.inbox (status, created_at);

alter table public.inbox enable row level security;
revoke all on public.inbox from anon, authenticated, service_role;

-- App : lecture seule de la table (statuts). Pas d'insert direct : tout passe par create_inbox_item (statut forcé
-- `pending`, objet vérifié). Ni update ni delete (annuler un élément : hors périmètre, pas de droit superflu).
grant select on public.inbox to authenticated;
create policy "authenticated read inbox" on public.inbox for select to authenticated using (true);

-- Outil local (clé secrète, RLS contournée) : traite la file.
grant select, insert, update, delete on public.inbox to service_role;

-- Storage : bucket privé, mêmes types et taille maximale que la table (contrôlés par Storage à l'envoi).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inbox', 'inbox', false, 31457280, array[
  'application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp'
]);

-- App : peut seulement DÉPOSER un objet `<son uid>/<uuid>` dans `inbox`. Aucune policy select/update/delete pour
-- authenticated : il ne peut ni relire, ni lister, ni remplacer (upsert), ni supprimer un fichier. anon : rien.
-- service_role contourne la RLS (téléchargement et suppression par l'outil).
create policy "authenticated upload inbox" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inbox'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );

-- Création d'un élément (seule écriture de l'app dans `inbox`). SECURITY DEFINER : lit storage.objects (que l'app ne
-- peut pas lire) pour prendre la taille et le type de l'objet réellement stocké, jamais ceux annoncés par le client.
-- Idempotent : rappeler avec le même id renvoie l'élément déjà créé.
create function public.create_inbox_item(p_id uuid, p_kind text, p_text text default null, p_filename text default null)
returns public.inbox
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.inbox;
  v_path text;
  v_meta jsonb;
  v_size bigint;
  v_mime text;
begin
  if v_uid is null then raise exception 'session requise' using errcode = '42501'; end if;
  if p_id is null then raise exception 'id manquant' using errcode = '22023'; end if;

  select * into v_row from public.inbox where id = p_id;
  if found then return v_row; end if;

  if (select count(*) from public.inbox where status in ('pending', 'processing')) >= 10 then
    raise exception 'boîte de réception pleine : 10 éléments en attente au maximum' using errcode = '54000';
  end if;

  if p_kind = 'text' then
    if p_text is null or btrim(p_text) = '' then raise exception 'texte vide' using errcode = '22023'; end if;
    if char_length(p_text) > 100000 then raise exception 'texte trop long (100 000 caractères au maximum)' using errcode = '22023'; end if;
    insert into public.inbox (id, kind, text) values (p_id, 'text', p_text) returning * into v_row;
    return v_row;
  end if;

  if p_kind <> 'file' or p_kind is null then raise exception 'type d''élément inconnu' using errcode = '22023'; end if;
  if p_filename is null or char_length(p_filename) not between 1 and 255 or p_filename ~ '[[:cntrl:]/\\]' then
    raise exception 'nom de fichier invalide' using errcode = '22023';
  end if;

  v_path := v_uid::text || '/' || p_id::text;
  select metadata into v_meta from storage.objects where bucket_id = 'inbox' and name = v_path;
  if not found then raise exception 'fichier introuvable : l''envoyer avant de créer l''élément' using errcode = '22023'; end if;
  v_size := (v_meta ->> 'size')::bigint;
  v_mime := v_meta ->> 'mimetype';
  if v_mime is null or v_mime not in ('application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp') then
    raise exception 'format refusé' using errcode = '22023';
  end if;
  if v_size is null or v_size < 1 or v_size > 31457280 then raise exception 'fichier trop gros (30 Mo au maximum)' using errcode = '22023'; end if;
  if v_mime like 'image/%' and v_size > 10485760 then raise exception 'image trop grosse (10 Mo au maximum)' using errcode = '22023'; end if;

  insert into public.inbox (id, kind, storage_path, filename, mime, size)
  values (p_id, 'file', v_path, p_filename, v_mime, v_size)
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.create_inbox_item(uuid, text, text, text) from public, anon;
grant execute on function public.create_inbox_item(uuid, text, text, text) to authenticated;

-- Brouillons : cartes proposées par /flashcards depuis la boîte de réception.
alter table public.cards add column status text not null default 'active';
alter table public.cards add constraint cards_status_check check (status in ('active', 'draft'));
alter table public.cards add column inbox_id uuid references public.inbox (id) on delete set null;
create index cards_inbox_id_idx on public.cards (inbox_id) where inbox_id is not null;

alter table public.cards drop constraint cards_source_check;
alter table public.cards add constraint cards_source_check check (source in ('vault', 'manual', 'inbox'));
-- Carte de la boîte de réception : pas de note du vault, 1 à 2 tags ; source_title = titre court du document.
alter table public.cards add constraint cards_inbox_shape_check check (
  source <> 'inbox' or (deck is null and source_path is null and cardinality(tags) >= 1)
);
-- Seules les cartes de la boîte de réception peuvent être des brouillons ou être rattachées à un élément.
alter table public.cards add constraint cards_draft_source_check check (status = 'active' or source = 'inbox');
alter table public.cards add constraint cards_inbox_link_check check (inbox_id is null or source = 'inbox');

-- Une carte active ne repasse jamais en brouillon (ni par l'app, ni par l'outil).
create function public.cards_forbid_redraft() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'active' and new.status = 'draft' then
    raise exception 'une carte active ne repasse jamais en brouillon' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.cards_forbid_redraft() from public, anon, authenticated;
create trigger cards_forbid_redraft before update of status on public.cards
  for each row execute function public.cards_forbid_redraft();

-- App : en plus de #54 (front, back, tags, deleted_at), la colonne status (accepter un brouillon). Jamais source, id,
-- inbox_id, deck, source_path, source_title ; toujours aucune insertion de carte inbox (policy d'insert inchangée :
-- source = 'manual', et status/inbox_id ne sont pas dans les colonnes insérables, donc défaut active / null).
grant update (status) on public.cards to authenticated;

drop policy "authenticated update manual cards" on public.cards;
-- Cartes manual et inbox modifiables ; une carte vault reste invisible pour l'update (0 ligne modifiée).
create policy "authenticated update app cards" on public.cards
  for update to authenticated using (source in ('manual', 'inbox')) with check (source in ('manual', 'inbox'));

-- Aucun droit pour anon (rien n'est accordé à anon dans ce fichier).
