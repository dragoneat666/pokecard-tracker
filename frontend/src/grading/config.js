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
    // either. A gentle curl mostly cancels out (both borders on that axis
    // shift alike): test photos of cards arched by up to 4 mm (edges bowing
    // 0.8 mm) moved the centering by at most 1 point, so this only warns
    // past 0.6 mm. (0.35 at first; phone photos of ordinary cards measured
    // 0.1-0.36.)
    bentWarnMm: 0.6,
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
      // The back of every card has the same printed frame, so its left +
      // right borders always add up to about the same width (mm), as do top +
      // bottom, however off-centre the card is (measured on phone photos of
      // backs: 6.24-6.37 and 6.93-6.98). If a back's pair is further off
      // than maxOffMm, one side was found in the wrong place (the swirl next
      // to the border is sometimes nearly the border's blue) and it is looked
      // for again where the frame has to be.
      backFrame: { leftRightMm: 6.3, topBottomMm: 6.95, maxOffMm: 1 },
      // On the front, a side found more than suspectMm deeper than the
      // middle of the other three is looked at again for a nearer edge
      // (a frame panel nearly the border's colour, see centering.js step 6):
      // one at least minShare as strong as where it stopped, that the lines
      // agree on (confidence at least minConfidence; holo sparkle makes most
      // candidates look fairly sure, so it only drops the worst).
      frontNearer: { suspectMm: 1.4, minShare: 0.25, minConfidence: 0.4, nearMm: 0.75 },
      // A print turned against the card's edges by less than this across the
      // card's width (mm) is taken as straight (centering.js rotationOf): the
      // crooked Charjabug is turned about 0.25 mm across.
      minTiltMm: 0.2,
    },
  },

  // Edges and corners: whitening (grading/edges.js).
  edges: {
    // Photo kept round the straightened card, so the background shows.
    marginMm: 1.2,
    // Edge strips for training a checker on another computer (vision.js
    // edgeStrips): every photo's 4 edges at the photo's own detail (px per
    // mm, kept between these), from outMm outside to inMm inside. The
    // server keeps them only until they're fetched.
    strips: { minPpm: 20, maxPpm: 40, outMm: 2, inMm: 2.5, quality: 0.9 },
    // Each line across the edge starts this far outside the card and reaches
    // this far in.
    outsideMm: 1,
    insideMm: 2.5,
    // Card corners are rounded to about this radius (measured on phone
    // photos: 2.5-3.5 mm, with the photo's own blur).
    cornerRadiusMm: 3,
    // A "Whitening" mark (the user's own, for a spot the check missed)
    // counts as a spot this big on the nearest edge or corner.
    markSpot: { lengthMm: 0.5, depthMm: 0.1 },
    // The card starts where the colour differs from the background outside
    // by more than this (0-441 RGB distance), 3 pixels in a row.
    minStep: 40,
    // The border's colour is read this far in from the card's edge (past
    // any wear), then smoothed along the edge over this distance each way.
    refFromMm: 1,
    refToMm: 1.6,
    refSmoothMm: 0.8,
    // Where that reading is darker than the edge's plain border colour (the
    // reading brighter than this share of all of them along the edge; print
    // in the border makes readings darker), the plain colour is used.
    usualShare: 0.8,
    // Whitening only shows against a background that isn't whitish: where
    // the background outside the edge has all its channels above this
    // (0-255; its darkest channel), the edge isn't read. (Judged by overall
    // brightness before, pink paper on the lamp's side failed it: 50-90% of
    // the outline went unread, so a glint in the other photo counted alone.)
    maxBackground: 110,
    // A pixel is whitened when it has moved at least this share of the way
    // from the border's colour towards white, and is this much brighter.
    // (Worn card stock came out 0.7-0.9 of the way on blue, yellow and
    // silver borders; the lighter outer band printed on some silver borders
    // about 0.4.)
    minWhite: 0.5,
    minLighter: 20,
    // On dark borders (border colour darker than darkBorder, 0-255) a tiny
    // fleck of whitening is blurred to grey in a phone photo: a 0.2 mm fleck
    // on a black border came out 0.35-0.55 of the way to white.
    darkBorder: 60,
    minWhiteDark: 0.3,
    // ...and the whitened stretch must be at least this much brighter than
    // the border just past its inner end (wear stops sharply; the sheen on a
    // silver border fades gradually and doesn't count).
    minStepIn: 20,
    // Whitening is looked for this deep from the edge.
    maxDepthMm: 1.2,
    // A spot: whitened at least this many pixels deep (0.05 mm each)...
    minDepthPx: 2,
    // ...along at least this much of the edge; spots closer together than
    // mergeMm count as one.
    minRunMm: 0.15,
    mergeMm: 0.5,
    // More than this share of the card blown out by glare gets a warning
    // (whitening can't be seen under it).
    glareWarnShare: 0.002,
    // The two photos' outlines may differ by this many pixels along an edge.
    alignPx: 3,
    // A turned photo matching the first less than this (edges.matchScore;
    // the same card scored 0.5-0.95, a blurred photo found wrong 0.37) is
    // turned away: "take it again".
    minMatch: 0.42,
    // Focus of the photo as taken (grading/sharpness.js, on the straightened
    // card): sharp photos scored 0.58-0.76, out-of-focus ones 0.39-0.45 (all
    // had passed the camera's check on its preview). Under minSharp the first
    // photo gets a warning and a turned one is turned away, as is a turned
    // one under minSharpShare of the first photo's score.
    minSharp: 0.5,
    minSharpShare: 0.8,
    // Possible nicks (edges.findNicks): the outline dipping in at least minPx
    // (0.05 mm each) below its median over windowMm either way, along
    // minRunMm-maxRunMm of a straight edge, in the same place in 2 or more
    // photos (the others need only a faint dip: weakPx along weakRunMm), with
    // at least minPale px of whitening in it in one photo. A photo that
    // guessed the edge on more than maxGuess of a side doesn't vote there.
    // Listed for the user to check, not counted until confirmed.
    nicks: { minPx: 2, windowMm: 2, minRunMm: 0.4, maxRunMm: 3, weakPx: 1, weakRunMm: 0.15, minPale: 1, maxGuess: 0.05 },
    // Nicks confirmed (or added by hand) per side, the most each grade
    // allows. A rough guide: graders allow no nicks on a 10.
    nickGrades: [{ grade: 10, nicks: 0 }, { grade: 9, nicks: 1 }, { grade: 8, nicks: 3 }, { grade: 7, nicks: 6 }],
    // With one photo, an edge with "whitening" along more than this share of
    // its length is probably glinting in the light: it and its corners are
    // "in doubt" and not counted. (On phone photos of pack-fresh backs,
    // glinting edges came out at 0.2-0.4 and the others under 0.05.)
    litShare: 0.1,
    // The most whitening each grade allows, per side of the card: the total
    // length of all spots (mm) and the deepest spot (mm). A rough guide
    // only: graders judge wear by eye, and are more forgiving on the back.
    grades: [
      { grade: 10, front: { lengthMm: 0.5, depthMm: 0.2 }, back: { lengthMm: 1.5, depthMm: 0.2 } },
      { grade: 9,  front: { lengthMm: 2,   depthMm: 0.3 }, back: { lengthMm: 5,   depthMm: 0.3 } },
      { grade: 8,  front: { lengthMm: 5,   depthMm: 0.5 }, back: { lengthMm: 12,  depthMm: 0.5 } },
      { grade: 7,  front: { lengthMm: 12,  depthMm: 0.8 }, back: { lengthMm: 25,  depthMm: 0.8 } },
      { grade: 6,  front: { lengthMm: 25,  depthMm: 1.2 }, back: { lengthMm: 50,  depthMm: 1.2 } },
    ],
    floor: 5,
    // Close call: the numbers this much either way (a share of the length,
    // plus closeMinMm, and closeDepthMm of depth) would give another grade.
    closeShare: 0.25,
    closeMinMm: 0.3,
    closeDepthMm: 0.05,
  },

  // The surface is judged by eye (a phone photo can't show fine scratches or
  // dents): a short checklist per side, each thing None / Slight / Obvious.
  // `caps` is the best grade allowed with it [slight, obvious]. A rough guide,
  // the same for front and back.
  surface: {
    items: [
      { id: 'scratches', label: 'Scratches or scuffs', hint: 'tilt the card under a light to see them', caps: [9, 7] },
      { id: 'printLines', label: 'Print lines or dots', hint: 'from the factory: thin lines or specks in the print', caps: [9, 8] },
      { id: 'dents', label: 'Dents or dimples', hint: 'small pressed-in spots, seen with the card at an angle', caps: [8, 6] },
      { id: 'marks', label: 'Marks, stains or writing', caps: [8, 5] },
      { id: 'creases', label: 'Creases or bends', hint: 'a line across the card, or a bend that stays', caps: [5, 3] },
    ],
    floor: 3,
  },

  // Comparing two copies of a card (grading/compare.js): when both get the
  // same estimate, the smaller differences below decide, as long as they are
  // bigger than these (smaller ones are within what a photo can tell).
  compare: {
    frontCenteringPoints: 2,     // 55/45 vs 57/43
    backCenteringPoints: 5,
    frontWhiteningMm: 1,         // and at least a quarter more
    backWhiteningMm: 3,
    share: 0.25,
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
