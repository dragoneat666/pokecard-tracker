// checklistKinds.js — The tabs that use the hand-built checklist engine
//
// Topps and Burger King cards are both checklists of tables edited like a
// sheet (pages/Topps.jsx and pages/ToppsSet.jsx); each checklist has a kind
// saying which tab it belongs to. This is what differs between the tabs.

export const CHECKLIST_KINDS = {
  topps: {
    title: 'Topps',
    path: '/topps',
    badge: 'TOPPS',
    blurb: 'what you have and need of the Topps Pokémon cards',
    example: 'Topps Series 2',
    bulbapediaPictures: true,      // the "Card pictures from Bulbapedia" panel works on these pages
  },
  burger_king: {
    title: 'Burger King Cards',
    path: '/burger-king',
    badge: 'BURGER KING',
    blurb: 'what you have and need of the Burger King Pokémon cards',
    example: 'Burger King PokéTrivia Cards',
    bulbapediaPictures: false,     // its Bulbapedia page reuses numbers across tables, so matching can't work
  },
};

export const kindOf = kind => CHECKLIST_KINDS[kind] || CHECKLIST_KINDS.topps;
