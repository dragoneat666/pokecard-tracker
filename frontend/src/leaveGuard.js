// leaveGuard.js — "Leave this check?" before unsaved work is lost.
//
// The Grading page sets a message while a check has photos or results that
// aren't saved (useLeaveGuard). Then the phone's back button and the
// browser's Back, the top-bar links, and reloading the page all ask first.
// (The Android app's back button walks back through the WebView's history,
// so an extra history step is added for it to use up, and asking happens
// when that step is popped.)

import { useEffect } from 'react';

let message = null;

// For links elsewhere (the top bar): false if the user chose to stay.
export function okToLeave() {
  if (!message) return true;
  if (!window.confirm(message)) return false;
  message = null;
  return true;
}

export function useLeaveGuard(on, text) {
  useEffect(() => {
    if (!on) return undefined;
    message = text;
    window.history.pushState({ ...window.history.state, leaveGuard: true }, '');
    const onPop = () => {
      if (!message) return;
      if (window.confirm(message)) {
        message = null;
        window.history.back();              // really go back, past the page
      } else {
        window.history.pushState({ ...window.history.state, leaveGuard: true }, '');
      }
    };
    const onUnload = (e) => { if (message) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onUnload);
      message = null;
      // saved, or finished some other way while still on the page: take the
      // extra history step back out, so Back isn't needed twice later
      if (window.history.state?.leaveGuard) window.history.back();
    };
  }, [on, text]);
}
