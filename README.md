# CETEP Plateforme v10.1 FINAL

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

## Correctifs v10.1
- Correctif du démarrage SQLite pour la méthode Compte bancaire.
- CMD Docker direct `node server.js` pour une gestion correcte des signaux Render.
- `/health` retourne la version 10.1.0.

## Persistance Render
Le mode SQLite conserve les données dans `DATA_DIR`. Pour conserver ces données entre redéploiements, utilisez un persistent disk Render (service payant) ou migrez vers une base de données managée. Render indique que le filesystem des services est éphémère par défaut.


## CETEP 11.3.0 — Fonctions finales
- Certificats de réussite PDF avec numéro unique.
- Délivrance automatique après réussite + 100% des leçons publiées + paiement complet.
- Vérification publique: `/certificat/CERT-AAAA-00001`.
- Espace étudiant: téléchargement du certificat.
- Résultats finaux avec seuil de réussite configurable.
- Cours en ligne: vidéo, PDF, lien Zoom/Google Meet, date/heure et durée.
- Progression des leçons conservée en base de données.
- Sauvegarde/restauration inclut les résultats, certificats, présences et annonces.


## CETEP 12.0.0 — Catalogue du flyer
Les formations déjà présentes sont conservées. Le démarrage ajoute uniquement les formations manquantes du flyer du 7e anniversaire si elles n'existent pas déjà : Sérigraphie (3 mois), Secourisme et Aide-soignant (9 mois), Vidéographie et Photographie (4 mois), Anglais/ Espagnol (9 mois), Onglerie/Cosmétologie/Make-up (3 à 6 mois), Décoration événementielle/Résine (3 à 6 mois), Carrelage/Plomberie/Électricité (4 à 6 mois), Informatique bureautique (6 mois), Dread Locks (2 mois). Aucun enregistrement existant n'est supprimé ou remplacé.
