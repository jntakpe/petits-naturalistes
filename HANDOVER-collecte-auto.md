# Handover : mise à jour automatique du montant collecté

Rédigé le 27 octobre 2026. Ce fichier est à la racine du dépôt, en dehors de `public/` : il n'est pas publié sur le site.

## Objectif

Le site https://grandclos.montargis.org doit afficher automatiquement le montant collecté (et, si possible, le nombre de donateurs) relevé sur la page de la Trousse à projets, au lieu d'une valeur saisie à la main.

Page de la collecte : https://trousseaprojets.fr/projet/24246-a-la-rencontre-des-animaux-sauvages-et-de-la-ferme

## Le site aujourd'hui

- Site statique en un seul fichier : `public/index.html` (HTML, CSS et JS en ligne, sans framework, sans étape de build).
- Hébergé sur Cloudflare Workers en mode « assets seuls ». Voir `wrangler.jsonc` : il n'y a pas de `main`, seulement `assets.directory = ./public`, plus la route `grandclos.montargis.org` en custom domain.
- Commandes : `pnpm dev` (`wrangler dev`) et `pnpm deploy` (`wrangler deploy`).
- Le montant est saisi à la main dans le bloc « À mettre à jour » du `<script>` en bas de `public/index.html` :
  ```js
  var TROUSSE_URL = 'https://trousseaprojets.fr/projet/24246-…';
  var COLLECTE = 0;               // montant collecté en euros
  var FIN_COLLECTE = { an: 2026, mois: 12, jour: 24 };
  ```
- Juste en dessous, un bloc IIFE commenté « Jauges du héros et de l'objectif, à partir de COLLECTE » applique le montant :
  - `.js-gauge` : propriété CSS `--pct` (calculée comme `COLLECTE / 40`, car l'objectif est de 4 000 €) et `aria-label` de la grande jauge ;
  - `.js-raised` : texte du montant, au format `eurosRonds` (`Intl.NumberFormat` fr-FR, sans décimales) ;
  - `.js-raised-some` / `.js-raised-zero` : la carte du haut affiche « Soyez parmi les premiers donateurs » tant que le montant est à 0.
- Sous la grande jauge, un `<p class="update-note">` indique « Montant relevé régulièrement sur la Trousse à projets ». Ce texte est à adapter une fois l'automatisation en place.
- Les QR codes sont générés avec segno (`uv run --with segno`), avec une marge de 4 modules. `public/images/qr-code-trousse.svg` contient l'URL de `TROUSSE_URL` : si cette URL change, il faut régénérer ce QR code. `qr-code-grandclos.svg` est affiché sur le site, et `qr-code-grandclos.png` (1480 px, noir) est le fichier proposé au téléchargement pour l'impression.

## Ce qu'on sait de la Trousse à projets

- Il n'y a pas d'API publique : `https://trousseaprojets.fr/projet/24246.json` répond 404.
- La page est rendue côté serveur (Rails). Les chiffres figurent directement dans le HTML, sans JavaScript :
  ```html
  <strong class="title-amount">Montant collecté : </strong>
  </p>
  <p class="amount-number">
    0,00 €
  </p>
  …
  <span class="label d-inline-block">Donateurs</span>
  <span class="amount-number">0</span>
  ```
  Les objectifs (2 000,00 € et 4 000,00 €) utilisent aussi `.amount-number`. Il faut donc repérer le montant grâce au libellé « Montant collecté », pas grâce à sa position dans la page.
- Format des montants : français, avec une espace (ou espace insécable) pour les milliers et une virgule décimale, par exemple `1 250,00 €`.
- La page n'envoie aucun en-tête `Access-Control-Allow-Origin`. Un `fetch` depuis le navigateur du visiteur est donc impossible : il faut passer par le serveur.
- `curl` avec un User-Agent de navigateur obtient bien un 200.

## Approche recommandée

1. Ajouter un Worker à côté des assets :
   - dans `wrangler.jsonc` : `"main": "src/index.js"`, un binding `"assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": ["/api/*"] }` ;
   - **à vérifier dans la doc Cloudflare** : la syntaxe exacte de `run_worker_first` avec cette version de wrangler (4.151) ;
   - toutes les autres requêtes doivent être servies par `env.ASSETS.fetch(request)`.
2. Route `GET /api/collecte` :
   - elle télécharge la page de la Trousse, en extrait le montant et le nombre de donateurs, et renvoie `{ "collecte": 350, "donateurs": 7, "maj": "<ISO date>" }` ;
   - l'extraction peut se faire avec `HTMLRewriter` ou une regex ancrée sur « Montant collecté » ;
   - mise en cache environ 15 minutes avec la Cache API (`caches.default`), pour ne pas solliciter la Trousse à chaque visite ;
   - en cas d'échec (réponse HTTP en erreur, structure de page changée, montant illisible), elle renvoie une erreur 502, ou le dernier montant valide. Elle ne doit jamais renvoyer 0 par erreur.
3. Côté page :
   - garder `COLLECTE` comme valeur de secours ;
   - transformer le bloc des jauges en une fonction `afficherCollecte(montant)` ;
   - l'appeler une première fois avec `COLLECTE`, puis avec le résultat de `fetch('/api/collecte')` s'il réussit.
   - En option : afficher le nombre de donateurs.
4. Tester avec `pnpm dev` : vérifier que `/api/collecte` répond correctement et que les jauges se mettent à jour. Vérifier aussi le cas d'échec, en coupant l'URL de la Trousse : le site doit retomber sur `COLLECTE`.
5. Déployer avec `pnpm deploy`, **seulement après accord de l'utilisateur**.

Alternative écartée pour l'instant : un Cron Trigger qui stocke le montant dans KV. C'est plus robuste, mais plus lourd à mettre en place pour une collecte qui dure deux mois.

## Conventions du dépôt

- Tout est en français : textes du site, commentaires du code, messages de commit (voir `git log`). Les commentaires sont courts et rédigés comme ceux déjà présents dans le script.
- JS volontairement « à l'ancienne » (`var`, `[].forEach.call`, IIFE) : garder ce style dans `index.html`.
- Gestionnaire de paquets : pnpm.
- Adresse publique : grandclos@montargis.org uniquement. Elle redirige vers la boîte personnelle d'une maman élue, dont l'adresse ne doit jamais apparaître dans un fichier publié.
- Ne pas commiter ni déployer sans que l'utilisateur le demande.

## Autres points en suspens (hors automatisation)

Les PDF de `public/documents/` ne correspondent plus au site. Il n'y a pas de fichier source dans le dépôt, donc on ne peut pas les régénérer ici :
- les trois PDF annoncent une collecte « du 16 octobre au 24 décembre ». Les dates retenues sont désormais **du 26 octobre au 24 décembre** ;
- le dossier partenaires mentionne encore une contrepartie (« Votre nom sur la liste des remerciements affichée à l'école »). La demande est de ne plus parler de contreparties ;
- le dossier partenaires et le communiqué contiennent encore des champs à remplir : `[LIEN]`, `[NOM]`, `[TÉLÉPHONE]`, `[MAIL]`.
