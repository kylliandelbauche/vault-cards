-- Source Vocal (#48) : la boîte de réception accepte aussi l'audio (m4a/mp4, webm, wav, mp3).
-- Vrais types envoyés par iOS et Chrome, sans paramètre `;codecs` : l'app normalise le type avant l'envoi (src/lib/inbox.ts),
-- le bucket compare le type exact. Limite inchangée (30 Mo), droits inchangés (dépôt seul, jamais anon), RLS inchangée.
-- Listes alignées sur src/lib/inbox.ts et tools/cards/inbox.ts.

alter table public.inbox drop constraint inbox_mime_check;
alter table public.inbox add constraint inbox_mime_check check (mime is null or mime in (
  'application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg'
));

update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg'
]
where id = 'inbox';

-- Même fonction que 20261015010000_inbox : seule la liste des types change.
create or replace function public.create_inbox_item(p_id uuid, p_kind text, p_text text default null, p_filename text default null)
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
  if v_mime is null or v_mime not in (
    'application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp',
    'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg'
  ) then
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
