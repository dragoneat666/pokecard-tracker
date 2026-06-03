// hooks/useToast.js
//
// A custom React hook for showing brief notification messages.
// Used like: const { toast, showToast } = useToast()
// Then: showToast('Prices updated!', 'success')
//
// WHAT IS A HOOK?
// A hook is a function whose name starts with "use" that can use React state.
// Custom hooks let you extract stateful logic out of components so it's
// reusable — instead of copy-pasting useState/useEffect everywhere.

import { useState, useCallback } from 'react';

export function useToast() {
  const [toast, setToast] = useState(null);
  // toast = { message: string, type: 'success' | 'error' | 'info' } | null

  const showToast = useCallback((message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    // Auto-dismiss after duration ms
    setTimeout(() => setToast(null), duration);
  }, []);

  return { toast, showToast };
}
