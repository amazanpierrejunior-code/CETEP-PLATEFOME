# CETEP v14.6.6 — Rekiperasyon administratè + peman (STAGING ONLY)

## Enfòmasyon peman yo
- MonCash: 37365610 — Pierre Junior Amazan
- Zelle: 5616742890 — Estime Esther
- Paj enskripsyon an montre non ak nimewo benefisyè a epi mande elèv la verifye yo nan aplikasyon peman li anvan li voye lajan.
- Apre soumèt prèv la, peman an rete **En attente** jiskaske administrasyon CETEP verifye li. Sit la pa pretann li verifye tranzaksyon MonCash/Zelle otomatikman.

## Pwoteksyon done
- Koreksyon an ranpli enfòmasyon MonCash/Zelle sèlman si chan yo vid; li pa ranplase enfòmasyon administratè te deja modifye yo.
- Mekanis rekiperasyon admin lan mande `FORCE_ADMIN_RESET=true` avèk entansyon klè, `ADMIN_EMAIL`, ak yon `ADMIN_PASSWORD` ki gen omwen 12 karaktè. Retire/oswa mete valè a `false` apre rekiperasyon an.
- Pa mete modpas administratè a nan dosye sa a oswa nan GitHub.

- Lè elèv la chanje ant MonCash ak Zelle, enstriksyon ak benefisyè a mete ajou touswit; sit la pa montre enstriksyon ansyen metòd la.

## Rezilta tès lokal
- `node --check server.js`, `admin.js`, `app.js`: pase.
- `test-cetep-static.js`: 24/24 tès estatik pase.
- `test-cetep-1462-static.js`: 29/29 tès estatik pase.
- SQLite offline: 3/3 pase.
- Neon snapshot offline simulations: 3/3 pase.

## Limit enpòtan
Achiv sa a baze sou branch tès v14.6.4 ak mekanis SQLite + snapshot Neon. Li pa verifye kont aktyèl la ni baz done pwodiksyon Render la. Pa ranplase sèvis pwodiksyon an avè l dirèkteman anvan konparezon ak kòd `main`, backup verifye, ak tès sou yon sèvis staging.
