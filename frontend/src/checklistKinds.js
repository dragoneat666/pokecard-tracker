// checklistKinds.js — The tabs that use the hand-built checklist engine
//
// Topps, Burger King cards and mini tin art cards are all checklists of tables edited like a
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
  mini_tin: {
    title: 'Mini Tin Art',
    path: '/mini-tins',
    badge: 'MINI TINS',
    blurb: 'the art cards from the mini tins that line up into one big picture',
    example: 'Scarlet & Violet 151 Mini Tins',
    bulbapediaPictures: false,     // no Bulbapedia list to match against; pictures are pasted or uploaded
  },
};

export const kindOf = kind => CHECKLIST_KINDS[kind] || CHECKLIST_KINDS.topps;
