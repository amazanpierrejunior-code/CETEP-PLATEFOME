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
Le projet utilise SQLite. Le mode CETEP Local garde une copie locale des données et la synchronisation complète peut recopier les données Online vers l'ordinateur. Côté Render, SQLite n'est persistant que si `DATA_DIR` est monté sur un Persistent Disk; sur un Web Service Free sans disque persistant, une copie externe ou PostgreSQL reste nécessaire.


## Notifications email CETEP
Pour recevoir automatiquement un email à `cetepecoleprofessionnelle@gmail.com` lorsqu’une inscription en ligne ou un paiement est envoyé, configurez ces variables d’environnement dans Render :

- `CETEP_NOTIFICATION_EMAIL` = `cetepecoleprofessionnelle@gmail.com`
- `SMTP_HOST` = `smtp.gmail.com`
- `SMTP_PORT` = `465`
- `SMTP_SECURE` = `true`
- `SMTP_USER` = `cetepecoleprofessionnelle@gmail.com`
- `SMTP_FROM` = `cetepecoleprofessionnelle@gmail.com`
- `SMTP_PASS` = **mot de passe d’application Gmail** du compte CETEP (pas le mot de passe normal).

Sans `SMTP_PASS`, le site continue à accepter les inscriptions/paiements, mais l’email ne sera pas envoyé.


### Email de confirmation
Quand une inscription est validée/activée, CETEP envoie une confirmation à l’adresse email de l’étudiant. SMTP_PASS doit être configuré.
