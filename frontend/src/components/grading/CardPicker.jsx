// components/grading/CardPicker.jsx — Pick which card is being checked
//
// A search box (name, number or set; every word must match) and, under it,
// the cards you have 2 copies of that haven't been compared yet, most
// valuable first. onPick(card, slot) with slot 'regular' or 'reverse'.

import { useEffect, useState } from 'react';
import { api } from '../../api.js';

export default function CardPicker({ onPick, showQueue = true }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!showQueue) return;
    api.grading.queue(30).then(setQueue, err => setError(err.message));
  }, [showQueue]);

  // search a moment after typing stops
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setFound(null); return undefined; }
    const timer = setTimeout(() => {
      api.grading.searchCards(text).then(r => setFound(r.cards), err => setError(err.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Find a card: name, number or set (e.g. Charizard 4/102)" />
      {error && <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
      {found && (
        found.length === 0
          ? <p style={{ margin: 0, color: 'var(--text-muted)' }}>No cards match.</p>
          : <CardList cards={found} onPick={onPick} />
      )}
      {showQueue && !found && queue && (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {queue.total
              ? <>You have 2 copies of <b>{queue.total}</b> card{queue.total === 1 ? '' : 's'} not compared yet{queue.total > queue.cards.length ? ` (the ${queue.cards.length} most valuable below)` : ''}:</>
              : 'Every card you have 2 copies of has been compared.'}
          </div>
          <CardList cards={queue.cards} onPick={onPick} queue />
        </div>
      )}
    </div>
  );
}

function CardList({ cards, onPick, queue = false }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {cards.map(card => {
        const slot = card.slot || 'regular';
        const price = queue ? card.price : card.market_price;
        return (
          <button key={`${card.id}-${slot}`} type="button" className="btn btn-ghost"
            style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', textAlign: 'left', justifyContent: 'flex-start', padding: 6 }}
            onClick={() => onPick(card, slot)}>
            {card.image_url
              ? <img src={card.image_url} alt="" loading="lazy" style={{ width: 36, height: 50, objectFit: 'cover', borderRadius: 3, flex: 'none' }} />
              : <span style={{ width: 36, flex: 'none' }} />}
            <span style={{ display: 'grid', minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.name}{slot === 'reverse' ? ` (${reverseName(card)})` : ''}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.set_name} · {card.card_number}
                {price ? ` · $${Number(price).toFixed(2)}` : ''}
                {card.copies ? ` · ${card.copies} saved` : ''}
                {!queue && ` · own ${card.owned}`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const reverseName = (card) => (card.variant_type === 'first_edition' ? '1st Edition' : 'Reverse Holo');
