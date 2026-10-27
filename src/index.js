// Worker du site : sert les fichiers de public/ et relève toutes les 30 minutes
// le montant collecté sur la Trousse à projets (voir « triggers » dans wrangler.jsonc).

const CLE = 'collecte'; // clé KV : { collecte, donateurs, maj }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Dernier relevé, pour vérifier que le cron fonctionne
    if (url.pathname === '/api/collecte') {
      const etat = await lireEtat(env);
      return etat
        ? Response.json(etat, { headers: { 'Cache-Control': 'no-cache' } })
        : Response.json({ erreur: 'Aucun relevé pour le moment' }, { status: 503 });
    }

    // Page d'accueil : sans en-têtes conditionnels, sinon le navigateur
    // reçoit un 304 et garde une page avec un ancien montant.
    const entetes = new Headers(request.headers);
    entetes.delete('If-None-Match');
    entetes.delete('If-Modified-Since');
    const page = await env.ASSETS.fetch(new Request(request, { headers: entetes }));

    const etat = await lireEtat(env);
    if (!etat || page.status !== 200 || !(page.headers.get('Content-Type') || '').includes('text/html')) {
      return page;
    }

    // Le montant est inscrit dans la page avant son envoi : pas de saut à l'affichage.
    const reecrite = new HTMLRewriter()
      .on('head', {
        element(head) {
          head.append('<script>var COLLECTE_AUTO = ' + JSON.stringify(etat) + ';</script>', { html: true });
        },
      })
      .transform(page);
    // Copie aux en-têtes modifiables ; la longueur d'origine ne correspond plus à la page.
    const reponse = new Response(reecrite.body, reecrite);
    reponse.headers.delete('Content-Length');
    reponse.headers.delete('ETag');
    reponse.headers.delete('Last-Modified');
    reponse.headers.set('Cache-Control', 'no-cache');
    return reponse;
  },

  async scheduled(controller, env) {
    await releverCollecte(env);
  },
};

async function lireEtat(env) {
  try {
    return await env.DONNEES.get(CLE, 'json');
  } catch (e) {
    console.error('Lecture KV impossible', e);
    return null;
  }
}

// Lit la page de la Trousse et enregistre le montant. En cas de doute, on n'écrit rien :
// le site garde le dernier relevé valide.
async function releverCollecte(env) {
  const reponse = await fetch(env.TROUSSE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'fr',
    },
  });
  const html = await reponse.text();
  if (!reponse.ok) {
    console.error('Trousse à projets : HTTP ' + reponse.status, html.slice(0, 200));
    return;
  }

  const releve = extraireCollecte(html);
  if (!releve) {
    console.error('Trousse à projets : montant introuvable, la structure de la page a peut-être changé');
    return;
  }

  // Le montant ne baisse pas en temps normal. Une baisse à 0 est forcément une erreur de lecture ;
  // une autre baisse n'est acceptée que si elle est relue à l'identique au relevé suivant.
  const precedent = await lireEtat(env);
  if (precedent && releve.collecte < precedent.collecte) {
    if (releve.collecte === 0 || precedent.baisse !== releve.collecte) {
      console.warn('Montant en baisse ignoré : ' + precedent.collecte + ' → ' + releve.collecte);
      if (releve.collecte > 0) {
        await env.DONNEES.put(CLE, JSON.stringify({ ...precedent, baisse: releve.collecte }));
      }
      return;
    }
  }

  await env.DONNEES.put(CLE, JSON.stringify({ ...releve, maj: new Date().toISOString() }));
}

// Repère les chiffres grâce à leurs libellés, pas à leur position :
// les objectifs de 2 000 € et 4 000 € utilisent la même classe « amount-number ».
function extraireCollecte(html) {
  const texte = html.replace(/&nbsp;|&#160;|&#x0*a0;|&#8239;|&#x202f;/gi, ' ');
  const montant = texte.match(/Montant collecté\s*:?\s*<\/strong>\s*<\/p>\s*<p class="amount-number">\s*(\d[\d\s\u00a0\u202f.,]{0,20}?)\s*(?:€|&euro;)\s*</);
  const donateurs = texte.match(/>\s*Donateurs\s*<\/span>\s*<span class="amount-number">\s*(\d[\d\s\u00a0\u202f]{0,9}?)\s*</);
  if (!montant || !donateurs) return null;

  // « 1 250,00 » → 1250 ; « 0 » → 0
  const collecte = Number(montant[1].replace(/[\s\u00a0\u202f.]/g, '').replace(',', '.'));
  const nb = Number(donateurs[1].replace(/[\s\u00a0\u202f]/g, ''));
  if (!Number.isFinite(collecte) || collecte < 0 || !Number.isInteger(nb) || nb < 0) return null;
  return { collecte, donateurs: nb };
}
