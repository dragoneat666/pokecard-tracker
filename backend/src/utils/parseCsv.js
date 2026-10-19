// utils/parseCsv.js — Minimal RFC 4180 CSV parser
//
// The older import route splits lines on newlines and commas, which breaks on
// quoted fields containing commas (card names like "Professor's Research,
// Turo"). This handles quotes, escaped quotes (""), CRLF and a leading BOM.
// Returns an array of objects keyed by the header row.

export function parseCsvObjects(text) {
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      records.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter(r => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
    return obj;
  });
}
