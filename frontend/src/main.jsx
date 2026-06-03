// main.jsx — React's entry point
//
// This file's only job is to find the <div id="root"> in index.html
// and mount the React app into it. Everything else flows from App.jsx.

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode runs your components twice in development to help catch bugs.
  // It has no effect in production builds.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
