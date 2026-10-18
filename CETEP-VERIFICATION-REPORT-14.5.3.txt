CETEP — RAPPORT DE VÉRIFICATION v14.6.3
Date: 2026-10-11
Statut: APERÇU DE CORRECTIONS — NE PAS DÉPLOYER

CORRECTIONS APPLIQUÉES
1. Les admissions publiques n'utilisent plus le numéro étudiant comme mot de passe.
2. La création d'un étudiant ou d'un professeur n'utilise plus 123456 par défaut.
3. Si l'administrateur laisse le mot de passe vide, un mot de passe temporaire aléatoire est généré et retourné une seule fois à l'interface administrateur.
4. Les mots de passe saisis manuellement doivent contenir au moins 12 caractères.
5. L'accès global d'un étudiant ne peut pas activer automatiquement toutes ses inscriptions. Chaque formation doit être autorisée séparément.
6. La connexion étudiant exige l'activation du compte et au moins une inscription active autorisée.
7. Les points d'entrée de paiement refusent les montants nuls ou négatifs.
8. Le numéro de version de l'application et de package.json est aligné sur 14.6.3.

TESTS RÉUSSIS
- node --check server.js: réussi
- node --check admin.js: réussi
- node --check app.js: réussi
- test-cetep-static.js: 21/21 contrôles statiques réussis
- Scripts JavaScript intégrés aux 7 fichiers HTML: 7/7 analysés sans erreur
- Test SQLite indépendant: schéma SQL exécutable; un étudiant peut s'inscrire à deux formations différentes; doublon dans une même formation rejeté (3/3).

LIMITES IMPORTANTES
- npm install a dépassé le délai d'exécution de l'environnement. Les dépendances n'ont pas été installées.
- L'application n'a donc pas pu être démarrée dans ce conteneur; les routes HTTP n'ont pas été testées en direct.
- Connexion à Neon non testée; aucune DATABASE_URL n'a été configurée et aucune modification n'a été faite à Neon.
- La persistance après redémarrage/re-déploiement Render n'a pas été testée sur le service réel.
- Paiements, émission PDF des certificats, emails et accès professeur n'ont pas été validés par tests d'intégration.
- Ce paquet ne contient pas une migration vers Neon; le projet reste sur SQLite et dépend du montage d'un disque persistant Render pour conserver le fichier SQLite.

CONSIGNE
Ne pas déployer cette version. Conserver la version actuellement en ligne. Avant déploiement, installer les dépendances dans un environnement Node fonctionnel, tester les routes et les scénarios multi-inscription/paiement/accès/certificat, puis confirmer le montage de DATA_DIR=/app/data sur le service Render réel et réaliser une sauvegarde.
