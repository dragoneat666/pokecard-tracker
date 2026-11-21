// grading/analyzers.js — The list of things a card is checked for
//
// Each check ("analyzer") is one entry here, all with the same shape, so new
// ones can be added later without changing the pages — for example a surface
// check done by a paid AI service or by a graphics card on another computer.
// Those would be async and could be slow; the shape allows for that.
//
//   id        short name, saved with every result ('centering')
//   version   bump when the analyzer's maths changes, so old saved results
//             can be told apart from new ones (and re-run if wanted)
//   label     shown on the page
//   find(image, settings, { face })    -> a first guess the user can adjust
//                                          (for centering: the 8 border lines);
//                                          face: 'front' | 'back'
//   measure(state, settings)           -> numbers from the (adjusted) guess
//   cap({ front, back }, settings)     -> { cap, low, high, reason } — the best
//                                          grade this check allows, from both
//                                          sides' measurements
//
// `image` is always a straightened card side (ImageData, 1260 x 1760).
// Nothing in here may be random: the same photo and the same adjustments must
// always give the same answer.

import { CENTERING_VERSION, findBorders, measure as measureCentering, slopesInUse, centeringCap } from './centering.js';
import { EDGES_VERSION, scanEdges, findSpots, doubtTracksOf, measureEdges, edgesCap } from './edges.js';

export const ANALYZERS = [
  {
    id: 'centering',
    version: CENTERING_VERSION,
    label: 'Centering',
    find: (image, settings, options) => findBorders(image, settings, options),
    // state: { lines, foundLines, slopes, followTilt, noBorder }
    measure: (state, settings) => measureCentering(state.lines, settings.image.pxPerMm,
      { slopes: slopesInUse(state, settings.image.pxPerMm), noBorder: state.noBorder }),
    cap: ({ front, back }, settings) => centeringCap(front, back, settings),
  },
  {
    // Whitening on the edges and corners. `image` here is the straightened
    // card WITH a margin of photo round it (options.margin pixels), and a
    // second photo (turned a quarter turn) can be combined in first; the
    // Grading page does that itself (grading/edges.js).
    id: 'edges',
    version: EDGES_VERSION,
    label: 'Edges and corners',
    find: (image, settings, { margin }) => {
      const scan = scanEdges(image, margin, settings);
      return { scan, spots: findSpots(scan, settings), doubtTracks: doubtTracksOf(scan, settings), ignored: [] };
    },
    measure: (state) => measureEdges(state.spots, state.ignored, state.doubtTracks),
    cap: ({ front, back }, settings) => edgesCap(front, back, settings),
  },
];

export const analyzer = (id) => ANALYZERS.find(a => a.id === id);

// What gets saved with a result, so it can be explained later.
export const analyzerVersions = () => Object.fromEntries(ANALYZERS.map(a => [a.id, a.version]));
