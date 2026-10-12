-- Durcissement (#17)

-- rls_auto_enable() est la fonction de l'event trigger « ensure_rls » (Enable automatic RLS).
-- Le trigger s'exécute avec les droits de son propriétaire (postgres, aussi propriétaire de la fonction) :
-- aucun autre rôle n'a besoin d'EXECUTE, et la fonction ne doit pas être appelable via l'API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- reviews est un journal en ajout seul : l'outil local lit et insère, ne modifie jamais.
revoke update, delete on public.reviews from service_role;
