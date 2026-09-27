# CETEP — Déploiement Render

## URLs publiques
- Accueil: `/`
- Connexion: `/login`
- Administration: `/admin` ou `/administration`
- Étudiant: `/student` ou `/etudiant`
- Professeur: `/teacher` ou `/professeur`
- Santé: `/health`

## Variables d'environnement recommandées
- `JWT_SECRET` : une longue valeur secrète
- `ADMIN_EMAIL` : email de l'administrateur
- `ADMIN_PASSWORD` : mot de passe initial (utilisé seulement à la création du premier admin)
- `FORCE_ADMIN_RESET` : laisser `false`/absent; mettre `true` uniquement pour réinitialiser explicitement l'admin
- `DATA_DIR` : chemin vers un stockage persistant si le service Render dispose d'un Persistent Disk

## Important — données
Le projet utilise SQLite. Sans stockage persistant monté sur `DATA_DIR`, les données locales peuvent être perdues lors d'un redeploy/restart du service. Pour une utilisation réelle avec des données importantes, utiliser un stockage persistant ou migrer vers PostgreSQL.
