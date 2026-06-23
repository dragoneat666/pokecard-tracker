// components/CardRow.jsx — A single card row in the set table
//
// This component owns the checkbox UI logic:
//   - Common/Uncommon/Holo/Energy: one checkbox (owned = 0 or 1)
//   - Rare/Full Art/etc.:          two checkboxes (owned = 0, 1, or 2)
//   - Checking box 2 automatically checks box 1 first
//   - Unchecking box 1 clears both

import { memo, useState } from 'react';
import { isCollectorRarity, rarityMeta, formatPrice } from '../rarity.js';


// memo() is a React optimization — this component only re-renders if its
// props actually changed. For a table with 200+ rows, this matters.
const CardRow = memo(function CardRow({ card, zebra, variantType, showVariantCol, showNotesCol, onOwnedChange, onReverseOwnedChange, onStorageChange, onConditionChange }) {
  const [hovered, setHovered] = useState(false);
  const collector = isCollectorRarity(card.rarity);
  const { color: rarityColor, label: rarityLabel } = rarityMeta(card.rarity);

  // ── Checkbox handlers ─────────────────────────────────────────────────────
  // Box 1: toggles between owned=0 and owned=1 (or owned=2 if box 2 was checked)
  function handleBox1Click() {
    if (card.owned === 0) {
      onOwnedChange(card.id, 1);
    } else {
      // Unchecking box 1 clears both boxes
      onOwnedChange(card.id, 0);
    }
  }

  // Box 2 (collector cards only): toggles between owned=1 and owned=2
  function handleBox2Click() {
    if (card.owned < 2) {
      // Clicking box 2 implies box 1 is also checked
      onOwnedChange(card.id, 2);
    } else {
      onOwnedChange(card.id, 1);
    }
  }

  // Reverse holo checkbox: simple toggle 0/1
  function handleReverseClick() {
    onReverseOwnedChange(card.id, card.reverse_owned >= 1 ? 0 : 1);
  }

  // ── Computed values ───────────────────────────────────────────────────────
  const totalValue   = card.market_price  && card.owned   >= 1
    ? parseFloat(card.market_price)  * card.owned
    : null;
  const revTotal = card.reverse_holo_price && card.reverse_owned >= 1
    ? parseFloat(card.reverse_holo_price) * card.reverse_owned
    : null;

  const typeColor = TYPE_COLORS[card.pokemon_type] || 
    Object.entries(TYPE_COLORS).find(([key]) => card.pokemon_type?.includes(key))?.[1] || null;
  const rowBg = hovered
    ? 'var(--bg-elevated)'
    : typeColor
      ? (card.owned >= 1 ? typeColor + '35' : typeColor + '20')
      : (zebra ? 'var(--bg-elevated)' : 'transparent');

  return (
    <tr style={{
      background: rowBg,
      borderBottom: '1px solid var(--border)',
      transition: 'background var(--transition)',
    }}
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    >
      {/* Card number */}
      <td style={tdStyle}>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '0.8rem', fontWeight: 700 }}>
          {card.card_number}
        </span>
      </td>

      {/* Name */}
      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {card.name}
      </td>

      {/* Type */}
      <td style={tdStyle}>
        {card.pokemon_type ? (
          <TypePip type={card.pokemon_type} />
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>

      {/* Rarity badge */}
      <td style={tdStyle}>
        <span className="rarity-badge" style={{
          background: rarityColor + '22',  // 22 = ~13% opacity in hex
          color: rarityColor,
          border: `1px solid ${rarityColor}44`,
          fontWeight: 700,
        }}>
          {rarityLabel}
        </span>
      </td>

      {/* Own checkboxes */}
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Box 1 — always present */}
          <Checkbox
            checked={card.owned >= 1}
            onClick={handleBox1Click}
            title="Own 1 copy"
          />
          {/* Box 2 — only for collector rarities */}
          {collector && (
            <Checkbox
              checked={card.owned >= 2}
              onClick={handleBox2Click}
              title="Own 2nd copy"
              dim={card.owned < 1}  // Dim box 2 if box 1 isn't checked
            />
          )}
        </div>
      </td>

      {/* Reverse holo / First edition checkbox */}
      {showVariantCol && (
        <td style={tdStyle}>
          {(variantType === 'first_edition' ? card.has_first_edition : card.has_reverse_holo) ? (
            <Checkbox
              checked={card.reverse_owned >= 1}
              onClick={handleReverseClick}
              title={variantType === 'first_edition' ? 'Own first edition' : 'Own reverse holo'}
              color="var(--rarity-holo)"
            />
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>
      )}

      {/* Storage dropdown */}
      <td style={tdStyle}>
        <select
          className="input"
          value={card.storage}
          onChange={e => onStorageChange(card.id, e.target.value)}
          style={{ padding: '3px 6px', fontSize: '0.78rem', width: 'auto', minWidth: 90 }}
        >
          <option value="binder">Binder</option>
          <option value="sleeve">Sleeve</option>
          <option value="toploader">Toploader</option>
          <option value="safe">Safe</option>
        </select>
      </td>

      {/* Condition */}
      <td style={tdStyle}>
        <select
          className="input"
          value={card.condition || 'Near Mint'}
          onChange={e => onConditionChange(card.id, e.target.value)}
          style={{ padding: '3px 6px', fontSize: '0.78rem', width: 'auto', minWidth: 70 }}
        >
          <option value="Near Mint">NM</option>
          <option value="Lightly Played">LP</option>
          <option value="Moderately Played">MP</option>
          <option value="Heavily Played">HP</option>
          <option value="Damaged">D</option>
        </select>
      </td>

      {/* Market price */}
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)' }}>
        <span style={{ color: card.market_price ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {formatPrice(card.market_price)}
        </span>
      </td>

      {/* Total value (price × owned) */}
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)' }}>
        <span style={{ color: totalValue ? 'var(--success)' : 'var(--text-muted)' }}>
          {formatPrice(totalValue)}
        </span>
      </td>

      {showVariantCol && (
        <>
          {/* Reverse holo price */}
          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)' }}>
            <span style={{ color: card.reverse_holo_price ? 'var(--rarity-holo)' : 'var(--text-muted)' }}>
              {formatPrice(card.reverse_holo_price)}
            </span>
          </td>

          {/* Reverse holo total */}
          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)' }}>
            <span style={{ color: revTotal ? 'var(--rarity-holo)' : 'var(--text-muted)' }}>
              {formatPrice(revTotal)}
            </span>
          </td>
        </>
      )}

      {/* Notes — alternates table only */}
      {showNotesCol && (
        <td style={{ ...tdStyle, maxWidth: 220 }}>
          {card.notes ? (
            card.notes_url ? (
              <a
                href={card.notes_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'underline', fontSize: '0.8rem' }}
              >
                {card.notes}
              </a>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{card.notes}</span>
            )
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>
      )}
    </tr>
  );
});

export default CardRow;

// ── Checkbox ─────────────────────────────────────────────────────────────────
// Custom checkbox — styled to match the dark theme.
// We use a div+onClick rather than <input type="checkbox"> for full style control.
function Checkbox({ checked, onClick, title, dim = false, color = 'var(--success)' }) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={onClick}
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        border: `2px solid ${checked ? color : 'rgba(255,255,255,0.5)'}`,
        background: checked ? color : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all var(--transition)',
        opacity: dim ? 0.3 : 1,
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  );
}

// ── Type Pip ─────────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  Fire:       '#F08030', Water:      '#6890F0', Grass:    '#78C850',
  Lightning:  '#F8D030', Psychic:    '#F85888', Fighting: '#C03028',
  Darkness:   '#705848', Metal:      '#B8B8D0', Dragon:   '#7038F8',
  Colorless:  '#A8A878', Fairy:      '#EE99AC', Trainer:    '#F5DC93',
};

function TypePip({ type }) {
  const color = TYPE_COLORS[type] || 
    Object.entries(TYPE_COLORS).find(([key]) => type?.includes(key))?.[1] || '#8b92b8';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 99,
      fontSize: '0.75rem',
      fontWeight: 700,
      background: color + '40',
      color: color,
      border: `1px solid ${color}44`,
      fontFamily: 'var(--font-display)',
    }}>
      {type}
    </span>
  );
}

const tdStyle = {
  padding: '8px 12px',
  fontSize: '0.85rem',
  verticalAlign: 'middle',
};
