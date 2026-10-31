// components/UploadPictureButton.jsx — "⬆ Upload" next to a picture URL box in a form
//
// For the logo / symbol fields in the Edit Set and Edit Checklist modals: picks
// a picture file, stores it on the server, and hands back its URL to put in the
// box. Saving the form then keeps that URL like any pasted link.

import { useState, useRef } from 'react';
import { api } from '../api.js';

export default function UploadPictureButton({ onUploaded, onError }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  async function pickFile(e) {
    const file = e.target.files[0];
    e.target.value = '';             // so the same file can be picked again
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploads.picture(file);
      onUploaded(url);
    } catch (err) {
      onError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        title="Upload a picture file instead of pasting a link"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        style={{ flexShrink: 0 }}
      >
        {uploading ? 'Uploading…' : '⬆ Upload'}
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: 'none' }} onChange={pickFile} />
    </>
  );
}
