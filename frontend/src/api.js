// src/api.js
//
// Centralized API client. Every backend call goes through here.
//
// WHY: If you call fetch('/api/sets') directly in 10 components and the
// backend URL changes, you edit 10 files. Here you edit one.
// It also means error handling, headers, and base URL are consistent everywhere.
//
// The base URL comes from the Vite proxy in vite.config.js — all /api/*
// requests are forwarded to the backend container automatically.

const BASE = '/api';

async function request(method, path, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, options);

  // 204 No Content (e.g. successful DELETE) has no body — don't try to parse it
  if (res.status === 204) return null;

  const data = await res.json();

  // If the server returned an error status, throw so callers can catch it
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed: ${res.status}`);
  }

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
    excel:      (formData) => fetch(`${BASE}/import`, { method: 'POST', body: formData }).then(r => r.json()),
    collection: (formData) => fetch(`${BASE}/import/collection`, { method: 'POST', body: formData }).then(r => r.json()),
  },
  // ── Backup ────────────────────────────────────────────────────────────────
  backup: {
    run:      ()         => request('POST', '/backup/run'),
    list:     ()         => request('GET',  '/backup/list'),
    restore:  (formData) => fetch('/api/backup/restore', { method: 'POST', body: formData }).then(r => r.json()),
    download: (filename) => window.open(`/api/backup/download/${filename}`, '_blank'),
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
      const res = await fetch(`${BASE}/images/card/${cardId}?size=${size}`);
      return res.ok ? res.blob() : null;
    },
  },
  exports: {
    list:   () => request('GET', '/exports'),
    remove: (id) => request('DELETE', `/exports/${id}`),
    imageUrl: (id, n) => `${BASE}/exports/${id}/${n}`,
    create: async (formData) => {
      const res = await fetch(`${BASE}/exports`, { method: 'POST', body: formData });
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
    uploadPicture: async (cardId, side, file) => {
      const formData = new FormData();
      formData.append('side', side);
      formData.append('picture', file);
      const res = await fetch(`${BASE}/topps/cards/${cardId}/picture/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `Request failed: ${res.status}`);
      return data;
    },
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
      const res = await fetch(`${BASE}/bulk/import`, { method: 'POST', body: formData });
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
};
