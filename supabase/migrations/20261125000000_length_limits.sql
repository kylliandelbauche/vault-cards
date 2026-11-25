-- Bornes de longueur sur les colonnes écrites par l'outil local (#52, relevé par l'audit #7).
-- front, back et source_title sont déjà bornés ; deck, source_path et content_hash ne l'étaient pas.
-- Ces colonnes ne sont écrites que par l'outil (`tools/cards`, service_role) : aucun grant ni policy ne change.
--
-- - deck : un seul deck aujourd'hui (DECK = « Second cerveau ») ; 1 à 100 caractères laisse de la marge aux anciens decks.
-- - source_path : chemin relatif au vault, même borne sur cards et sur notes (même valeur, clé de jointure) ;
--   1 à 500 caractères couvre un nom de fichier de 255 caractères sous le dossier des synthèses.
-- - content_hash : toujours un SHA-256 hexadécimal (hashContent) ou le marqueur « removed » (REMOVED_HASH) :
--   le format exact est vérifié, ce qui borne aussi la longueur (64 ou 7 caractères).
--
-- Les lignes existantes sont vérifiées à l'ajout des contraintes : la migration échoue (et rien n'est appliqué)
-- si une valeur en base sort de ces bornes.

alter table public.cards add constraint cards_deck_length_check check (
  deck is null or char_length(deck) between 1 and 100
);

alter table public.cards add constraint cards_source_path_length_check check (
  source_path is null or char_length(source_path) between 1 and 500
);

alter table public.notes add constraint notes_source_path_length_check check (
  char_length(source_path) between 1 and 500
);

alter table public.notes add constraint notes_content_hash_check check (
  content_hash = 'removed' or content_hash ~ '^[0-9a-f]{64}$'
);
