-- Preuve des bornes de longueur (#52) sur la vraie base, sans trace : tout se passe dans une transaction annulée par le
-- `rollback` final. Lancer : supabase db query --linked -f supabase/tests/length_limits.sql
-- Résultat binaire : la liste des « OK: … » si tout est conforme, sinon une erreur « ÉCHEC: … » (transaction annulée).
-- Code attendu : 23514 = contrainte check. Les écritures passent par service_role, le seul rôle qui écrit ces colonnes.

begin;

select set_config('vc.log', '', true);

-- Rôle de l'outil local (clé secrète), tel que PostgREST le pose.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
  n int;
  ok text := '';
  hash64 text := repeat('a1', 32);
  path500 text := '[sql-check]/' || repeat('p', 485) || '.md';
begin
  if current_user <> 'service_role' then raise exception 'ÉCHEC: rôle courant % au lieu de service_role', current_user; end if;
  if char_length(path500) <> 500 then raise exception 'ÉCHEC: chemin de test de % caractères au lieu de 500', char_length(path500); end if;

  -- 1. Valeurs aux bornes acceptées (carte vault et note).
  insert into public.cards (id, source, deck, source_path, front, back, tags)
  values ('00000000-0000-4000-8000-0000000052a1', 'vault', repeat('d', 100), path500, '[sql-check] bornes', 'R', '{IA & agents}');
  insert into public.notes (source_path, content_hash) values (path500, hash64);
  insert into public.notes (source_path, content_hash) values ('[sql-check]/supprimée.md', 'removed');
  select count(*) into n from public.notes where source_path in (path500, '[sql-check]/supprimée.md');
  if n <> 2 then raise exception 'ÉCHEC: % note(s) aux bornes insérée(s) sur 2', n; end if;
  ok := ok || E'\nOK: deck de 100 et source_path de 500 caractères acceptés (cards, notes)'
            || E'\nOK: content_hash SHA-256 hexadécimal et « removed » acceptés';

  -- 2. cards.deck : vide ou 101 caractères refusés.
  begin
    insert into public.cards (id, source, deck, source_path, front, back, tags)
    values ('00000000-0000-4000-8000-0000000052b2', 'vault', repeat('d', 101), '[sql-check]/x.md', '[sql-check] deck', 'R', '{IA & agents}');
    raise exception 'ÉCHEC: deck de 101 caractères accepté';
  exception when check_violation then
    ok := ok || E'\nOK: deck de 101 caractères refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set deck = '' where id = '00000000-0000-4000-8000-0000000052a1';
    raise exception 'ÉCHEC: deck vide accepté';
  exception when check_violation then
    ok := ok || E'\nOK: deck vide refusé (' || sqlstate || ')';
  end;

  -- 3. source_path : vide ou 501 caractères refusés, sur cards comme sur notes.
  begin
    update public.cards set source_path = path500 || 'x' where id = '00000000-0000-4000-8000-0000000052a1';
    raise exception 'ÉCHEC: cards.source_path de 501 caractères accepté';
  exception when check_violation then
    ok := ok || E'\nOK: cards.source_path de 501 caractères refusé (' || sqlstate || ')';
  end;
  begin
    update public.cards set source_path = '' where id = '00000000-0000-4000-8000-0000000052a1';
    raise exception 'ÉCHEC: cards.source_path vide accepté';
  exception when check_violation then
    ok := ok || E'\nOK: cards.source_path vide refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.notes (source_path, content_hash) values (path500 || 'x', hash64);
    raise exception 'ÉCHEC: notes.source_path de 501 caractères accepté';
  exception when check_violation then
    ok := ok || E'\nOK: notes.source_path de 501 caractères refusé (' || sqlstate || ')';
  end;
  begin
    insert into public.notes (source_path, content_hash) values ('', hash64);
    raise exception 'ÉCHEC: notes.source_path vide accepté';
  exception when check_violation then
    ok := ok || E'\nOK: notes.source_path vide refusé (' || sqlstate || ')';
  end;

  -- 4. notes.content_hash : tout autre format refusé (trop court, trop long, majuscules, vide, texte libre).
  begin
    update public.notes set content_hash = left(hash64, 63) where source_path = path500;
    raise exception 'ÉCHEC: content_hash de 63 caractères accepté';
  exception when check_violation then
    ok := ok || E'\nOK: content_hash de 63 caractères refusé (' || sqlstate || ')';
  end;
  begin
    update public.notes set content_hash = hash64 || 'a' where source_path = path500;
    raise exception 'ÉCHEC: content_hash de 65 caractères accepté';
  exception when check_violation then
    ok := ok || E'\nOK: content_hash de 65 caractères refusé (' || sqlstate || ')';
  end;
  begin
    update public.notes set content_hash = upper(hash64) where source_path = path500;
    raise exception 'ÉCHEC: content_hash en majuscules accepté';
  exception when check_violation then
    ok := ok || E'\nOK: content_hash en majuscules refusé (' || sqlstate || ')';
  end;
  begin
    update public.notes set content_hash = '' where source_path = path500;
    raise exception 'ÉCHEC: content_hash vide accepté';
  exception when check_violation then
    ok := ok || E'\nOK: content_hash vide refusé (' || sqlstate || ')';
  end;
  begin
    update public.notes set content_hash = repeat('x', 10000) where source_path = path500;
    raise exception 'ÉCHEC: content_hash de texte libre accepté';
  exception when check_violation then
    ok := ok || E'\nOK: content_hash de texte libre refusé (' || sqlstate || ')';
  end;

  -- 5. Une carte manuelle (deck et source_path nuls) reste valide.
  insert into public.cards (id, source, front, back, tags)
  values ('00000000-0000-4000-8000-0000000052c3', 'manual', '[sql-check] manuelle', 'R', '{Culture}');
  ok := ok || E'\nOK: carte manuelle sans deck ni source_path toujours acceptée';

  perform set_config('vc.log', current_setting('vc.log') || ok, true);
end $$;

reset role;

select line as resultat from regexp_split_to_table(current_setting('vc.log'), E'\n') as line where line <> '';

rollback;
