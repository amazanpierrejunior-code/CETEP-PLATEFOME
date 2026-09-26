# CETEP V7 FINAL

Plateforme de gestion et de formation en ligne pour le Centre d’Encadrement Technique et Professionnel.

## Fonctions
- Administration complète
- Ajout/modification d’étudiants avec code CETEP automatique
- Activation/suspension et réinitialisation des accès étudiants
- Gestion des professeurs et affectation aux formations
- Création/modification de formations
- Modules, leçons, vidéos, PDF et devoirs
- Paiements
- Personnalisation du nom, slogan, logo et couleurs du Dashboard
- Espaces Admin, Étudiant et Professeur

## Render
Conservez ces variables d’environnement :
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `JWT_SECRET`

Pour conserver SQLite après redémarrage/redeploy, utilisez un stockage persistant compatible avec votre offre Render et définissez `DATA_DIR=/data`.

## Déploiement
Le dépôt doit contenir les fichiers du projet à la racine (`package.json`, `server.js`, `Dockerfile`, HTML, CSS), pas seulement le fichier ZIP.
