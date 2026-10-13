-- Titre de la source (#35) : H1 de la note, affiché sur la carte à la place du chemin local.
-- Nullable : les cartes déjà en base sont remplies ensuite par `tools/cards titles` ; l'app se replie sur le nom de fichier.
-- Les grants existants suffisent (service_role update, authenticated select).

alter table public.cards add column source_title text;

alter table public.cards add constraint cards_source_title_check check (
  source_title is null or char_length(source_title) between 1 and 200
);
