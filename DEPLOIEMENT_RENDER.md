# Mise en ligne CETEP — Render

## Ce que vous avez déjà
Le dossier contient le site public, l'administration, la base SQLite locale, le login administrateur et la préparation serveur.

## Mise en ligne
1. Créer un compte Render.
2. Créer un nouveau Web Service depuis le dépôt GitHub contenant ce dossier.
3. Choisir Docker comme environnement (le fichier `Dockerfile` est déjà fourni).
4. Ajouter les variables d'environnement :
   - `ADMIN_EMAIL` = votre email administrateur
   - `ADMIN_PASSWORD` = un mot de passe fort
   - `JWT_SECRET` = une longue clé aléatoire (Render peut la générer si vous utilisez `render.yaml`)
5. Déployer.
6. Tester `https://VOTRE-SOUS-DOMAINE.onrender.com/health`.
7. Ouvrir `https://VOTRE-SOUS-DOMAINE.onrender.com/admin` pour l'administration.

## Important sur la base de données
Cette V5 conserve SQLite dans le serveur. Pour une vraie production avec des données importantes, il faut migrer vers PostgreSQL/Supabase et utiliser un stockage persistant. Un service gratuit qui redémarre sans disque persistant peut perdre la base SQLite.

## Paiements
Les paiements MonCash/NatCash/banque ne sont pas encore branchés. Les identifiants marchands ne doivent jamais être placés dans les fichiers publics. Il faudra ajouter les API officielles et les webhooks de confirmation côté serveur.

## Domaine
Le sous-domaine fourni par l'hébergeur peut servir gratuitement. Pour un domaine personnalisé comme `cetep.ht` ou `www.cetep.ht`, il faut enregistrer le domaine et configurer DNS.
