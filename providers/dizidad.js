// dizidad - Nuvio provider (dizidad.com)  v1.0.6
// Dizi + Film | Turkce Dublaj / Altyazili | hdplayersystem.com player cozumleme
// DEBUG_MODU true iken kaynak cikmazsa hata kartlari gosterilir.

var BASE = 'https://www.dizidad.com';
var TMDB_KEY = '000316508321ce461cf81e7c6815eec7';
var DEBUG_MODU = false;
var UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

var debugLog = [];
function dbg(m) { debugLog.push(String(m)); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }

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

// hdplayersystem (FirePlayer) embed -> stream
function unesc(u) { return String(u || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&'); }

function postGetVideo(origin, id, embedUrl, r) {
  var url = origin + '/player/index.php?data=' + encodeURIComponent(id) + '&do=getVideo';
  return http(url, {
    method: 'POST',
    headers: {
      'Referer': embedUrl,
      'Origin': origin,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    },
    body: 'hash=' + encodeURIComponent(id) + '&r=' + encodeURIComponent(r || '')
  }).then(function (t) {
    dbg('getVideo yanit: ' + t.slice(0, 110).replace(/\s+/g, ' '));
    var vs = null, sec = null;
    try {
      var j = JSON.parse(t);
      vs = j.videoSource || j.video_source || null;
      sec = j.securedLink || j.secured_link || null;
    } catch (e) {
      var a = t.match(/"videoSource"\s*:\s*"([^"]+)"/);
      var b = t.match(/"securedLink"\s*:\s*"([^"]+)"/);
      vs = a ? a[1] : null; sec = b ? b[1] : null;
    }
    var out = [];
    // sadece securedLink kullan (calisan kaynak); yoksa videoSource'a dus
    [sec, vs].forEach(function (x) {
      x = unesc(x);
      if (!out.length && x && /^https?:/i.test(x)) out.push(x);
    });
    return { links: out, raw: t };
  });
}

// playlisti hangi Referer ile aciliyor kontrol et
function checkPlaylist(u, refs) {
  var i = 0;
  function next() {
    if (i >= refs.length) return Promise.resolve(null);
    var ref = refs[i++];
    return http(u, { headers: { Referer: ref, Origin: (ref.match(/^https?:\/\/[^\/]+/) || [''])[0] } })
      .then(function (t) {
        var head = t.trim().slice(0, 60).replace(/\s+/g, ' ');
        dbg('playlist(' + ref.slice(0, 40) + ') -> ' + head);
        if (/^#EXTM3U/.test(t.trim())) return ref;
        return next();
      }).catch(function () { return next(); });
  }
  return next();
}

function resolveHdPlayer(embedUrl, referer) {
  var origin = (embedUrl.match(/^https?:\/\/[^\/]+/) || [''])[0];
  var id = embedUrl.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop();
  var hdrs = { Referer: referer, Origin: 'https://www.dizidad.com' };

  return http(embedUrl, { headers: hdrs }).then(function (html) {
    dbg('embed id=' + id + ' len=' + html.length);

    // sayfada dogrudan medya varsa
    var direct = findMedia(html);
    if (direct.length) return { media: direct, subs: findSubs(html), referer: embedUrl };

    var base = (html.match(/player_base_url\s*=\s*["']([^"']+)["']/) || [])[1] || origin;
    var subs = findSubs(html);

    function attempt(r) {
      return postGetVideo(base, id, embedUrl, r).then(function (res) {
        if (!res.links.length) return null;
        var link = res.links[0];
        dbg('videoSource: ' + link.slice(0, 90));
        return checkPlaylist(link, [embedUrl, base + '/', referer]).then(function (okRef) {
          var useRef = okRef || embedUrl;
          if (!okRef) dbg('playlist dogrulanamadi, yine de deneniyor');
          return { media: res.links, subs: subs, referer: useRef };
        });
      });
    }

    return attempt(referer).then(function (r1) {
      if (r1) return r1;
      return attempt('');
    }).then(function (r2) {
      if (r2) return r2;
      // basarisiz: sayfadaki ipuclarini debug'a yaz
      var keys = /m3\/|atob|fetch\(|ajax|XMLHttpRequest|sources?\s*[:=]|file\s*:|getVideo|decrypt|AES|CryptoJS|token/i;
      var cnt = 0;
      html.split(/[\r\n;]+/).forEach(function (ln) {
        ln = ln.trim();
        if (cnt < 8 && ln.length > 8 && keys.test(ln)) { cnt++; dbg('SATIR: ' + ln.slice(0, 120)); }
      });
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
  return { name: String(msg).slice(0, 140), title: String(msg).slice(0, 300), url: 'https://example.com/debug.mp4', quality: 'DEBUG', provider: 'dizidad' };
}

function debugCards(prefix) {
  var cards = [];
  if (prefix) cards.push(debugCard(prefix));
  debugLog.slice(0, 25).forEach(function (l, i) { cards.push(debugCard(pad(i + 1) + '. ' + l)); });
  return cards;
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
    if (!streams.length && DEBUG_MODU) return debugCards('kaynak cikmadi');
    return streams;
  }).catch(function (e) {
    return DEBUG_MODU ? debugCards('HATA: ' + e.message) : [];
  });
}

module.exports = { getStreams: getStreams };
