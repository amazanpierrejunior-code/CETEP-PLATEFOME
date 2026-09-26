# CETEP Plateforme V6

Centre d'Encadrement Technique et Professionnel.

## Modules

- Administration
- Professeurs
- Étudiants
- Formations
- Modules et leçons
- Suivi de progression
- Devoirs et notes
- Paiements
- Activation / suspension / archivage des étudiants
- Séparation des droits par rôle

## Déploiement Render

Variables d'environnement:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `DATA_DIR` (optionnel, recommandé `/data` si un Persistent Disk Render est monté)

Le serveur utilise `PORT` fourni automatiquement par Render.

## Important

Pour conserver SQLite après un redéploiement/restart Render, monter un Persistent Disk et définir `DATA_DIR=/data`.
