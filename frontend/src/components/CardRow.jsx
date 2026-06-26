// components/CardRow.jsx — A single card row in the set table
//
// This component owns the checkbox UI logic:
//   - Common/Uncommon/Holo/Energy: one checkbox (owned = 0 or 1)
//   - Rare/Full Art/etc.:          two checkboxes (owned = 0, 1, or 2)
//   - Checking box 2 automatically checks box 1 first
//   - Unchecking box 1 clears both

import { memo, useState } from 'react';
import { isCollectorRarity, rarityMeta, formatPrice } from '../rarity.js';

const GRADE_OPTIONS = [
  '10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5',
  '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1',
  ];
  const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'ACE', 'TAG'];

// memo() is a React optimization — this component only re-renders if its
// props actually changed. For a table with 200+ rows, this matters.
const CardRow = memo(function CardRow({
  card, zebra, variantType, showVariantCol, showNotesCol,
  onOwnedChange, onReverseOwnedChange, onStorageChange, onConditionChange, onGradedChange,
  onCheckGradedPrices, checkingGradedId, gradedResultsCardId, gradedOptions, gradedError, onSelectGradedOption, onCloseGradedResults,
}) {
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

      {/* Graded company */}
      <td style={tdStyle}>
        <select
          className="input"
          value={card.grading_company || ''}
          onChange={e => onGradedChange(card.id, { grading_company: e.target.value || null })}
          style={{ padding: '3px 6px', fontSize: '0.78rem', width: 'auto', minWidth: 90 }}
        >
          <option value="">Ungraded</option>
          {GRADING_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>

      {/* Grade + graded price */}
      <td style={tdStyle}>
        {card.grading_company ? (
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select
                className="input"
                value={card.grade || ''}
                onChange={e => onGradedChange(card.id, { grade: e.target.value || null })}
                style={{ padding: '3px 4px', fontSize: '0.78rem', width: 'auto', minWidth: 56 }}
              >
                <option value="">Grade</option>
                {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="$"
                value={card.graded_price ?? ''}
                onChange={e => onGradedChange(card.id, { graded_price: e.target.value ? parseFloat(e.target.value) : null })}
                style={{ padding: '3px 4px', fontSize: '0.78rem', width: 70 }}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onCheckGradedPrices(card.id)}
                disabled={checkingGradedId === card.id}
                title="Check eBay graded sale prices"
                style={{ padding: '2px 6px', fontSize: '0.72rem' }}
              >
                {checkingGradedId === card.id ? '…' : '🔍'}
              </button>
            </div>

            {gradedResultsCardId === card.id && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 20,
                marginTop: 4, padding: 'var(--space-2)',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                minWidth: 220, maxHeight: 240, overflowY: 'auto',
              }}>
                {gradedError ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--danger)', padding: 4 }}>{gradedError}</div>
                ) : gradedOptions && gradedOptions.length > 0 ? (
                  <>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>eBay sold prices:</div>
                    {gradedOptions.map(opt => (
                      <div
                        key={`${opt.company}-${opt.gradeNum}`}
                        onClick={() => onSelectGradedOption(card.id, opt)}
                        style={{
                          padding: '4px 6px', fontSize: '0.78rem', cursor: 'pointer',
                          borderRadius: 4, display: 'flex', justifyContent: 'space-between', gap: 8,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <span><strong>{opt.company}</strong> {opt.gradeNum}</span>
                        <span>${opt.price.toFixed(2)} <span style={{ color: 'var(--text-muted)' }}>({opt.sampleSize})</span></span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: 4 }}>
                    No graded sales data found for this card.
                  </div>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onCloseGradedResults()}
                  style={{ marginTop: 4, fontSize: '0.7rem', width: '100%' }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>

      {/* Market price (or graded price if this card is graded) */}
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)' }}>
        <span style={{ color: (card.is_graded ? card.graded_price : card.market_price) ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {formatPrice(card.is_graded ? card.graded_price : card.market_price)}
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
