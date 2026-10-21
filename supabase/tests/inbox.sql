-- Preuve des droits de la boîte de réception (#55) : table inbox, RPC create_inbox_item, bucket privé `inbox`,
-- brouillons (cards.status / inbox_id). Sur la vraie base, sans trace : transaction annulée par le `rollback` final.
-- Lancer : supabase db query --linked -f supabase/tests/inbox.sql
-- Résultat binaire : la liste des « OK: … », sinon une erreur « ÉCHEC: … » (transaction annulée).
-- SQLSTATE : 42501 = droit refusé (privilège ou RLS), 23514 = contrainte check, 22023 = paramètre refusé, 54000 = quota.

begin;

select set_config('vc.log', '', true);

-- Données de test (rôle propriétaire, RLS non appliquée). Ids fixes hors de toute plage réelle.
insert into public.cards (id, source, deck, source_path, front, back, tags)
values ('00000000-0000-4000-8000-0000000005a1', 'vault', 'test', '3-Resources/test/x.md', '[sql-check] vault', 'R', '{IA & agents}');
insert into public.cards (id, source, front, back, tags)
values ('00000000-0000-4000-8000-0000000005b1', 'manual', '[sql-check] manuelle', 'R', '{Dev & outils}');
insert into public.inbox (id, kind, text) values ('00000000-0000-4000-8000-000000000101', 'text', '[sql-check] source');
insert into public.cards (id, source, status, inbox_id, source_title, front, back, tags) values
  ('00000000-0000-4000-8000-0000000005d1', 'inbox', 'draft', '00000000-0000-4000-8000-000000000101', 'Doc test', '[sql-check] brouillon 1', 'R', '{IA & agents}'),
  ('00000000-0000-4000-8000-0000000005d2', 'inbox', 'draft', '00000000-0000-4000-8000-000000000101', 'Doc test', '[sql-check] brouillon 2', 'R', '{IA & agents}'),
  ('00000000-0000-4000-8000-0000000005e1', 'inbox', 'active', '00000000-0000-4000-8000-000000000101', 'Doc test', '[sql-check] acceptée', 'R', '{IA & agents}');
-- Remplissage : 8 éléments en attente au total (le quota est de 10), quel que soit l'état de la vraie file.
insert into public.inbox (kind, text)
select 'text', '[sql-check] remplissage'
from generate_series(1, 8 - (select count(*)::int from public.inbox where status in ('pending', 'processing')));
-- Objets « déjà envoyés » par l'app (métadonnées posées par Storage), dans le dossier de l'utilisateur simulé.
insert into storage.objects (bucket_id, name, metadata) values
  ('inbox', '00000000-0000-0000-0000-000000000000/00000000-0000-4000-8000-000000000201', '{"size": 1234, "mimetype": "text/plain"}'),
  ('inbox', '00000000-0000-0000-0000-000000000000/00000000-0000-4000-8000-000000000202', '{"size": 12000000, "mimetype": "image/png"}');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}';

do $$
declare
  n int;
  r public.inbox;
  ok text := '';
begin
  if current_user <> 'authenticated' then raise exception 'ÉCHEC: rôle courant % au lieu de authenticated', current_user; end if;

  -- 1. Texte collé via la RPC : élément pending.
  r := public.create_inbox_item('00000000-0000-4000-8000-000000000301', 'text', '[sql-check] texte collé');
  if r.status <> 'pending' or r.kind <> 'text' then raise exception 'ÉCHEC: élément texte % / %', r.kind, r.status; end if;
  ok := ok || E'\nOK: authenticated dépose un texte via create_inbox_item (status pending)';

  -- 2. Rappel avec le même id : même élément, pas de doublon.
  r := public.create_inbox_item('00000000-0000-4000-8000-000000000301', 'text', '[sql-check] autre');
  select count(*) into n from public.inbox where id = '00000000-0000-4000-8000-000000000301';
  if n <> 1 or r.text <> '[sql-check] texte collé' then raise exception 'ÉCHEC: rappel non idempotent'; end if;
  ok := ok || E'\nOK: rappel avec le même id idempotent (1 ligne, contenu d''origine)';

  -- 3. Écriture directe dans inbox : refusée (statut forcé par la RPC).
  begin
    insert into public.inbox (kind, text, status) values ('text', '[sql-check] done', 'done');
    raise exception 'ÉCHEC: insert direct status=done accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert direct dans inbox avec status=done refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.inbox (kind, text) values ('text', '[sql-check] direct');
    raise exception 'ÉCHEC: insert direct accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert direct dans inbox (même pending) refusé (' || sqlstate || ')';
  end;
  begin
    update public.inbox set status = 'done' where id = '00000000-0000-4000-8000-000000000301';
    raise exception 'ÉCHEC: update inbox accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update inbox refusé (' || sqlstate || ')';
  end;
  begin
    delete from public.inbox where id = '00000000-0000-4000-8000-000000000301';
    raise exception 'ÉCHEC: delete inbox accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: delete inbox refusé (' || sqlstate || ')';
  end;

  -- 4. Lecture des statuts.
  select count(*) into n from public.inbox where id = '00000000-0000-4000-8000-000000000301';
  if n <> 1 then raise exception 'ÉCHEC: authenticated ne lit pas inbox'; end if;
  ok := ok || E'\nOK: authenticated lit ses éléments (statuts)';

  -- 5. Storage : aucune lecture ni modification des objets du bucket (aucune policy select/update).
  select count(*) into n from storage.objects where bucket_id = 'inbox';
  if n <> 0 then raise exception 'ÉCHEC: authenticated voit % objet(s) du bucket inbox', n; end if;
  ok := ok || E'\nOK: authenticated ne voit aucun objet du bucket inbox (0 ligne, RLS)';
  update storage.objects set name = name where bucket_id = 'inbox';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC: authenticated modifie % objet(s)', n; end if;
  ok := ok || E'\nOK: authenticated ne modifie aucun objet du bucket inbox (0 ligne)';

  -- 6. Storage : dépôt seulement dans <son uid>/<uuid>.
  insert into storage.objects (bucket_id, name)
  values ('inbox', '00000000-0000-0000-0000-000000000000/00000000-0000-4000-8000-000000000401');
  ok := ok || E'\nOK: authenticated dépose un objet dans inbox/<uid>/<uuid>';
  begin
    insert into storage.objects (bucket_id, name)
    values ('inbox', '11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-000000000402');
    raise exception 'ÉCHEC: dépôt dans le dossier d''un autre uid accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: dépôt dans le dossier d''un autre uid refusé (' || sqlstate || ')';
  end;
  begin
    insert into storage.objects (bucket_id, name)
    values ('inbox', '00000000-0000-0000-0000-000000000000/../x.pdf');
    raise exception 'ÉCHEC: nom d''objet libre accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: nom d''objet hors format <uid>/<uuid> refusé (' || sqlstate || ')';
  end;

  -- 7. Fichiers via la RPC. Seule la taille est vérifiée sur le fichier stocké ; le type est contraint par la liste blanche
  --    du bucket et l'extension (ici, métadonnées posées à la main : le vrai format est prouvé par rest-check-inbox.ts).
  begin
    perform public.create_inbox_item('00000000-0000-4000-8000-000000000202', 'file', null, 'photo.png');
    raise exception 'ÉCHEC: image de 12 Mo acceptée';
  exception when invalid_parameter_value then
    ok := ok || E'\nOK: image > 10 Mo refusée par la RPC (' || sqlstate || ' ' || sqlerrm || ')';
  end;
  begin
    perform public.create_inbox_item('00000000-0000-4000-8000-000000000299', 'file', null, 'absent.pdf');
    raise exception 'ÉCHEC: fichier absent accepté';
  exception when invalid_parameter_value then
    ok := ok || E'\nOK: élément sans fichier envoyé refusé (' || sqlstate || ')';
  end;
  r := public.create_inbox_item('00000000-0000-4000-8000-000000000201', 'file', null, 'notes.txt');
  if r.status <> 'pending' or r.mime <> 'text/plain' or r.size <> 1234 or r.storage_path <> '00000000-0000-0000-0000-000000000000/00000000-0000-4000-8000-000000000201' then
    raise exception 'ÉCHEC: élément fichier incorrect';
  end if;
  ok := ok || E'\nOK: fichier déposé puis élément créé (pending, taille prise sur l''objet stocké)';

  -- 8. Quota : 10 éléments en attente au plus.
  begin
    perform public.create_inbox_item(gen_random_uuid(), 'text', '[sql-check] de trop');
    raise exception 'ÉCHEC: 11e élément accepté';
  exception when program_limit_exceeded then
    ok := ok || E'\nOK: 11e élément en attente refusé (' || sqlstate || ' quota)';
  end;

  -- 9. Cartes : l'app n'insère jamais de carte inbox ni de brouillon.
  begin
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000005f1', 'inbox', '[sql-check] interdite', 'R', '{IA & agents}');
    raise exception 'ÉCHEC: insert d''une carte inbox accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert d''une carte source=inbox par l''app refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.cards (id, source, front, back, tags, status)
    values ('00000000-0000-4000-8000-0000000005f2', 'manual', '[sql-check] interdite', 'R', '{IA & agents}', 'draft');
    raise exception 'ÉCHEC: insert avec status accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert de la colonne status refusé (' || sqlstate || ')';
  end;

  -- 10. Accepter un brouillon (draft → active), avec édition.
  update public.cards set status = 'active', front = '[sql-check] brouillon 1 corrigé', tags = '{IA & agents,Dev & outils}'
  where id = '00000000-0000-4000-8000-0000000005d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: acceptation du brouillon : % ligne(s)', n; end if;
  ok := ok || E'\nOK: update draft→active (+ front/tags) d''une carte inbox (1 ligne)';

  -- 11. active → draft : refusé (trigger), y compris pour la carte qu'on vient d'accepter.
  begin
    update public.cards set status = 'draft' where id = '00000000-0000-4000-8000-0000000005e1';
    raise exception 'ÉCHEC: active→draft accepté';
  exception when check_violation then
    ok := ok || E'\nOK: update active→draft refusé (' || sqlstate || ' ' || sqlerrm || ')';
  end;
  begin
    update public.cards set status = 'draft' where id = '00000000-0000-4000-8000-0000000005d1';
    raise exception 'ÉCHEC: retour en brouillon accepté';
  exception when check_violation then
    ok := ok || E'\nOK: carte acceptée ne repasse pas en brouillon (' || sqlstate || ')';
  end;
  begin
    update public.cards set status = 'draft' where id = '00000000-0000-4000-8000-0000000005b1';
    raise exception 'ÉCHEC: carte manual en brouillon acceptée';
  exception when check_violation then
    ok := ok || E'\nOK: carte manual en brouillon refusée (' || sqlstate || ')';
  end;

  -- 12. Rejeter un brouillon : suppression douce.
  update public.cards set deleted_at = now() where id = '00000000-0000-4000-8000-0000000005d2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: rejet du brouillon : % ligne(s)', n; end if;
  ok := ok || E'\nOK: rejet d''un brouillon (deleted_at, 1 ligne)';

  -- 13. Colonnes interdites sur une carte inbox, et tags vides.
  begin
    update public.cards set inbox_id = null where id = '00000000-0000-4000-8000-0000000005e1';
    raise exception 'ÉCHEC: update de inbox_id accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update de la colonne inbox_id refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set source = 'manual' where id = '00000000-0000-4000-8000-0000000005e1';
    raise exception 'ÉCHEC: update de source accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update de la colonne source refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set source_title = 'x' where id = '00000000-0000-4000-8000-0000000005e1';
    raise exception 'ÉCHEC: update de source_title accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update de la colonne source_title refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set tags = '{}' where id = '00000000-0000-4000-8000-0000000005e1';
    raise exception 'ÉCHEC: carte inbox sans tag acceptée';
  exception when check_violation then
    ok := ok || E'\nOK: carte inbox sans tag refusée (' || sqlstate || ')';
  end;

  -- 14. Carte vault : modifiable depuis #79 (décision #73), mais jamais en brouillon (status).
  begin
    update public.cards set status = 'draft' where id = '00000000-0000-4000-8000-0000000005a1';
    raise exception 'ÉCHEC: carte vault en brouillon acceptée';
  exception when check_violation then
    ok := ok || E'\nOK: carte vault en brouillon refusée (' || sqlstate || ')';
  end;

  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  n int;
  ok text := '';
begin
  if current_user <> 'anon' then raise exception 'ÉCHEC: rôle courant % au lieu de anon', current_user; end if;
  begin
    perform 1 from public.inbox limit 1;
    raise exception 'ÉCHEC: anon lit inbox';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon select inbox refusé (' || sqlstate || ')';
  end;
  begin
    perform public.create_inbox_item(gen_random_uuid(), 'text', '[sql-check] anon');
    raise exception 'ÉCHEC: anon appelle create_inbox_item';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon create_inbox_item refusé (' || sqlstate || ')';
  end;
  begin
    insert into storage.objects (bucket_id, name)
    values ('inbox', '00000000-0000-0000-0000-000000000000/00000000-0000-4000-8000-000000000403');
    raise exception 'ÉCHEC: anon dépose un objet';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon dépôt dans le bucket inbox refusé (' || sqlstate || ')';
  end;
  select count(*) into n from storage.objects where bucket_id = 'inbox';
  if n <> 0 then raise exception 'ÉCHEC: anon voit % objet(s) du bucket inbox', n; end if;
  ok := ok || E'\nOK: anon ne voit aucun objet du bucket inbox (0 ligne)';
  begin
    update public.cards set status = 'active' where id = '00000000-0000-4000-8000-0000000005d2';
    raise exception 'ÉCHEC: anon modifie une carte';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon update cards refusé (' || sqlstate || ')';
  end;
  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

reset role;

-- Bucket : privé, limites posées.
do $$
declare
  b record;
begin
  select public, file_size_limit, allowed_mime_types into b from storage.buckets where id = 'inbox';
  if not found or b.public or b.file_size_limit <> 31457280 or cardinality(b.allowed_mime_types) <> 6 then
    raise exception 'ÉCHEC: bucket inbox absent, public ou mal limité';
  end if;
  perform set_config('vc.log', current_setting('vc.log') || E'\nOK: bucket inbox privé, 30 Mo, 6 types autorisés', true);
end $$;

select line as resultat from regexp_split_to_table(current_setting('vc.log'), E'\n') as line where line <> '';

rollback;
