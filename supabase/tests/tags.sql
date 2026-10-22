-- Preuve des tags libres (#79, correctifs #94) sur la vraie base, sans trace : tout se passe dans une transaction annulée par le
-- `rollback` final. Lancer : supabase db query --linked -f supabase/tests/tags.sql
-- Résultat binaire : la liste des « OK: … » si tout est conforme, sinon une erreur « ÉCHEC: … » (transaction annulée).
-- Codes attendus : 42501 = droit refusé (privilège ou RLS), 23514 = contrainte check.

begin;

select set_config('vc.log', '', true);

-- Données de test (rôle propriétaire). Ids fixes hors de toute plage réelle.
insert into public.cards (id, source, deck, source_path, front, back, tags)
values ('00000000-0000-4000-8000-0000000079a1', 'vault', 'test', '3-Resources/test/x.md', '[sql-check] vault', 'R', '{IA & agents}');
insert into public.cards (id, source, front, back, tags)
values ('00000000-0000-4000-8000-0000000079b2', 'manual', '[sql-check] manuelle', 'R', '{Culture}');
-- Brouillons : un nouveau nom de tag proposé par l'IA, jamais créé tant que la carte n'est pas validée.
insert into public.cards (id, source, status, source_title, front, back, tags) values
  ('00000000-0000-4000-8000-0000000079c3', 'inbox', 'draft', 'Doc', '[sql-check] brouillon 1', 'R', '{[sql-check] validé,IA & agents}'),
  ('00000000-0000-4000-8000-0000000079c4', 'inbox', 'draft', 'Doc', '[sql-check] brouillon 2', 'R', '{[sql-check] retiré,Culture}');

-- Cartes supprimées (#94) : une active et un brouillon, chacun avec un nom de tag nouveau ; rien n'est créé tant
-- qu'elles sont supprimées.
insert into public.cards (id, source, front, back, tags, deleted_at)
values ('00000000-0000-4000-8000-0000000094e5', 'manual', '[sql-check] supprimée', 'R', '{[sql-check] restauré}', now());
insert into public.cards (id, source, status, source_title, front, back, tags, deleted_at)
values ('00000000-0000-4000-8000-0000000094e6', 'inbox', 'draft', 'Doc', '[sql-check] brouillon supprimé', 'R', '{[sql-check] brouillon restauré}', now());

do $$
declare n int;
begin
  select count(*) into n from public.tags where name in ('IA & agents', 'Dev & outils', 'Sécurité', 'Marketing & vente',
    'Argent & business', 'Mental & psycho', 'Productivité', 'Culture');
  if n <> 8 then raise exception 'ÉCHEC: % tag(s) migré(s) sur 8', n; end if;
  select count(*) into n from public.tags where lower(name) in ('[sql-check] validé', '[sql-check] retiré');
  if n <> 0 then raise exception 'ÉCHEC: un brouillon a créé un tag'; end if;
  perform set_config('vc.log', current_setting('vc.log')
    || E'\nOK: les 8 anciens tags existent sous leur libellé'
    || E'\nOK: un brouillon inséré ne crée aucun tag', true);
  select count(*) into n from public.tags where lower(name) in ('[sql-check] restauré', '[sql-check] brouillon restauré');
  if n <> 0 then raise exception 'ÉCHEC: une carte supprimée a créé un tag'; end if;
  -- Trigger et fonctions (#94) : SECURITY DEFINER + search_path vide conservés ; déclenché aussi par deleted_at ;
  -- aucun droit d'exécution pour anon ; le trigger n'est exécutable par aucun rôle de l'API.
  if not exists (select 1 from pg_proc where oid = 'public.cards_tags_sync()'::regprocedure
                 and prosecdef and proconfig = array['search_path=""']) then
    raise exception 'ÉCHEC: cards_tags_sync n''est plus SECURITY DEFINER avec search_path vide';
  end if;
  if not exists (select 1 from information_schema.triggered_update_columns
                 where trigger_name = 'cards_tags_sync' and event_object_table = 'cards' and event_object_column = 'deleted_at') then
    raise exception 'ÉCHEC: cards_tags_sync ne se déclenche pas sur deleted_at';
  end if;
  if has_function_privilege('anon', 'public.tag_name_normalize(text)', 'execute')
     or has_function_privilege('anon', 'public.tag_names_valid(text[])', 'execute')
     or has_function_privilege('anon', 'public.cards_tags_sync()', 'execute')
     or has_function_privilege('authenticated', 'public.cards_tags_sync()', 'execute') then
    raise exception 'ÉCHEC: droit d''exécution en trop (anon ou trigger)';
  end if;
  if not (has_function_privilege('authenticated', 'public.tag_name_normalize(text)', 'execute')
          and has_function_privilege('service_role', 'public.tag_name_normalize(text)', 'execute')) then
    raise exception 'ÉCHEC: tag_name_normalize non exécutable par authenticated/service_role (contrainte check)';
  end if;
  -- Normalisation serveur = client (shared/tags.ts, mêmes cas que tools/cards/tags.test.ts) : NFC, bords, espaces Unicode.
  if public.tag_name_normalize(E'\tfoo\n') <> 'foo'
     or public.tag_name_normalize(E'\u00a0IA\u3000\u2003&\u202fagents\ufeff') <> 'IA & agents'
     or public.tag_name_normalize(E'a\u2028\u2029b') <> 'a b'
     or public.tag_name_normalize(E'a\u200bb') <> E'a\u200bb'
     or public.tag_name_normalize(E' a\u0085 ') <> E'a\u0085'
     or public.tag_name_normalize(E'Se\u0301curite\u0301') <> E'Sécurité'
     or public.tag_name_normalize(E'  IA   &\tagents ') <> 'IA & agents' then
    raise exception 'ÉCHEC: normalisation serveur différente du client';
  end if;
  perform set_config('vc.log', current_setting('vc.log')
    || E'\nOK: une carte supprimée (active ou brouillon) ne crée aucun tag'
    || E'\nOK: cards_tags_sync SECURITY DEFINER, search_path vide, déclenché aussi par deleted_at'
    || E'\nOK: aucun droit d''exécution pour anon ; trigger non exécutable par authenticated'
    || E'\nOK: normalisation serveur identique au client sur 7 cas limites (espaces Unicode, U+200B, U+0085, NFC)', true);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}';

do $$
declare
  n int;
  t text[];
  v text;
  ok text := '';
begin
  if current_user <> 'authenticated' then raise exception 'ÉCHEC: rôle courant % au lieu de authenticated', current_user; end if;

  -- 1. Lecture du registre.
  select count(*) into n from public.tags;
  if n < 8 then raise exception 'ÉCHEC: authenticated lit % tag(s)', n; end if;
  ok := ok || E'\nOK: authenticated lit la table tags';

  -- 2. Pas d'écriture directe dans tags (création seulement via les tags d'une carte).
  begin
    insert into public.tags (name) values ('[sql-check] direct');
    raise exception 'ÉCHEC: insert direct dans tags accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert direct dans tags refusé (' || sqlstate || ')';
  end;
  begin
    update public.tags set name = 'x' where name = 'Culture';
    raise exception 'ÉCHEC: update de tags accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update de tags refusé (' || sqlstate || ')';
  end;
  begin
    delete from public.tags where name = 'Culture';
    raise exception 'ÉCHEC: delete de tags accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: delete de tags refusé (' || sqlstate || ')';
  end;

  -- 3. Carte VAULT : front, back, tags modifiables (#73) ; nouveau tag créé par authenticated, noms normalisés
  --    (espaces) et ramenés à l'orthographe existante (casse).
  update public.cards set front = '[sql-check] vault modifiée', back = 'R2', tags = '{ia & AGENTS,"  [sql-check]   Tag  libre "}'
  where id = '00000000-0000-4000-8000-0000000079a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: update d''une carte vault : % ligne(s)', n; end if;
  select tags into t from public.cards where id = '00000000-0000-4000-8000-0000000079a1';
  if t <> '{IA & agents,[sql-check] Tag libre}'::text[] then raise exception 'ÉCHEC: tags vault = %', t; end if;
  select count(*) into n from public.tags where name = '[sql-check] Tag libre';
  if n <> 1 then raise exception 'ÉCHEC: tag libre non créé'; end if;
  ok := ok || E'\nOK: update front/back/tags d''une carte vault (1 ligne) ; tag créé, nom normalisé et casse existante reprise';

  -- 4. Unicité insensible à la casse : même nom autrement écrit sur une carte MANUAL → aucun doublon.
  update public.cards set tags = '{[SQL-CHECK] tag LIBRE,culture}' where id = '00000000-0000-4000-8000-0000000079b2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: update des tags d''une carte manual : % ligne(s)', n; end if;
  select tags into t from public.cards where id = '00000000-0000-4000-8000-0000000079b2';
  if t <> '{[sql-check] Tag libre,Culture}'::text[] then raise exception 'ÉCHEC: tags manual = %', t; end if;
  select count(*) into n from public.tags where lower(name) = '[sql-check] tag libre';
  if n <> 1 then raise exception 'ÉCHEC: % tags pour un même nom', n; end if;
  ok := ok || E'\nOK: update des tags d''une carte manual ; unicité insensible à la casse (1 seul tag)';

  -- 5. Doublon dans une même carte (casse différente) : un seul gardé.
  update public.cards set tags = '{[sql-check] dup,[SQL-check] DUP}' where id = '00000000-0000-4000-8000-0000000079b2';
  select tags into t from public.cards where id = '00000000-0000-4000-8000-0000000079b2';
  if t <> '{[sql-check] dup}'::text[] then raise exception 'ÉCHEC: doublon conservé : %', t; end if;
  ok := ok || E'\nOK: doublon de casse dans une carte dédoublonné';

  -- 6. Brouillon INBOX : retouche des tags sans valider → rien n'est créé ; validation → les tags restants sont créés,
  --    un tag retiré avant la validation ne l'est jamais.
  update public.cards set tags = '{[sql-check] validé,IA & agents,[sql-check] autre}' where id = '00000000-0000-4000-8000-0000000079c3';
  select count(*) into n from public.tags where name in ('[sql-check] validé', '[sql-check] autre');
  if n <> 0 then raise exception 'ÉCHEC: retouche d''un brouillon a créé un tag'; end if;
  update public.cards set status = 'active' where id = '00000000-0000-4000-8000-0000000079c3';
  select count(*) into n from public.tags where name in ('[sql-check] validé', '[sql-check] autre');
  if n <> 2 then raise exception 'ÉCHEC: validation : % tag(s) créé(s) sur 2', n; end if;
  update public.cards set tags = '{Culture}', status = 'active' where id = '00000000-0000-4000-8000-0000000079c4';
  select count(*) into n from public.tags where name = '[sql-check] retiré';
  if n <> 0 then raise exception 'ÉCHEC: tag retiré avant validation créé'; end if;
  ok := ok || E'\nOK: brouillon inbox : tags modifiables, créés seulement à la validation, jamais si retirés avant';

  -- 7. Limites : 6 tags, nom de 41 caractères, nom vide → 23514, rien de créé.
  begin
    update public.cards set tags = '{a1,a2,a3,a4,a5,a6}' where id = '00000000-0000-4000-8000-0000000079b2';
    raise exception 'ÉCHEC: 6 tags acceptés';
  exception when check_violation then
    ok := ok || E'\nOK: 6 tags refusés (' || sqlstate || ')';
  end;
  begin
    update public.cards set tags = array[repeat('x', 41)] where id = '00000000-0000-4000-8000-0000000079b2';
    raise exception 'ÉCHEC: nom de 41 caractères accepté';
  exception when check_violation then
    ok := ok || E'\nOK: nom de tag > 40 caractères refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set tags = '{"   "}' where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: nom vide accepté';
  exception when check_violation then
    ok := ok || E'\nOK: nom de tag vide refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set tags = '{}' where id = '00000000-0000-4000-8000-0000000079b2';
    raise exception 'ÉCHEC: carte manual sans tag acceptée';
  exception when check_violation then
    ok := ok || E'\nOK: carte manual sans tag refusée (' || sqlstate || ')';
  end;

  -- 8. Colonnes interdites sur une carte vault.
  begin
    update public.cards set source = 'manual' where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: update de source accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: vault : update de source refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set id = '00000000-0000-4000-8000-0000000079ff' where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: update de id accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: vault : update de id refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set source_path = 'x', deck = 'x' where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: update de source_path/deck accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: vault : update de source_path/deck refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set source_title = 'x' where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: update de source_title accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: vault : update de source_title refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set inbox_id = null where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: update de inbox_id accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: vault : update de inbox_id refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set updated_at = now() where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: update de updated_at accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: vault : update de updated_at refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set status = 'draft' where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: carte vault passée en brouillon';
  exception when check_violation then
    ok := ok || E'\nOK: vault : passage en brouillon refusé (' || sqlstate || ')';
  end;

  -- 9. Suppression douce d'une carte vault permise ; aucune suppression physique ; aucune insertion vault.
  update public.cards set deleted_at = now() where id = '00000000-0000-4000-8000-0000000079a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: suppression douce vault : % ligne(s)', n; end if;
  ok := ok || E'\nOK: suppression douce (deleted_at) d''une carte vault';
  begin
    delete from public.cards where id = '00000000-0000-4000-8000-0000000079a1';
    raise exception 'ÉCHEC: delete accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: delete physique refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000079d5', 'vault', '[sql-check] interdite', 'R', '{Culture}');
    raise exception 'ÉCHEC: insert vault accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert source=vault refusé (' || sqlstate || ')';
  end;

  -- 10. Restauration (#94) : une carte active restaurée crée ses noms absents de `tags` ; un brouillon restauré, non.
  update public.cards set deleted_at = null where id = '00000000-0000-4000-8000-0000000094e5';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: restauration d''une carte manual : % ligne(s)', n; end if;
  select count(*) into n from public.tags where name = '[sql-check] restauré';
  if n <> 1 then raise exception 'ÉCHEC: restauration d''une carte active : tag non créé'; end if;
  ok := ok || E'\nOK: restauration (deleted_at → null) d''une carte active : tag absent créé';
  update public.cards set deleted_at = null where id = '00000000-0000-4000-8000-0000000094e6';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: restauration d''un brouillon : % ligne(s)', n; end if;
  select count(*) into n from public.tags where lower(name) = '[sql-check] brouillon restauré';
  if n <> 0 then raise exception 'ÉCHEC: restauration d''un brouillon : tag créé'; end if;
  ok := ok || E'\nOK: restauration d''un brouillon : aucun tag créé';

  -- 11. Caractères de contrôle (C0 et C1) refusés côté serveur (#94), rien de créé.
  foreach v in array array[E'[sql-check] a\u0001b', E'[sql-check] a\u001fb', E'[sql-check] a\u007fb',
                           E'[sql-check] a\u0085b', E'[sql-check] a\u009fb'] loop
    begin
      update public.cards set tags = array[v] where id = '00000000-0000-4000-8000-0000000094e5';
      raise exception 'ÉCHEC: caractère de contrôle accepté (U+%)', to_hex(ascii(substr(v, 14, 1)));
    exception when check_violation then null;
    end;
  end loop;
  select count(*) into n from public.tags where name like '[sql-check] a_b';
  if n <> 0 then raise exception 'ÉCHEC: tag avec caractère de contrôle créé'; end if;
  ok := ok || E'\nOK: 5 noms avec caractère de contrôle (U+0001, U+001F, U+007F, U+0085, U+009F) refusés (23514)';

  -- 12. Normalisation par l'API : espaces Unicode de bord et internes, tabulation, séparateur de ligne.
  update public.cards set tags = array[E'\t[sql-check] n1\n', E'\u00a0[sql-check]\u3000\u2003n2\ufeff', E'[sql-check]\u2028n3']
  where id = '00000000-0000-4000-8000-0000000094e5';
  select tags into t from public.cards where id = '00000000-0000-4000-8000-0000000094e5';
  if t <> '{[sql-check] n1,[sql-check] n2,[sql-check] n3}'::text[] then raise exception 'ÉCHEC: tags normalisés = %', t; end if;
  ok := ok || E'\nOK: noms normalisés comme le client (espaces Unicode, tabulation, U+2028)';

  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare ok text := '';
begin
  if current_user <> 'anon' then raise exception 'ÉCHEC: rôle courant % au lieu de anon', current_user; end if;
  begin
    perform 1 from public.tags limit 1;
    raise exception 'ÉCHEC: anon lit tags';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon select tags refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.tags (name) values ('[sql-check] anon');
    raise exception 'ÉCHEC: anon crée un tag';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon insert tags refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set tags = '{Culture}' where id = '00000000-0000-4000-8000-0000000079b2';
    raise exception 'ÉCHEC: anon modifie les tags d''une carte';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon update cards refusé (' || sqlstate || ')';
  end;
  begin
    perform public.tag_name_normalize('x');
    raise exception 'ÉCHEC: anon exécute tag_name_normalize';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon execute tag_name_normalize refusé (' || sqlstate || ')';
  end;
  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Outil /flashcards (clé secrète) : lit le registre, ne l'écrit jamais directement ; ses tags sont créés par les
-- cartes actives qu'il écrit (vault), jamais par ses brouillons ; mêmes règles de nom que l'app.
do $$
declare
  n int;
  ok text := '';
begin
  if current_user <> 'service_role' then raise exception 'ÉCHEC: rôle courant % au lieu de service_role', current_user; end if;
  select count(*) into n from public.tags;
  if n < 8 then raise exception 'ÉCHEC: service_role lit % tag(s)', n; end if;
  ok := ok || E'\nOK: service_role lit la table tags';
  begin
    insert into public.tags (name) values ('[sql-check] outil direct');
    raise exception 'ÉCHEC: service_role insère dans tags';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: service_role insert direct dans tags refusé (' || sqlstate || ')';
  end;
  begin
    update public.tags set name = 'x' where name = 'Culture';
    raise exception 'ÉCHEC: service_role modifie tags';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: service_role update de tags refusé (' || sqlstate || ')';
  end;
  begin
    delete from public.tags where name = 'Culture';
    raise exception 'ÉCHEC: service_role supprime dans tags';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: service_role delete de tags refusé (' || sqlstate || ')';
  end;
  begin
    truncate public.tags;
    raise exception 'ÉCHEC: service_role vide tags';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: service_role truncate de tags refusé (' || sqlstate || ')';
  end;

  insert into public.cards (id, source, deck, source_path, front, back, tags)
  values ('00000000-0000-4000-8000-0000000094f7', 'vault', 'test', '3-Resources/test/y.md', '[sql-check] vault outil', 'R',
          array[E'  [sql-check]\u00a0outil ']);
  select count(*) into n from public.tags where name = '[sql-check] outil';
  if n <> 1 then raise exception 'ÉCHEC: carte vault de l''outil : tag non créé'; end if;
  ok := ok || E'\nOK: service_role crée un tag via une carte vault active (nom normalisé)';
  insert into public.cards (id, source, status, source_title, front, back, tags)
  values ('00000000-0000-4000-8000-0000000094f8', 'inbox', 'draft', 'Doc', '[sql-check] brouillon outil', 'R', '{[sql-check] outil brouillon}');
  select count(*) into n from public.tags where name = '[sql-check] outil brouillon';
  if n <> 0 then raise exception 'ÉCHEC: brouillon de l''outil : tag créé'; end if;
  ok := ok || E'\nOK: service_role : un brouillon inbox ne crée aucun tag';
  begin
    update public.cards set tags = array[E'[sql-check] a\u0002b'] where id = '00000000-0000-4000-8000-0000000094f7';
    raise exception 'ÉCHEC: service_role : caractère de contrôle accepté';
  exception when check_violation then
    ok := ok || E'\nOK: service_role : caractère de contrôle refusé (' || sqlstate || ')';
  end;
  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

reset role;

select line as resultat from regexp_split_to_table(current_setting('vc.log'), E'\n') as line where line <> '';

rollback;
