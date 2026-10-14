-- Cartes créées à la main dans l'app (#54).
-- `source` distingue les cartes générées depuis le vault (outil local, clé secrète) des cartes saisies
-- dans l'app (rôle authenticated, sous RLS). L'outil /flashcards ne lit et n'écrit que source = 'vault'.

alter table public.cards add column source text not null default 'vault';
alter table public.cards add constraint cards_source_check check (source in ('vault', 'manual'));

-- deck et source_path n'ont de sens que pour une note du vault : nullables, mais obligatoires pour 'vault'.
alter table public.cards alter column deck drop not null, alter column source_path drop not null;
alter table public.cards add constraint cards_vault_origin_check check (
  source <> 'vault' or (deck is not null and source_path is not null)
);
-- Carte manuelle : aucune note d'origine, et 1 à 2 tags (la contrainte cards_tags_check, 0 à 2 tags de la liste
-- fixe, reste en place pour toutes les cartes ; les longueurs front 1–500 / back 1–1500 aussi).
alter table public.cards add constraint cards_manual_shape_check check (
  source <> 'manual' or (deck is null and source_path is null and source_title is null and cardinality(tags) >= 1)
);

-- Droits de l'app (authenticated), par colonne : elle ne peut écrire que le contenu d'une carte manuelle.
-- Insertion : id (UUID client, envoi idempotent), source, front, back, tags, deleted_at (carte créée puis
-- supprimée hors ligne avant le premier envoi). Jamais deck, source_path, source_title, created_at, updated_at.
grant insert (id, source, front, back, tags, deleted_at) on public.cards to authenticated;
-- Modification : édition (front, back, tags) et suppression douce (deleted_at). Ni id ni source ;
-- updated_at reste posé par le trigger cards_set_updated_at. Aucun delete physique.
grant update (front, back, tags, deleted_at) on public.cards to authenticated;

create policy "authenticated insert manual cards" on public.cards
  for insert to authenticated with check (source = 'manual');
-- Une carte vault est invisible pour l'update (0 ligne modifiée), et une carte manuelle le reste.
create policy "authenticated update manual cards" on public.cards
  for update to authenticated using (source = 'manual') with check (source = 'manual');

-- Aucun droit pour anon (rien n'est accordé à anon dans ce fichier ni dans les précédents).
