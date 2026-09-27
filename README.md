# CETEP Plateforme v10

Plateforme de gestion et formation en ligne pour le Centre d'Encadrement Technique et Professionnel.

## Fonctions
- Administration: étudiants, professeurs, formations, modules, leçons, paiements.
- Logo, identité et couleurs modifiables depuis le dashboard.
- Espace professeur: créer modules et cours online, publier liens vidéo/documents.
- Espace étudiant: consulter les cours et suivre la progression.
- Soutien CETEP: MonCash, Natcash, Zelle, Cash App et compte bancaire modifiables depuis l'administration.
- Dons/soutiens enregistrés.
- Sauvegarde JSON téléchargeable et restauration.
- SQLite stocké dans `DATA_DIR`.

## Render
Le `render.yaml` attache un persistent disk à `/app/data`. Render précise que le filesystem normal est éphémère et qu'un persistent disk est nécessaire pour conserver des fichiers locaux; les disques persistants sont disponibles sur les web services payants. Voir https://render.com/docs/disks.

Variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, `DATA_DIR=/app/data`.
