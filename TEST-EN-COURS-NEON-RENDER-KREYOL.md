# CETEP v14.6.4 — PAKÈ TÈS STAGING (PA POU PWODIKSYON)

**Objektif:** teste yon kopi separe CETEP ak yon pwojè Neon apa, san manyen sit CETEP aktyèl la, branch `main`, oswa baz done pwodiksyon an.

## Sa pakè sa a ye
- Se yon kandida tès pou verifye depo done yo ak Neon.
- Li sèvi ak SQLite kòm baz done aplikasyon an epi li konsève yon snapshot JSONB sou Neon. **Sa poko yon migrasyon natif konplè pou PostgreSQL.**
- Tès lokal ki deja pase yo se tès sentaks, tès estatik ak simulation offline. Yo pa pwouve koneksyon Neon/Render reyèl la mache.
- Pa sèvi ak pakè sa a pou ranplase sit aktyèl la.

## Etap 1 — Pwoteje sit aktyèl la
1. Pa modifye branch GitHub `main` la.
2. Pa chwazi sèvis Render CETEP ki deja la pou nouvo tès la.
3. Pa sèvi ak `DATABASE_URL` pwojè Neon aktyèl/pwodiksyon an.
4. Pa efase okenn fichye oswa baz done ki deja egziste.

## Etap 2 — Kreye yon Neon tès apa
1. Antre nan Neon epi kreye **yon nouvo pwojè apa**, pa yon branch ki soti nan baz done pwodiksyon an.
2. Bay li yon non tankou `CETEP-STAGING-TEST`.
3. Asire baz done a vid epi se sèlman pwojè tès sa a w ap sèvi avè l.
4. Kopi connection string pou koneksyon aplikasyon an (pooler ka sèvi). Pa kole li nan chat, pa mete li nan kòd ni nan GitHub.

## Etap 3 — Mete kòd tès la nan yon branch separe
Opsyon ki pi an sekirite se kreye yon nouvo branch GitHub, pa `main`, pa egzanp `test/neon-14-6-3`.

1. Telechaje epi dekonprese pakè ZIP sa a sou òdinatè a.
2. Mete **kontni ki anndan** dosye `CETEP-PLATEFOME-main` la nan branch tès la. Pa mete ZIP la anndan repo a kòm sèl fichye.
3. Verifye `server.js`, `package.json`, `Dockerfile`, `render.yaml`, paj HTML yo ak fichye `test-...` yo nan rasin branch tès la.
4. Pa mete `.env`, modpas, `DATABASE_URL`, oswa okenn sekrè nan GitHub.

## Etap 4 — Kreye yon sèvis Render apa
1. Nan Render, chwazi **New + → Web Service**.
2. Chwazi menm repo a, men chwazi branch tès la `test/neon-14-6-3` (oswa non branch ou te kreye a).
3. Bay sèvis la non `cetep-plateforme-staging`.
4. Chwazi Docker kòm anviwònman an epi asire li sèvi ak `Dockerfile` nan rasin repo a.
5. Sèvi ak plan **Free** pou tès sa a. Pa kreye disk peye pou etap tès la.
6. Ajoute varyab sa yo nan Environment sou Render:
   - `NODE_ENV` = `production`
   - `ADMIN_EMAIL` = imèl administratè tès la
   - `ADMIN_PASSWORD` = yon nouvo modpas tès ki gen omwen 12 karaktè
   - `JWT_SECRET` = yon sekrè o aza, omwen 32 karaktè
   - `DATABASE_URL` = connection string **nouvo pwojè Neon tès la sèlman**
   - `DATA_DIR` = `/tmp/cetep-data`
7. Pa bezwen mete SMTP pou premye tès paj yo ak baz done a. Fonksyon imel la p ap valide san SMTP byen konfigire.
8. Klike Deploy epi li Build/Deploy Logs yo. Si sèvis la pa kòmanse, pa eseye deplwaye sou sit pwodiksyon an; pran mesaj erè a.

## Etap 5 — Tès apre deploy
Lè Render montre deploy la reyisi, ranplase `<URL-RENDER-STAGING>` ak URL nouvo sèvis tès la:

1. Louvri `/health` — li dwe retounen JSON ki gen `"ok":true`, vèsyon `14.6.4-neon-staging-diagnostics`, `"neonReachable":true`, ak `snapshotUpdatedAt`. Si li retounen HTTP 503, pa kontinye tès fonksyonèl yo; verifye koneksyon Neon ak log Render yo.
2. Louvri `/` — paj piblik CETEP la dwe parèt.
3. Louvri `/login` epi konekte ak `ADMIN_EMAIL` ak `ADMIN_PASSWORD` tès ou te mete yo.
4. Kreye yon fòmasyon tès ak yon elèv tès ki pa gen okenn done reyèl.
5. Si gen yon fonksyon peman tès, sèvi ak done tès sèlman; pa fè okenn peman reyèl.
6. Verifye paj pwofesè/elèv, kou, backup, sètifika ak galri. Note nenpòt bouton ki pa mache.
7. Nan Neon **pwojè tès la sèlman**, verifye si tab `cetep_persistent_snapshot` parèt apre demaraj.
8. Apre ou fin kreye yon done tès, rekòmanse sèvis staging lan nan Render epi verifye done tès la toujou la. Sa se tès enpòtan pou snapshot la.
9. Pa teste restore avèk backup pwodiksyon an. Pa antre enfòmasyon reyèl elèv yo.

## Kritè pou nou pase nan pwochen etap la
- `/health` ak paj piblik la mache.
- Administratè tès la kapab konekte.
- Ekriti tès la rive nan Neon.
- Apre restart, done tès la retounen san doublon ni pèt.
- Pa gen erè kritik nan Render logs.

Si youn nan pwen sa yo echwe, sispann epi voye **mesaj erè a sèlman** (san modpas, token, ni connection string). Pa voye okenn sekrè.

## Limit enpòtan
- Plan Free Render la ka dòmi epi sistèm fichye lokal li a pa pèmanan. Tès sa a fèt pou verifye Neon snapshot la, se pa garanti pwodiksyon.
- Pa teste redeploy ki chanje kòd la jiskaske tès restart la pase.
- Pa deplwaye pakè sa a sou sèvis CETEP ki deja ap sèvi ak done reyèl yo.
- Tès lokal ki pase yo pa ranplase tès reyèl koneksyon Neon, rekòmansman Render, imel, pèmisyon pwofesè, enskripsyon, peman ak sètifika.
