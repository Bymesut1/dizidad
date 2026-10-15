// dizidad - Nuvio provider (dizidad.com)  v1.0.1
// Dizi + Film | Turkce Dublaj / Altyazili | hdplayersystem.com player cozumleme
// DEBUG_MODU true iken kaynak cikmazsa hata kartlari gosterilir.

var BASE = 'https://www.dizidad.com';
var TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
var DEBUG_MODU = true;
var UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

var debugLog = [];
function dbg(m) { debugLog.push(String(m)); }

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function http(url, opts) {
  opts = opts || {};
  var headers = Object.assign({
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
  }, opts.headers || {});
  return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body, redirect: 'follow' })
    .then(function (r) {
      dbg((opts.method || 'GET') + ' ' + url.slice(0, 80) + ' -> ' + r.status);
      return r.text();
    });
}

function getTmdbInfo(tmdbId, mediaType) {
  var type = mediaType === 'movie' ? 'movie' : 'tv';
  var url = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=tr-TR';
  return fetch(url).then(function (r) { return r.json(); }).then(function (tr) {
    return fetch('https://api.themoviedb.org/3/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=en-US')
      .then(function (r) { return r.json(); })
      .then(function (en) {
        var year = String((en.release_date || en.first_air_date || '')).slice(0, 4);
        return {
          titleTr: tr.title || tr.name || '',
          titleEn: en.title || en.name || '',
          orig: en.original_title || en.original_name || '',
          year: year
        };
      });
  });
}

// ---------- ARAMA ----------
function parseSearch(html) {
  var out = [], seen = {};
  var re = /<a[^>]+href=["'](https?:\/\/www\.dizidad\.com\/(?:diziler|filmler|film)\/[^"']+|https?:\/\/www\.dizidad\.com\/[a-z0-9-]+-izle[a-z0-9-]*\/)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    var href = m[1];
    if (seen[href]) continue;
    var text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    var t2 = (m[0].match(/title=["']([^"']+)["']/i) || [])[1] || '';
    var alt = (m[2].match(/alt=["']([^"']+)["']/i) || [])[1] || '';
    var title = text || t2 || alt;
    if (!title) continue;
    seen[href] = 1;
    out.push({ url: href, title: title });
  }
  return out;
}

function searchSite(q) {
  return http(BASE + '/?s=' + encodeURIComponent(q), { headers: { Referer: BASE + '/' } })
    .then(parseSearch);
}

function scoreResult(r, names, wantDub) {
  var t = norm(r.title + ' ' + r.url);
  var best = 0;
  names.forEach(function (n) {
    n = norm(n);
    if (!n) return;
    if (t.indexOf(n) !== -1) best = Math.max(best, 10 + n.length / 100);
  });
  if (best && wantDub && /dublaj/.test(t)) best += 2;
  return best;
}

// ---------- DIZI SAYFASINDAN BOLUM BUL ----------
function findEpisodeUrl(seriesHtml, season, episode) {
  var re = /<a[^>]+href=["'](https?:\/\/www\.dizidad\.com\/[^"']*?-(\d+)-sezon-(\d+)-bolum[^"']*)["']/gi;
  var m;
  while ((m = re.exec(seriesHtml))) {
    if (parseInt(m[2], 10) === season && parseInt(m[3], 10) === episode) return m[1];
  }
  return null;
}

// ---------- OYNATICI CIKAR ----------
function extractEmbeds(html) {
  var out = [], seen = {};
  var re = /<iframe[^>]+src=["']([^"']+)["']/gi, m;
  while ((m = re.exec(html))) {
    var u = m[1];
    if (u.indexOf('//') === 0) u = 'https:' + u;
    if (/reklam|ads|facebook|google/i.test(u)) continue;
    if (!seen[u]) { seen[u] = 1; out.push(u); }
  }
  var j = html.match(/"embedUrl"\s*:\s*"([^"]+)"/);
  if (j && !seen[j[1]]) out.push(j[1]);
  return out;
}

function isJunk(u) {
  return /cloudflareinsights|google|facebook|\.(js|css|png|jpg|gif|svg|ico|woff2?)(\?|$)/i.test(u);
}

function findMedia(txt) {
  var found = [], seen = {};
  var clean = txt.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  var re = /https?:\/\/[^\s"'<>\\)]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\)]*)?/gi, m;
  while ((m = re.exec(clean))) {
    if (isJunk(m[0]) || seen[m[0]]) continue;
    seen[m[0]] = 1; found.push(m[0]);
  }
  return found;
}

function findSubs(txt) {
  var subs = [], seen = {};
  var clean = txt.replace(/\\\//g, '/');
  var re = /https?:\/\/[^\s"'<>\\)]+?\.(?:vtt|srt)(?:\?[^\s"'<>\\)]*)?/gi, m;
  while ((m = re.exec(clean))) {
    if (seen[m[0]]) continue;
    seen[m[0]] = 1; subs.push(m[0]);
  }
  return subs;
}

function b64(s) {
  try { return atob(s); } catch (e) { return ''; }
}

// hdplayersystem embed -> stream
function resolveHdPlayer(embedUrl, referer) {
  var origin = (embedUrl.match(/^https?:\/\/[^\/]+/) || [''])[0];
  var hdrs = { Referer: referer, Origin: 'https://www.dizidad.com' };
  return http(embedUrl, { headers: hdrs }).then(function (html) {
    dbg('embed len=' + html.length);
    var media = findMedia(html);
    if (media.length) return { media: media, subs: findSubs(html), referer: embedUrl };

    // /m3/<token> adresi (sayfa icinde veya JS'de)
    var tokens = [], m;
    var re = /(?:https?:\/\/[^"'\s]+)?\/m3\/([A-Za-z0-9+\/=_-]{40,})/g;
    while ((m = re.exec(html))) tokens.push(m[0].indexOf('http') === 0 ? m[0] : origin + '/m3/' + m[1]);

    // embed id -> bazen dogrudan m3 uretilir; player_id vb.
    var tasks = tokens.map(function (u) {
      return http(u, { headers: { Referer: embedUrl, Origin: origin, 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (t) {
          if (/security error/i.test(t)) { dbg('m3: security error'); return null; }
          var mm = findMedia(t);
          if (!mm.length) { var d = b64(t.trim()); if (d) mm = findMedia(d); }
          return mm.length ? { media: mm, subs: findSubs(t), referer: embedUrl } : null;
        }).catch(function () { return null; });
    });

    // packed / base64 icerik tara
    var atobs = html.match(/atob\(["']([A-Za-z0-9+\/=]{40,})["']\)/g) || [];
    atobs.forEach(function (a) {
      var d = b64(a.replace(/atob\(["']|["']\)/g, ''));
      var mm = findMedia(d);
      if (mm.length) tasks.push(Promise.resolve({ media: mm, subs: findSubs(d), referer: embedUrl }));
    });

    return Promise.all(tasks).then(function (rs) {
      for (var i = 0; i < rs.length; i++) if (rs[i]) return rs[i];
      // son care: embed sayfasindaki /m3/ yolunu id ile dene
      var id = embedUrl.split('/').pop();
      var f = html.match(/["']([^"']*\/(?:source|sources|player|api)[^"']*)["']/);
      if (f) dbg('olasi api: ' + f[1].slice(0, 80));
      dbg('embed id=' + id + ' stream cikmadi');
      return null;
    });
  });
}

function quality(u) {
  var m = u.match(/(2160|1440|1080|720|480|360)/);
  return m ? m[1] + 'p' : 'Auto';
}

function buildStreams(res, label, pageUrl) {
  var list = [];
  res.media.forEach(function (u, i) {
    list.push({
      name: 'dizidad',
      title: label + (res.media.length > 1 ? ' #' + (i + 1) : ''),
      url: u,
      quality: quality(u),
      headers: { 'User-Agent': UA, Referer: res.referer, Origin: (res.referer.match(/^https?:\/\/[^\/]+/) || [''])[0] },
      subtitles: res.subs.map(function (s, k) { return { url: s, label: 'Altyazi ' + (k + 1), lang: 'tur' }; }),
      provider: 'dizidad'
    });
  });
  return list;
}

function debugCard(msg) {
  return { name: 'dizidad DEBUG', title: msg.slice(0, 200), url: 'https://example.com/debug.mp4', quality: 'Auto', provider: 'dizidad' };
}

// ---------- ANA FONKSIYON ----------
function getStreams(tmdbId, mediaType, season, episode) {
  debugLog = [];
  var isTv = mediaType !== 'movie';
  season = parseInt(season || 1, 10);
  episode = parseInt(episode || 1, 10);

  return getTmdbInfo(tmdbId, mediaType).then(function (info) {
    dbg('tmdb: ' + info.titleEn + ' / ' + info.titleTr + ' (' + info.year + ')');
    var names = [info.titleTr, info.titleEn, info.orig].filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var queries = names.slice(0, 3);

    return Promise.all(queries.map(function (q) { return searchSite(q).catch(function () { return []; }); }))
      .then(function (arrs) {
        var all = [], seen = {};
        arrs.forEach(function (a) { a.forEach(function (r) { if (!seen[r.url]) { seen[r.url] = 1; all.push(r); } }); });
        dbg('arama sonuc: ' + all.length);

        var cands = all.map(function (r) { return { r: r, s: scoreResult(r, names, true) }; })
          .filter(function (x) { return x.s > 0; })
          .sort(function (a, b) { return b.s - a.s; })
          .map(function (x) { return x.r; });

        if (isTv) {
          // dizi sayfalari (/diziler/...) ya da dogrudan bolum linkleri
          var seriesPages = cands.filter(function (r) { return /\/diziler\//.test(r.url); });
          var direct = cands.filter(function (r) { return new RegExp('-' + season + '-sezon-' + episode + '-bolum').test(r.url); });

          var epUrls = direct.map(function (r) { return r.url; });
          var chain = Promise.resolve();
          seriesPages.slice(0, 4).forEach(function (sp) {
            chain = chain.then(function () {
              return http(sp.url, { headers: { Referer: BASE + '/' } }).then(function (h) {
                var u = findEpisodeUrl(h, season, episode);
                if (u && epUrls.indexOf(u) === -1) epUrls.push(u);
              }).catch(function () {});
            });
          });
          return chain.then(function () { return epUrls; });
        }
        // film
        var movies = cands.filter(function (r) { return !/\/diziler\//.test(r.url) && !/-sezon-/.test(r.url); });
        return movies.slice(0, 4).map(function (r) { return r.url; });
      });
  }).then(function (pages) {
    dbg('sayfa sayisi: ' + pages.length);
    var streams = [];
    var chain = Promise.resolve();
    pages.slice(0, 4).forEach(function (pg) {
      chain = chain.then(function () {
        return http(pg, { headers: { Referer: BASE + '/' } }).then(function (html) {
          var embeds = extractEmbeds(html);
          dbg('embed: ' + embeds.length);
          var label = /dublaj/i.test(pg) ? 'Turkce Dublaj' : 'Altyazili';
          var p = Promise.resolve();
          embeds.forEach(function (e) {
            p = p.then(function () {
              if (/hdplayersystem|hdmomplayer/i.test(e)) {
                return resolveHdPlayer(e, pg).then(function (res) {
                  if (res) streams = streams.concat(buildStreams(res, label, pg));
                });
              }
              return http(e, { headers: { Referer: pg } }).then(function (t) {
                var mm = findMedia(t);
                if (mm.length) streams = streams.concat(buildStreams({ media: mm, subs: findSubs(t), referer: e }, label, pg));
              });
            }).catch(function (err) { dbg('hata: ' + err.message); });
          });
          return p;
        }).catch(function (err) { dbg('sayfa hata: ' + err.message); });
      });
    });
    return chain.then(function () { return streams; });
  }).then(function (streams) {
    if (!streams.length && DEBUG_MODU) return [debugCard('kaynak cikmadi | ' + debugLog.join(' | '))];
    return streams;
  }).catch(function (e) {
    return DEBUG_MODU ? [debugCard('HATA: ' + e.message + ' | ' + debugLog.join(' | '))] : [];
  });
}

module.exports = { getStreams: getStreams };
