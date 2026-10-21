-- Preuve des droits sur public.cards (#54), sur la vraie base, sans trace : tout se passe dans une transaction
-- annulée par le `rollback` final (aucune ligne écrite ne survit, même en cas d'échec).
-- Lancer : supabase db query --linked -f supabase/tests/manual_cards.sql
-- Résultat binaire : la liste des « OK: … » si tout est conforme, sinon une erreur « ÉCHEC: … » (transaction annulée).
-- Chaque attente vérifie le code SQLSTATE précis : 42501 = droit refusé (privilège ou RLS), 23514 = contrainte check.

begin;

-- Journal des vérifications réussies : un paramètre de session local à la transaction (indépendant du rôle courant).
select set_config('vc.log', '', true);

-- Données de test (rôle propriétaire : RLS non appliquée). Ids fixes, hors de toute plage réelle (UUID v4 aléatoires).
insert into public.cards (id, source, deck, source_path, front, back, tags)
values ('00000000-0000-4000-8000-0000000000a1', 'vault', 'test', '3-Resources/veille/test/x-synthese.md', '[sql-check] vault', 'R', '{IA & agents}');
-- Carte manuelle « ancienne » : updated_at forcé dans le passé pour prouver que le trigger le rafraîchit.
insert into public.cards (id, source, front, back, tags, updated_at)
values ('00000000-0000-4000-8000-0000000000b2', 'manual', '[sql-check] ancienne', 'R', '{Dev & outils}', '2000-01-01T00:00:00Z');

-- Rôle de l'app connectée, tel que PostgREST le pose.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}';

do $$
declare
  n int;
  ok text := '';
begin
  if current_user <> 'authenticated' then raise exception 'ÉCHEC: rôle courant % au lieu de authenticated', current_user; end if;

  -- 1. Insertion d'une carte manuelle (id client, colonnes autorisées).
  insert into public.cards (id, source, front, back, tags)
  values ('00000000-0000-4000-8000-0000000000c3', 'manual', '[sql-check] question', 'réponse', '{IA & agents,Dev & outils}');
  select count(*) into n from public.cards
  where id = '00000000-0000-4000-8000-0000000000c3' and source = 'manual' and deck is null and source_path is null;
  if n <> 1 then raise exception 'ÉCHEC: carte manuelle non insérée'; end if;
  ok := ok || E'\nOK: authenticated insère une carte manual (id client, deck/source_path nuls)';

  -- 1 bis. Envoi rejoué (réponse perdue) : la requête de l'app, INSERT … ON CONFLICT (id) DO NOTHING, ne crée
  -- pas de doublon et ne lève pas d'erreur ; RETURNING ne renvoie que les lignes réellement insérées.
  with ins as (
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000c3', 'manual', '[sql-check] rejouée', 'réponse', '{IA & agents}')
    on conflict (id) do nothing
    returning id
  ) select count(*) into n from ins;
  if n <> 0 then raise exception 'ÉCHEC: envoi rejoué a inséré % ligne(s)', n; end if;
  select count(*) into n from public.cards where id = '00000000-0000-4000-8000-0000000000c3' and front = '[sql-check] question';
  if n <> 1 then raise exception 'ÉCHEC: envoi rejoué a modifié la carte'; end if;
  ok := ok || E'\nOK: envoi rejoué (on conflict do nothing) : 0 ligne insérée, pas de doublon, pas d''erreur';

  -- 2. Insertion d'une carte vault : refusée par la policy RLS (with check source = ''manual'').
  begin
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000d4', 'vault', '[sql-check] interdite', 'R', '{IA & agents}');
    raise exception 'ÉCHEC: insert vault accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert source=vault refusé (' || sqlstate || ' ' || sqlerrm || ')';
  end;

  -- 3. Insertion sans source explicite (défaut vault) : refusée aussi.
  begin
    insert into public.cards (id, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000d5', '[sql-check] interdite', 'R', '{IA & agents}');
    raise exception 'ÉCHEC: insert sans source accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert sans source (défaut vault) refusé (' || sqlstate || ')';
  end;

  -- 4. Colonnes réservées à l'outil (deck, source_path, source_title, updated_at) : aucun droit d'insertion.
  begin
    insert into public.cards (id, source, deck, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000d6', 'manual', 'x', '[sql-check] interdite', 'R', '{IA & agents}');
    raise exception 'ÉCHEC: insert avec deck accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert de la colonne deck refusé (' || sqlstate || ' ' || sqlerrm || ')';
  end;
  begin
    insert into public.cards (id, source, front, back, tags, updated_at)
    values ('00000000-0000-4000-8000-0000000000d7', 'manual', '[sql-check] interdite', 'R', '{IA & agents}', now());
    raise exception 'ÉCHEC: insert avec updated_at accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: insert de la colonne updated_at refusé (' || sqlstate || ')';
  end;

  -- 5. Contraintes : 1 à 5 tags, longueurs.
  begin
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000d8', 'manual', '[sql-check] sans tag', 'R', '{}');
    raise exception 'ÉCHEC: carte manuelle sans tag acceptée';
  exception when check_violation then
    ok := ok || E'\nOK: carte manual sans tag refusée (' || sqlstate || ')';
  end;
  -- Tags libres (#79) : plus de liste fixe, mais 5 tags au plus.
  begin
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000d9', 'manual', '[sql-check] 6 tags', 'R', '{a1,a2,a3,a4,a5,a6}');
    raise exception 'ÉCHEC: 6 tags acceptés';
  exception when check_violation then
    ok := ok || E'\nOK: plus de 5 tags refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000da', 'manual', repeat('x', 501), 'R', '{IA & agents}');
    raise exception 'ÉCHEC: question de 501 caractères acceptée';
  exception when check_violation then
    ok := ok || E'\nOK: question > 500 caractères refusée (' || sqlstate || ')';
  end;

  -- 6. Édition d'une carte manuelle : front, back, tags ; le trigger rafraîchit updated_at.
  update public.cards set front = '[sql-check] modifiée', back = 'nouvelle', tags = '{Culture}'
  where id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: édition de la carte manual : % ligne(s)', n; end if;
  select count(*) into n from public.cards
  where id = '00000000-0000-4000-8000-0000000000b2' and front = '[sql-check] modifiée' and tags = '{Culture}' and updated_at = now();
  if n <> 1 then raise exception 'ÉCHEC: édition non appliquée ou updated_at non rafraîchi'; end if;
  ok := ok || E'\nOK: update front/back/tags d''une carte manual (1 ligne, updated_at rafraîchi par le trigger)';

  -- 7. Suppression douce d'une carte manuelle.
  update public.cards set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: suppression douce : % ligne(s)', n; end if;
  ok := ok || E'\nOK: suppression douce (deleted_at) d''une carte manual';

  -- 8. Carte vault : modifiable depuis #79 (décision #73) sur front, back, tags, deleted_at seulement (colonnes
  --    interdites : supabase/tests/tags.sql). Le contenu est réellement modifié.
  update public.cards set front = '[sql-check] vault retouchée' where id = '00000000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC: update d''une carte vault : % ligne(s)', n; end if;
  select count(*) into n from public.cards
  where id = '00000000-0000-4000-8000-0000000000a1' and front = '[sql-check] vault retouchée' and source = 'vault';
  if n <> 1 then raise exception 'ÉCHEC: carte vault non modifiée'; end if;
  ok := ok || E'\nOK: update front d''une carte vault (1 ligne, #73), source inchangée';

  -- 9. Colonnes interdites en update : source, id, deck, source_path, source_title, updated_at.
  begin
    update public.cards set source = 'vault' where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'ÉCHEC: update de source accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update de la colonne source refusé (' || sqlstate || ' ' || sqlerrm || ')';
  end;
  begin
    update public.cards set id = '00000000-0000-4000-8000-0000000000ee' where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'ÉCHEC: update de id accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update de la colonne id refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set source_path = 'x', deck = 'x' where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'ÉCHEC: update de source_path/deck accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update des colonnes source_path/deck refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set updated_at = now() where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'ÉCHEC: update de updated_at accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: update de la colonne updated_at refusé (' || sqlstate || ')';
  end;

  -- 10. Aucune suppression physique, ni manual ni vault.
  begin
    delete from public.cards where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'ÉCHEC: delete accepté';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: delete refusé (' || sqlstate || ' ' || sqlerrm || ')';
  end;

  -- 11. Une review sur la carte manuelle passe (clé étrangère satisfaite une fois la carte insérée).
  insert into public.reviews (id, card_id, rating, reviewed_at)
  values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b2', 3, now());
  ok := ok || E'\nOK: review sur une carte manual acceptée (FK reviews.card_id)';

  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

-- Rôle anonyme (clé publishable sans session) : tout est refusé.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  ok text := '';
begin
  if current_user <> 'anon' then raise exception 'ÉCHEC: rôle courant % au lieu de anon', current_user; end if;
  begin
    perform 1 from public.cards limit 1;
    raise exception 'ÉCHEC: anon lit cards';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon select cards refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.cards (id, source, front, back, tags)
    values ('00000000-0000-4000-8000-0000000000e1', 'manual', '[sql-check] anon', 'R', '{IA & agents}');
    raise exception 'ÉCHEC: anon insère une carte';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon insert cards refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set front = 'x' where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'ÉCHEC: anon modifie une carte';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon update cards refusé (' || sqlstate || ')';
  end;
  begin
    delete from public.cards where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'ÉCHEC: anon supprime une carte';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon delete cards refusé (' || sqlstate || ')';
  end;
  begin
    perform 1 from public.reviews limit 1;
    raise exception 'ÉCHEC: anon lit reviews';
  exception when insufficient_privilege then
    ok := ok || E'\nOK: anon select reviews refusé (' || sqlstate || ')';
  end;
  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

reset role;

-- Rapport (dernière requête qui renvoie des lignes), puis annulation de tout ce qui précède.
select line as resultat from regexp_split_to_table(current_setting('vc.log'), E'\n') as line where line <> '';

rollback;
