// db.js - API-backed data layer
// TraceMate
// Persistent authentication token + API data access

const TOKEN_KEY = 'tm_token';
const SESSION_KEY = 'tm_session';
const API_BASE_KEY = 'tm_api_base';

// ---------------------------------------------------------
// AUTH TOKEN
// ---------------------------------------------------------

// IMPORTANT:
// Restore the token from localStorage when the page loads.
// This fixes:
// Login -> Refresh -> Login page
let authToken = '';

try {
  authToken = localStorage.getItem(TOKEN_KEY) || '';
} catch (error) {
  console.warn('Unable to restore authentication token:', error);
  authToken = '';
}

// ---------------------------------------------------------
// BASIC HELPERS
// ---------------------------------------------------------

function genId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d) {
  if (!d) return '';

  const date = new Date(d);

  if (Number.isNaN(date.getTime())) {
    return String(d);
  }

  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------
// AUTH TOKEN FUNCTIONS
// ---------------------------------------------------------

function getAuthToken() {
  // Use memory first.
  // If memory is empty, recover from localStorage.
  if (authToken) {
    return authToken;
  }

  try {
    authToken = localStorage.getItem(TOKEN_KEY) || '';
  } catch (error) {
    console.warn('Unable to read authentication token:', error);
  }

  return authToken;
}

function setAuthToken(token) {
  authToken = token || '';

  try {
    if (authToken) {
      localStorage.setItem(TOKEN_KEY, authToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (error) {
    console.warn('Unable to save authentication token:', error);
  }
}

function getStoredAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (error) {
    console.warn('Unable to read stored authentication token:', error);
    return '';
  }
}

// ---------------------------------------------------------
// API BASE URL
// ---------------------------------------------------------

function getApiBaseUrl() {
  try {
    // When opening the frontend through file://,
    // use the local TraceMate backend.
    if (
      window.location &&
      window.location.protocol === 'file:'
    ) {
      return 'http://localhost:5000';
    }

    // If a custom API base has been saved, use it.
    const savedBase = localStorage.getItem(API_BASE_KEY);

    if (savedBase) {
      return savedBase.replace(/\/+$/, '');
    }
  } catch (error) {
    console.warn('Unable to read API base URL:', error);
  }

  // Normal development setup.
  return 'http://localhost:5000';
}

function apiUrl(pathname) {
  const base = getApiBaseUrl();

  if (!pathname) {
    return base;
  }

  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }

  return `${base}${pathname}`;
}

// ---------------------------------------------------------
// SYNCHRONOUS API REQUEST
// ---------------------------------------------------------

function requestSync(
  method,
  url,
  body = null,
  auth = false
) {
  /*
   * This function is kept compatible with the existing
   * TraceMate application.
   */

  const xhr = new XMLHttpRequest();

  xhr.open(method, url, false);

  xhr.setRequestHeader(
    'Content-Type',
    'application/json'
  );

  const token = getAuthToken();

  if (auth || token) {
    if (token) {
      xhr.setRequestHeader(
        'Authorization',
        `Bearer ${token}`
      );
    }
  }

  try {
    xhr.send(
      body === null
        ? null
        : JSON.stringify(body)
    );
  } catch (error) {
    throw new Error(
      error?.message ||
      'Unable to connect to TraceMate backend'
    );
  }

  let data = null;

  try {
    data = xhr.responseText
      ? JSON.parse(xhr.responseText)
      : {};
  } catch {
    data = {
      raw: xhr.responseText
    };
  }

  if (xhr.status < 200 || xhr.status >= 300) {
    const error = new Error(
      data?.error ||
      data?.message ||
      `Request failed with status ${xhr.status}`
    );

    error.status = xhr.status;
    error.data = data;

    throw error;
  }

  return data;
}

// ---------------------------------------------------------
// DATABASE API
// ---------------------------------------------------------

const DB = {

  get(key) {
    try {
      const response = requestSync(
        'GET',
        apiUrl(`/api/db/${key}`)
      );

      return response?.data || [];
    } catch (error) {
      console.warn(
        `DB.get(${key}) failed:`,
        error
      );

      return [];
    }
  },

  set(key, data) {
    try {
      return requestSync(
        'PUT',
        apiUrl(`/api/db/${key}`),
        {
          data
        },
        true
      );
    } catch (error) {
      console.error(
        `DB.set(${key}) failed:`,
        error
      );

      throw error;
    }
  },

  getObj(key) {
    try {
      const response = requestSync(
        'GET',
        apiUrl(`/api/db/${key}`)
      );

      return response?.data || {};
    } catch (error) {
      console.warn(
        `DB.getObj(${key}) failed:`,
        error
      );

      return {};
    }
  },

  setObj(key, data) {
    try {
      return requestSync(
        'PUT',
        apiUrl(`/api/db/${key}`),
        {
          data
        },
        true
      );
    } catch (error) {
      console.error(
        `DB.setObj(${key}) failed:`,
        error
      );

      throw error;
    }
  },

  setApiBase(baseUrl) {
    const cleaned = String(baseUrl || '')
      .trim()
      .replace(/\/+$/, '');

    try {
      if (cleaned) {
        localStorage.setItem(
          API_BASE_KEY,
          cleaned
        );
      } else {
        localStorage.removeItem(
          API_BASE_KEY
        );
      }
    } catch (error) {
      console.warn(
        'Unable to save API base URL:',
        error
      );
    }

    return cleaned;
  },

  getApiBase() {
    return getApiBaseUrl();
  }
};

// ---------------------------------------------------------
// GLOBAL ACCESS
// ---------------------------------------------------------

window.getAuthToken = getAuthToken;
window.setAuthToken = setAuthToken;
window.getStoredAuthToken = getStoredAuthToken;

window.getApiBaseUrl = getApiBaseUrl;
window.apiUrl = apiUrl;

window.DB = DB;

window.genId = genId;
window.today = today;
window.fmtDate = fmtDate;