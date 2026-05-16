async function f() {
    for (const l of ['eng.1', 'esp.1', 'uefa.champions']) {
      try {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${l}/news`);
          const json = await r.json();
          console.log(`[${l}]`, json.articles ? json.articles.length : 0);
          if (json.articles && json.articles.length > 0) {
              console.log(json.articles[0].published);
          }
      } catch(e) {
          console.error(e);
      }
    }
}
f();
