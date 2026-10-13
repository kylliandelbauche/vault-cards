-- Tags thématiques (#26) : 0 à 2 slugs par carte, pris dans la liste fixe de shared/tags.ts.
-- Les grants existants suffisent (service_role update, authenticated select).

alter table public.cards add column tags text[] not null default '{}';

alter table public.cards add constraint cards_tags_check check (
  cardinality(tags) between 0 and 2
  and tags <@ array['ia', 'dev', 'securite', 'marketing', 'argent', 'mental', 'productivite', 'culture']::text[]
);

-- Pour le futur filtre par tag (opérateurs @> / &&).
create index cards_tags_idx on public.cards using gin (tags);
