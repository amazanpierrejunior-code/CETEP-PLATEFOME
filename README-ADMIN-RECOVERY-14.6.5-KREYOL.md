# CETEP v14.6.5 — Admin recovery patch (STAGING ONLY)

## Koreksyon
- `ADMIN_EMAIL` ak `ADMIN_PASSWORD` te sèvi sèlman pou kreye premye kont administratè a. Lè kont lan te deja egziste nan SQLite, chanje anviwònman Render yo pa t mete ajou hash modpas la. Sa ka lakòz “Identifiants invalides”.
- Vèsyon sa a ajoute yon reset eksplisit ki limite ak kont ki koresponn ak `ADMIN_EMAIL`; li pa efase ni modifye dosye elèv, enskripsyon, peman, kou oswa sètifika.
- San `FORCE_ADMIN_RESET=true`, demaraj nòmal la pa chanje modpas okenn administratè ki deja egziste.

## Tès
Tès lokal syntax, static, SQLite, ak snapshot offline pase. Yo pa ranplase yon tès sou Render ak baz Neon reyèl.

## AVÈTISMAN
Sa se yon kandida pou tès, pa yon vèsyon pwodiksyon valide. Pa ranplase sèvis Render pwodiksyon an ak achiv sa a dirèkteman: li soti nan branch staging v14.6.4 epi li itilize mekanis SQLite + snapshot Neon. Verifye/matche li ak kòd egzak ki sou GitHub `main` ak sèvis pwodiksyon an anvan deplwaman.

## Rekiperasyon admin lè yo valide kandida a nan yon sèvis tès
1. Sèvi ak yon sèvis Render staging apa ak yon baz Neon tès apa.
2. Mete `ADMIN_EMAIL` sou adrès administratè a, `ADMIN_PASSWORD` sou nouvo modpas la (omwen 12 karaktè), epi `FORCE_ADMIN_RESET=true` pou yon sèl deplwaman.
3. Verifye login lan avèk adrès sa a ak nouvo modpas la.
4. Apre rekiperasyon konfime, retire `FORCE_ADMIN_RESET` oswa mete li `false`, epi redeploy.
5. Pa fè sa sou pwodiksyon jiskaske gen backup verifye epi yo konfime chemen baz done a; pa pataje modpas la nan chat.
