// grading/config.js — Default settings for the pre-grade / compare-copies tool
//
// Every number that decides a result lives here, so tuning never means hunting
// through code. These are the defaults; edited values (from the tuning page)
// are laid over them with mergeSettings(), and every saved result keeps a copy
// of the settings it was worked out with, so an old result can always be
// explained (and repeated) even after the settings change.
//
// This is an estimate, not a grade. Only PSA's 10 centering numbers are firmly
// published; the rest are the commonly quoted approximations.

export const GRADING_DEFAULTS = {
  // The straightened card is always this size: 20 pixels per millimetre on a
  // 63 x 88 mm card. Fixed so measurements from different photos line up.
  image: { width: 1260, height: 1760, pxPerMm: 20 },

  // Checks on the photo itself, shown as warnings (they don't change results).
  photo: {
    // A side whose edge bows more than this (mm, middle vs. straight) means
    // the card is bent: it isn't flat, so the straightened picture isn't
    // either, and the border lines shift. 0.35 mm is about a tenth of a
    // typical 3 mm border.
    bentWarnMm: 0.35,
    // Fewer pixels per mm of card than this and the straightened card is
    // blown up from a small picture (soft).
    minDetailPxPerMm: 15,
  },

  centering: {
    // For each grade, the most lopsided centering allowed, as the bigger
    // side's share: 55 means 55/45. Front and back are separate because
    // graders are far more forgiving on the back. The worse of left/right and
    // top/bottom counts. Read top to bottom: the first row the card fits is
    // its centering cap.
    grades: [
      { grade: 10, front: 55, back: 75 },
      { grade: 9,  front: 60, back: 90 },
      { grade: 8,  front: 65, back: 90 },
      { grade: 7,  front: 75, back: 90 },   // PSA quotes 70/30 to 75/25 for a 7
      { grade: 6,  front: 80, back: 90 },
      { grade: 5,  front: 85, back: 90 },
    ],
    floor: 4,              // worse than every row: "4 or lower"
    // A share this close to a limit could be either side of it once photo
    // blur and a pixel or two of line placement are counted (1 px is about
    // 0.8 points of share), so the estimate shows both grades.
    closeCall: 1.5,

    // Finding the inner border line (where the plain border meets the art):
    border: {
      // The border's colour is learned from a strip this far in from the
      // card's edge (in mm), along the middle part of every side. It starts a
      // little way in so edge wear and any background left at the edge don't
      // count.
      learnFromMm: 0.5,
      learnToMm: 1.2,
      // Each side is read along this middle share of its length (corners and
      // their rounding are left out).
      middleShare: 0.6,
      // Look for the art's edge no further in than this share of the card's
      // width / height.
      maxShare: 0.2,
      // A pixel counts as "not border" when its colour differs from the
      // border's by at least this much (0-441 RGB distance), or by this many
      // times the border's own variation, whichever is bigger.
      minDistance: 30,
      noiseFactor: 5,
      // ...and it must stay different for this many pixels in a row (so a
      // speck of dust in the border doesn't count as the art's edge).
      runLength: 4,
      // The frame's rough position along a side is the first depth where this
      // share of the lines across the side have left the border colour. High,
      // because the frame's edge crosses every line, while small print in the
      // border (the copyright line on newer cards) crosses only some.
      roughShare: 0.8,
      // The exact edge is the strongest colour change (averaged over the
      // lines) within this distance of the rough position, in mm...
      windowMm: 0.75,
      // ...but looking back towards the card's edge only while at least this
      // share of the lines are still "not border" (so print in the border,
      // which has plain border between it and the frame, stays out).
      reachShare: 0.3,
      // Of the changes found there, the one nearest the card's edge that is at
      // least this share of the strongest is taken: a frame's own thin edge
      // line (a highlight along the panel) belongs to the frame.
      outerEdgeShare: 0.7,
      // Each line then takes its own strongest change within this many pixels
      // of the side's edge (allows for a frame printed a little crooked),
      // and is left out if that change is under this share of the average.
      lineReachPx: 2,
      lineMinShare: 0.3,
    },
  },
};

// Settings = defaults with any saved overrides laid on top (deep merge; arrays
// are replaced whole).
export function mergeSettings(overrides, base = GRADING_DEFAULTS) {
  if (!overrides || typeof overrides !== 'object') return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(overrides)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = mergeSettings(v, out[k]);
    } else {
      out[k] = structuredClone(v);
    }
  }
  return out;
}

// Settings tried out on the tuning page (/grading/lab) are kept in this
// browser only, and the Grading page uses them too, so a change can be tried
// on real cards. (Saved, shared settings come with the saved copies.)
export const LAB_SETTINGS_KEY = 'pokecard.grading.labSettings';

export function labOverrides() {
  try { return JSON.parse(localStorage.getItem(LAB_SETTINGS_KEY)) || {}; } catch { return {}; }
}
