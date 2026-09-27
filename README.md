# CETEP — Version finale
Centre d'Encadrement Technique et Professionnel.

Fonctions: site public, admissions, dashboard administration, étudiants, professeurs, formations, modules/leçons, paiements, identité et couleurs modifiables, changement de logo par URL ou téléversement.

Variables Render: ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET. Pour une conservation durable des données scolaires, utiliser une base persistante PostgreSQL/Supabase ou un stockage persistant.


## Persistence on Render
This final build stores SQLite and uploaded logo data under `/app/data`. The included `render.yaml` attaches a 1 GB persistent disk to that path on a paid Starter web service, so students, formations, payments, settings, and uploaded logos survive deploys/restarts. Render Free web services have ephemeral filesystems, so do not deploy this persistence setup on the Free plan if you need the data to survive.
