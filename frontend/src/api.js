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
    mcapId: () => request('GET', '/sets/mcap-id'),
    searchOwnCards: (id, q) => request('GET', `/sets/${id}/search-own-cards?q=${encodeURIComponent(q)}`),
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
  seriesMap: {
    list:   ()                     => request('GET',    '/admin/series-map'),
    add:    (set_code, series)     => request('POST',   '/admin/series-map', { set_code, series }),
    update: (set_code, data)       => request('PATCH',  `/admin/series-map/${set_code}`, data),
    delete: (set_code)             => request('DELETE', `/admin/series-map/${set_code}`),
  },
},
};
