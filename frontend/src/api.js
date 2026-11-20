// src/api.js
//
// Centralized API client. Every backend call goes through here.
//
// WHY: If you call fetch('/api/sets') directly in 10 components and the
// backend URL changes, you edit 10 files. Here you edit one.
// It also means error handling, headers, and base URL are consistent everywhere.
//
// In a browser the base URL is just /api: the Vite proxy in vite.config.js
// forwards it to the backend container. In the Android app the pages come
// from inside the app, so calls go to the server address typed in when the
// app was first opened (kept on the phone, never in the code).

import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
const SERVER_KEY = 'pokecard.server';

export function serverUrl() {
  if (!isNative) return '';
  try { return localStorage.getItem(SERVER_KEY) || ''; } catch { return ''; }
}
export function setServerUrl(url) {
  try { localStorage.setItem(SERVER_KEY, url.trim().replace(/\/+$/, '')); } catch { /* private mode */ }
}

// The API's address, worked out on each call (the app's server can change).
const base = () => `${serverUrl()}/api`;
// A full address on the server, for links that leave the page (downloads).
export const serverLink = (path) => `${serverUrl()}${path}`;

// fetch(), with a plain message when the server can't be reached at all
// (from the phone that is nearly always NetBird being off).
async function send(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(isNative ? "Can't reach the server. Is NetBird connected?" : "Can't reach the server");
  }
}

async function request(method, path, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await send(`${base()}${path}`, options);

  // 204 No Content (e.g. successful DELETE) has no body — don't try to parse it
  if (res.status === 204) return null;

  const data = await res.json();

  // If the server returned an error status, throw so callers can catch it
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed: ${res.status}`);
  }

  return data;
}

// Sends a picture file (a scan) as a form, plus any other fields. The browser
// sets the multipart Content-Type itself, so request() can't be used here.
async function uploadPicture(path, file, fields = {}) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  formData.append('picture', file);
  const res = await send(`${base()}${path}`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || `Request failed: ${res.status}`);
  return data;
}

// ── Sets ──────────────────────────────────────────────────────────────────────
export const api = {
  sets: {
    list:      ()           => request('GET',    '/sets'),
    get:       (id)         => request('GET',    `/sets/${id}`),
    searchTcg: (query)      => request('POST',   '/sets/search-tcg', { query }),
    create:    (data)       => request('POST',   '/sets', data),
    delete:    (id)         => request('DELETE', `/sets/${id}`),
    update:      (id, data) => request('PATCH', `/sets/${id}`, data),
    parentSets:  ()         => request('GET',   '/sets/parents'),
    children:    (id)       => request('GET',   `/sets/children/${id}`),
    importAlternate: (id, data) => request('POST', `/sets/${id}/import-alternate`, data),
    missingType: (id) => request('GET', `/sets/${id}/missing-type`),
    searchSource: (sourceSetId, q) => request('GET', `/sets/search-source?source_set_id=${sourceSetId}&q=${encodeURIComponent(q)}`),
    quickSources: () => request('GET', '/sets/quick-sources'),
    searchOwnCards: (id, q) => request('GET', `/sets/${id}/search-own-cards?q=${encodeURIComponent(q)}`),
    searchQuickSources: (q) => request('GET', `/sets/search-quick-sources?q=${encodeURIComponent(q)}`),
  },

  // ── Cards ──────────────────────────────────────────────────────────────────
  cards: {
    setOwned:        (id, owned)    => request('PATCH', `/cards/${id}/owned`,         { owned }),
    setReverseOwned: (id, owned)    => request('PATCH', `/cards/${id}/reverse-owned`, { owned }),
    setStorage:      (id, storage)  => request('PATCH', `/cards/${id}/storage`,       { storage }),
    setExtra:        (id, hasExtra) => request('PATCH', `/cards/${id}/extra`,         { has_extra: hasExtra }),
    setCondition:    (id, condition) => request('PATCH', `/cards/${id}/condition`,    { condition }),
    create:          (data)         => request('POST',  '/cards',                     data),
    delete:          (id)           => request('DELETE',`/cards/${id}`),
    setType: (id, pokemon_type) => request('PATCH', `/cards/${id}/type`, { pokemon_type }),
    move: (id, data) => request('PATCH', `/cards/${id}/move`, data),
    setNotes: (id, data) => request('PATCH', `/cards/${id}/notes`, data),
    gradedPrices: (id) => request('GET', `/cards/${id}/graded-prices`),
    setGraded: (id, data) => request('PATCH', `/cards/${id}/graded`, data),
    setReverseGraded: (id, data) => request('PATCH', `/cards/${id}/reverse-graded`, data),
  },

  // ── Prices ────────────────────────────────────────────────────────────────
  prices: {
    refresh: (setId)  => request('POST', `/prices/refresh/${setId}`),
    history: (cardId) => request('GET',  `/prices/history/${cardId}`),
  },

  // ── Import ────────────────────────────────────────────────────────────────
  import: {
    excel:      (formData) => send(`${base()}/import`, { method: 'POST', body: formData }).then(r => r.json()),
    collection: (formData) => send(`${base()}/import/collection`, { method: 'POST', body: formData }).then(r => r.json()),
  },
  // ── Backup ────────────────────────────────────────────────────────────────
  backup: {
    run:      ()         => request('POST', '/backup/run'),
    list:     ()         => request('GET',  '/backup/list'),
    restore:  (formData) => send(`${base()}/backup/restore`, { method: 'POST', body: formData }).then(r => r.json()),
    download: (filename) => window.open(`${base()}/backup/download/${filename}`, '_blank'),
  },
  // ── Admin ─────────────────────────────────────────────────────────────────
admin: {
  dataSources: () => request('GET', '/admin/data-sources'),
  seriesMap: {
    list:   ()                     => request('GET',    '/admin/series-map'),
    add:    (set_code, series)     => request('POST',   '/admin/series-map', { set_code, series }),
    update: (set_code, data)       => request('PATCH',  `/admin/series-map/${set_code}`, data),
    delete: (set_code)             => request('DELETE', `/admin/series-map/${set_code}`),
  },
  rarities: {
    list: ()                    => request('GET', '/admin/rarities'),
    set:  (rarity, counts_as)   => request('PUT', '/admin/rarities', { rarity, counts_as }),
  },
  // Fill in illustrators for every set (background job — poll job() for progress)
  illustrators: {
    start: () => request('POST', '/admin/illustrators'),
    job:   () => request('GET',  '/admin/illustrators'),
  },
},
  // ── Card Browser ──────────────────────────────────────────────────────────
  browse: {
    // filters: any of { pokemon, illustrator, set, rarity, type, kind, page }
    cards:   (filters = {}) => request('GET', `/browse?${new URLSearchParams(filters)}`),
    options: ()             => request('GET', '/browse/options'),
  },
  // ── Sealed product ────────────────────────────────────────────────────────
  sealed: {
    setOwned: (id, owned) => request('PATCH', `/sealed/${id}/owned`, { owned }),
  },
  // ── Card images & temporary exports ───────────────────────────────────────
  // Images load through our own backend so a canvas can draw them and export
  // the result (the card image CDN doesn't allow that directly).
  images: {
    cardBlob: async (cardId, size = 400) => {
      const res = await send(`${base()}/images/card/${cardId}?size=${size}`);
      return res.ok ? res.blob() : null;
    },
  },
  exports: {
    list:   () => request('GET', '/exports'),
    remove: (id) => request('DELETE', `/exports/${id}`),
    imageUrl: (id, n) => `${base()}/exports/${id}/${n}`,
    create: async (formData) => {
      const res = await send(`${base()}/exports`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `Request failed: ${res.status}`);
      return data;
    },
  },
  // ── Topps checklists ──────────────────────────────────────────────────────
  topps: {
    // kind: 'topps' | 'burger_king' | 'mini_tin' — which tab the checklists belong to
    sets:          (kind = 'topps')         => request('GET',    `/topps/sets?kind=${kind}`),
    set:           (id)                     => request('GET',    `/topps/sets/${id}`),
    createSet:     (name, kind = 'topps')   => request('POST',   '/topps/sets', { name, kind }),
    updateSet:     (id, data)               => request('PATCH',  `/topps/sets/${id}`, data),
    deleteSet:     (id)                     => request('DELETE', `/topps/sets/${id}`),
    addTable:      (setId, title)           => request('POST',   `/topps/sets/${setId}/tables`, { title }),
    updateTable:   (id, title)              => request('PATCH',  `/topps/tables/${id}`, { title }),
    deleteTable:   (id)                     => request('DELETE', `/topps/tables/${id}`),
    addVariant:    (tableId, name)          => request('POST',   `/topps/tables/${tableId}/variants`, { name }),
    updateVariant: (id, name)               => request('PATCH',  `/topps/variants/${id}`, { name }),
    deleteVariant: (id)                     => request('DELETE', `/topps/variants/${id}`),
    addCard:       (tableId, number, name)  => request('POST',   `/topps/tables/${tableId}/cards`, { number, name }),
    updateCard:    (id, number, name)       => request('PATCH',  `/topps/cards/${id}`, { number, name }),
    deleteCard:    (id)                     => request('DELETE', `/topps/cards/${id}`),
    pasteRows:     (tableId, text)          => request('POST',   `/topps/tables/${tableId}/paste`, { text }),
    // side: 'front' | 'back'; an empty url clears the picture
    setPicture:    (cardId, side, url)      => request('PUT',    `/topps/cards/${cardId}/picture`, { side, url }),
    // A picture from a file (a scan) instead of a link.
    uploadPicture: (cardId, side, file)     => uploadPicture(`/topps/cards/${cardId}/picture/upload`, file, { side }),
    startPictures: (setId, url)             => request('POST',   `/topps/sets/${setId}/pictures`, { url }),
    pictureJob:    (setId)                  => request('GET',    `/topps/sets/${setId}/pictures`),
    // state: 'none' (printing doesn't exist) | 'need' | 'have'
    setCell:       (cardId, variantId, state) => request('PUT',  '/topps/cells', { card_id: cardId, variant_id: variantId, state }),
  },
  // ── Coins ─────────────────────────────────────────────────────────────────
  coins: {
    generations:      ()                         => request('GET',    '/coins/generations'),
    generation:       (id)                       => request('GET',    `/coins/generations/${id}`),
    deleteGeneration: (id)                       => request('DELETE', `/coins/generations/${id}`),
    addCoin:          (genId, region, number, name) => request('POST', `/coins/generations/${genId}/coins`, { region, number, name }),
    // data: any of { number, name, released_in, release_date, description }
    updateCoin:       (id, data)                 => request('PATCH',  `/coins/${id}`, data),
    deleteCoin:       (id)                       => request('DELETE', `/coins/${id}`),
    // side: 'front' | 'back'; an empty url clears the picture
    setPicture:       (id, side, url)            => request('PUT',    `/coins/${id}/picture`, { side, url }),
    uploadPicture:    (id, side, file)           => uploadPicture(`/coins/${id}/picture/upload`, file, { side }),
    addVariety:       (coinId, name)             => request('POST',   `/coins/${coinId}/varieties`, { name }),
    // data: { name } and / or { owned }
    updateVariety:    (id, data)                 => request('PATCH',  `/coins/varieties/${id}`, data),
    deleteVariety:    (id)                       => request('DELETE', `/coins/varieties/${id}`),
    startImport:      (url)                      => request('POST',   '/coins/import', { url }),
    importJob:        ()                         => request('GET',    '/coins/import'),
  },
  // ── Bulk tracker ──────────────────────────────────────────────────────────
  bulk: {
    listings: () => request('GET', '/bulk/listings'),
    importFiles: async (formData) => {
      const res = await send(`${base()}/bulk/import`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `Request failed: ${res.status}`);
      return data;
    },
  },
  // ── Reports ───────────────────────────────────────────────────────────────
  reports: {
    topValuable:        () => request('GET', '/reports/top-valuable'),
    storageAuditSafe:      () => request('GET', '/reports/storage-audit-safe'),
    storageAuditToploader: () => request('GET', '/reports/storage-audit-toploader'),
  },
  // ── Android app ───────────────────────────────────────────────────────────
  // { versionCode, versionName } of the app build on the server ({} if none)
  app: {
    latest: () => request('GET', '/app/latest'),
  },
  // ── Uploaded pictures ─────────────────────────────────────────────────────
  // For picture fields in a form (logos, symbols): stores the file and answers
  // { url } to put in the field, which the form then saves like a link.
  uploads: {
    picture: (file) => uploadPicture('/uploads/picture', file),
  },
  // ── Grading ───────────────────────────────────────────────────────────────
  grading: {
    // A photo as the phone took it plus what was found in it, kept on the
    // server for tuning the photo steps (routes/gradingTests.js).
    sendTestPhoto: async (photo, meta) => {
      const formData = new FormData();
      formData.append('meta', JSON.stringify(meta));
      formData.append('photo', photo, `photo.${photo.type === 'image/png' ? 'png' : 'jpg'}`);
      const res = await send(`${base()}/grading/test-photos`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
      return data;
    },
    // Saved copies of cards (routes/gradingCopies.js)
    searchCards: (q) => request('GET', `/grading/cards/search?q=${encodeURIComponent(q)}`),
    queue: (limit = 30) => request('GET', `/grading/queue?limit=${limit}`),
    card: (id) => request('GET', `/grading/cards/${id}`),
    // meta: { cardId, slot, label, estimate, estimateLow, estimateHigh, result };
    // pictures: { front, frontThumb, back, backThumb } (JPEG blobs, any left out)
    saveCopy: async (meta, pictures) => {
      const formData = new FormData();
      formData.append('meta', JSON.stringify(meta));
      for (const [name, blob] of Object.entries(pictures)) if (blob) formData.append(name, blob, `${name}.jpg`);
      const res = await send(`${base()}/grading/copies`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || `Request failed: ${res.status}`);
      return data;
    },
    updateCopy: (id, changes) => request('PATCH', `/grading/copies/${id}`, changes),
    keepCopy: (id) => request('POST', `/grading/copies/${id}/keep`),
    deleteCopy: (id) => request('DELETE', `/grading/copies/${id}`),
  },
};

// The full address of a saved copy's picture (copy.images.* are paths under
// the API, e.g. /grading/images/12-front-ab12cd.jpg).
export const gradingImage = (p) => (p ? `${base()}${p}` : null);
