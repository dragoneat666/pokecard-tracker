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
  },

  // ── Cards ──────────────────────────────────────────────────────────────────
  cards: {
    setOwned:        (id, owned)    => request('PATCH', `/cards/${id}/owned`,         { owned }),
    setReverseOwned: (id, owned)    => request('PATCH', `/cards/${id}/reverse-owned`, { owned }),
    setStorage:      (id, storage)  => request('PATCH', `/cards/${id}/storage`,       { storage }),
    setExtra:        (id, hasExtra) => request('PATCH', `/cards/${id}/extra`,         { has_extra: hasExtra }),
    create:          (data)         => request('POST',  '/cards',                     data),
    delete:          (id)           => request('DELETE',`/cards/${id}`),
  },

  // ── Prices ────────────────────────────────────────────────────────────────
  prices: {
    refresh: (setId)  => request('POST', `/prices/refresh/${setId}`),
    history: (cardId) => request('GET',  `/prices/history/${cardId}`),
  },

  // ── Import ────────────────────────────────────────────────────────────────
  import: {
    excel: (formData) => fetch(`${BASE}/import`, { method: 'POST', body: formData })
                          .then(r => r.json()),
  },
};
