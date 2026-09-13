# Morocco locations and administrative areas

Source: HCP RGPH 2024 https://www.hcp.ma/file/242341/
Publication: https://www.hcp.ma/Population-legale-du-Royaume-du-Maroc-repartie-par-regions-provinces-et-prefectures-et-communes-selon-les-resultats-du_a3975.html

The catalog now includes all 1,708 commune, arrondissement and urban-center rows in this workbook, alongside the existing international locations. Existing location IDs and Yabiladi fallback IDs are retained. Homonyms have distinct geographic-code suffixes when needed. Reproduce with `python scripts/import-location-hierarchy.py path/to/hcp.xlsx`.

`locationType` separates city choices from communes, centers and districts. `provinceCode` and `provinceName` record the official province/prefecture. `parentCity` links arrondissements to their actual city. The areas menu includes the selected city's districts and the communes/centers in its province/prefecture, explicitly labelled as such, not as city neighborhoods. A rural-only province exposes its urban center as a city-menu entry. The catalog does not enumerate every informal neighborhood or village. International cities retain their previous catalog and show no invented districts.

HCP codes directly under a province identify the main city list; communes with subordinate urban centers, mechouars and Tassoultante appear in areas. This is a navigation classification, not a replacement for official administrative status. Marrakech includes Ouahat Sidi Brahim (commune code 73510207), Oulad Belaaguid and five city arrondissements.

Saved location IDs continue to select the actual leaf area for both guild and personal schedules. Areas use province-qualified geographic names for AlAdhan (method 21, Africa/Casablanca); existing city queries are unchanged. Live sample checks cover Ouahat Sidi Brahim, Gueliz, Agafay, Anjra and Marrakech. Every imported area's geocoding and prayer timetable has not been individually verified. New areas have no invented Yabiladi fallback.
