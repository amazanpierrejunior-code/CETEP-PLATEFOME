# CETEP — Plateforme V5

**Centre d’Encadrement Technique et Professionnel (CETEP)**

Plateforme web avec site public, admissions, espace administration, gestion des formations, étudiants, paiements manuels et boutons modifiables.

## Démarrage local
- Node.js 20+
- `npm install`
- copier `.env.example` vers `.env`
- définir `ADMIN_EMAIL`, `ADMIN_PASSWORD` et `JWT_SECRET`
- `npm start`
- site: `http://localhost:3000`
- admin: `http://localhost:3000/admin`

## Déploiement
Voir `DEPLOIEMENT_RENDER.md` et `Dockerfile`.

## Production
Pour des données scolaires réelles, migrer SQLite vers PostgreSQL/Supabase avec sauvegardes et stockage persistant. Pour les paiements, intégrer uniquement les API officielles MonCash/NatCash/banque avec secrets côté serveur et vérification des webhooks.
