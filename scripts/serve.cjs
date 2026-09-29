'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var URLConstructor = require('url').URL;

var host = '0.0.0.0';
var port = Number(process.env.PORT) || 3002;
var projectRoot = path.resolve(__dirname, '..');
var publicRoot = path.resolve(__dirname, '..', 'dist');
var sourceListingsPath = path.join(projectRoot, 'data', 'listings.json');
var publicListingsPath = path.join(publicRoot, 'listings.json');
var geocodeCachePath = path.join(projectRoot, 'data', 'geocode-cache.json');
var refreshInProgress = null;
var lastGeocodeRequestAt = 0;
var geocodeQueue = Promise.resolve();
var geocodeCache = {};
try {
  geocodeCache = JSON.parse(fs.readFileSync(geocodeCachePath, 'utf8'));
} catch (error) {
  geocodeCache = {};
}
var mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

if (!fs.existsSync(path.join(publicRoot, 'index.html'))) {
  console.error('La version compilée est absente. Exécutez d’abord « npm run build ».');
  process.exit(1);
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise(function (resolve, reject) {
    var body = '';
    request.on('data', function (chunk) {
      body += chunk;
      if (body.length > 4096) request.destroy(new Error('Requête trop volumineuse'));
    });
    request.on('end', function () {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(new Error('Requête incorrecte'));
      }
    });
    request.on('error', reject);
  });
}

function distanceFromCampus(lat, lon) {
  var campusLat = 19.404145;
  var campusLon = -99.260732;
  var radians = Math.PI / 180;
  var latDelta = (lat - campusLat) * radians;
  var lonDelta = (lon - campusLon) * radians;
  var a = Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(campusLat * radians) * Math.cos(lat * radians) * Math.sin(lonDelta / 2) * Math.sin(lonDelta / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fetchGeocodeResult(address) {
  return new Promise(function (resolve, reject) {
    var query = [
      'format=jsonv2',
      'limit=1',
      'countrycodes=mx',
      'addressdetails=1',
      'viewbox=-99.38,19.50,-99.14,19.31',
      'q=' + encodeURIComponent(address)
    ].join('&');
    var request = https.get({
      hostname: 'nominatim.openstreetmap.org',
      path: '/search?' + query,
      headers: {
        'User-Agent': 'CarteEtudianteAnahuac/1.1 (local educational map)',
        'Referer': 'http://localhost:3002/',
        'Accept': 'application/json',
        'Accept-Language': 'fr,es-MX;q=0.9'
      }
    }, function (geocodeResponse) {
      var body = '';
      geocodeResponse.on('data', function (chunk) {
        body += chunk;
        if (body.length > 1000000) request.destroy(new Error('Réponse trop volumineuse'));
      });
      geocodeResponse.on('end', function () {
        if (geocodeResponse.statusCode < 200 || geocodeResponse.statusCode >= 300) {
          reject(new Error('Le service de recherche est temporairement indisponible'));
          return;
        }
        try {
          var results = JSON.parse(body);
          resolve(Array.isArray(results) && results.length ? results[0] : null);
        } catch (error) {
          reject(new Error('Réponse de recherche incorrecte'));
        }
      });
    });
    request.setTimeout(12000, function () {
      request.destroy(new Error('La recherche a pris trop de temps'));
    });
    request.on('error', reject);
  });
}

function scheduleGeocode(address) {
  var task = geocodeQueue.then(function () {
    var wait = Math.max(0, 1000 - (Date.now() - lastGeocodeRequestAt));
    return new Promise(function (resolve) { setTimeout(resolve, wait); }).then(function () {
      lastGeocodeRequestAt = Date.now();
      return fetchGeocodeResult(address);
    });
  });
  geocodeQueue = task.catch(function () {});
  return task;
}

function geocodeAddress(address) {
  var normalizedAddress = address.trim().toLocaleLowerCase('fr');
  var cacheKey = crypto.createHash('sha256').update(normalizedAddress).digest('hex');
  if (geocodeCache[cacheKey]) return Promise.resolve(geocodeCache[cacheKey]);
  return scheduleGeocode(address).then(function (result) {
    if (!result) {
      var notFoundError = new Error('Adresse introuvable. Ajoutez le quartier ou le code postal.');
      notFoundError.statusCode = 404;
      throw notFoundError;
    }
    var lat = Number(result.lat);
    var lon = Number(result.lon);
    var distanceKm = distanceFromCampus(lat, lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || distanceKm > 10) {
      var outsideError = new Error('Cette adresse se trouve hors du rayon de 10 km.');
      outsideError.statusCode = 422;
      throw outsideError;
    }
    var response = {
      label: result.display_name,
      lat: lat,
      lon: lon,
      distanceKm: Math.round(distanceKm * 10) / 10
    };
    geocodeCache[cacheKey] = response;
    return writeFile(geocodeCachePath, JSON.stringify(geocodeCache, null, 2) + '\n').then(function () { return response; });
  });
}

function fetchSource(targetUrl, redirectCount) {
  return new Promise(function (resolve) {
    var parsed;
    try {
      parsed = new URLConstructor(targetUrl);
    } catch (error) {
      resolve({ status: 0, body: '', error: 'Adresse de source invalide' });
      return;
    }

    var transport = parsed.protocol === 'http:' ? http : https;
    var request = transport.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CarteEtudianteAnahuac/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'es-MX,es;q=0.9'
      }
    }, function (sourceResponse) {
      var statusCode = sourceResponse.statusCode || 0;
      var redirects = [301, 302, 303, 307, 308];
      if (redirects.indexOf(statusCode) !== -1 && sourceResponse.headers.location && redirectCount < 3) {
        sourceResponse.resume();
        resolve(fetchSource(new URLConstructor(sourceResponse.headers.location, targetUrl).toString(), redirectCount + 1));
        return;
      }

      var chunks = [];
      var received = 0;
      sourceResponse.on('data', function (chunk) {
        received += chunk.length;
        if (received <= 2000000) chunks.push(chunk);
      });
      sourceResponse.on('end', function () {
        resolve({ status: statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });

    request.setTimeout(15000, function () {
      request.destroy(new Error('Délai de réponse dépassé'));
    });
    request.on('error', function (error) {
      resolve({ status: 0, body: '', error: error.message });
    });
  });
}

function classifySource(result) {
  if (result.status === 404 || result.status === 410) return 'inactive';
  if (result.status < 200 || result.status >= 300) return 'unknown';

  var page = result.body.toLowerCase();
  var inactivePhrases = [
    /fuera del mercado/,
    /ya no est[aá] disponible/,
    /anuncio no disponible/,
    /publicaci[oó]n finalizada/,
    /propiedad no disponible/,
    /inmueble no disponible/
  ];
  for (var index = 0; index < inactivePhrases.length; index += 1) {
    if (inactivePhrases[index].test(page)) return 'inactive';
  }
  return 'active';
}

function writeFile(filePath, contents) {
  return new Promise(function (resolve, reject) {
    fs.writeFile(filePath, contents, 'utf8', function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

function performListingsRefresh() {
  return new Promise(function (resolve, reject) {
    fs.readFile(sourceListingsPath, 'utf8', function (readError, contents) {
      if (readError) {
        reject(readError);
        return;
      }

      var data;
      try {
        data = JSON.parse(contents);
      } catch (parseError) {
        reject(parseError);
        return;
      }

      var listings = Array.isArray(data.listings) ? data.listings : [];
      Promise.all(listings.map(function (listing) {
        if (!listing.source) {
          listing.availability = 'unknown';
          listing.lastChecked = new Date().toISOString();
          listing.sourceStatus = 'Source absente';
          return Promise.resolve(listing);
        }
        return fetchSource(listing.source, 0).then(function (result) {
          listing.availability = classifySource(result);
          listing.lastChecked = new Date().toISOString();
          listing.sourceStatus = result.status || result.error || 'Non vérifiable';
          return listing;
        });
      })).then(function () {
        var now = new Date();
        data.updated = now.toISOString().slice(0, 10);
        data.lastChecked = now.toISOString();
        var serialized = JSON.stringify(data, null, 2) + '\n';
        return Promise.all([
          writeFile(sourceListingsPath, serialized),
          writeFile(publicListingsPath, serialized)
        ]).then(function () {
          var summary = { active: 0, inactive: 0, unknown: 0, updated: data.updated };
          listings.forEach(function (listing) {
            if (listing.availability === 'active') summary.active += 1;
            else if (listing.availability === 'inactive') summary.inactive += 1;
            else summary.unknown += 1;
          });
          resolve(summary);
        });
      }).catch(reject);
    });
  });
}

function refreshListings() {
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = performListingsRefresh().then(function (result) {
    refreshInProgress = null;
    return result;
  }, function (error) {
    refreshInProgress = null;
    throw error;
  });
  return refreshInProgress;
}

var server = http.createServer(function (request, response) {
  var pathname;
  try {
    pathname = decodeURIComponent(new URLConstructor(request.url, 'http://localhost').pathname);
  } catch (error) {
    response.writeHead(400);
    response.end('Requête incorrecte');
    return;
  }

  if (pathname === '/api/refresh-listings') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      respondJson(response, 405, { error: 'Utilisez le bouton de mise à jour.' });
      return;
    }
    refreshListings().then(function (result) {
      respondJson(response, 200, result);
    }).catch(function (error) {
      console.error('Mise à jour des annonces impossible:', error.message);
      respondJson(response, 500, { error: 'La mise à jour des annonces a échoué.' });
    });
    return;
  }

  if (pathname === '/api/geocode') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      respondJson(response, 405, { error: 'Utilisez le formulaire d’adresse.' });
      return;
    }
    readJsonBody(request).then(function (body) {
      var address = typeof body.address === 'string' ? body.address.trim() : '';
      if (address.length < 3 || address.length > 200) {
        var validationError = new Error('Saisissez une adresse plus précise.');
        validationError.statusCode = 400;
        throw validationError;
      }
      return geocodeAddress(address);
    }).then(function (result) {
      respondJson(response, 200, result);
    }).catch(function (error) {
      respondJson(response, error.statusCode || 502, { error: error.message || 'Recherche impossible.' });
    });
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  var filePath = path.resolve(publicRoot, '.' + pathname);
  if (filePath !== publicRoot && filePath.indexOf(publicRoot + path.sep) !== 0) {
    response.writeHead(403);
    response.end('Accès refusé');
    return;
  }

  fs.stat(filePath, function (statError, stats) {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Fichier introuvable');
      return;
    }

    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': pathname.indexOf('/assets/') === 0 ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.on('error', function (error) {
  if (error.code === 'EADDRINUSE') {
    console.error('Le port ' + port + ' est déjà utilisé. Fermez l’ancien serveur puis relancez ./run.sh.');
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, host, function () {
  console.log('Carte Anáhuac disponible sur http://localhost:' + port);
  console.log('Appuyez sur Ctrl+C pour arrêter.');
});
