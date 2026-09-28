// auth.js - Authentication and session management
// TraceMate FINAL AUTH FIX
// - Uses the same token from localStorage/sessionStorage/window
// - Does not show the false "Backend not reachable" message for normal API errors
// - Keeps Admin authentication stable after refresh

let currentUser = null;

/* =========================================================
   TOKEN HELPERS
========================================================= */

function getAuthToken() {
  return (
    sessionStorage.getItem('tracemate_token') ||
    sessionStorage.getItem('tm_token') ||
    window.tracemateToken ||
    ''
  );
}

function setAuthToken(token) {
  const value = token || '';

  if (value) {
    sessionStorage.setItem('tracemate_token', value);
    sessionStorage.setItem('tm_token', value);
    window.tracemateToken = value;
  } else {
    sessionStorage.removeItem('tracemate_token');
    sessionStorage.removeItem('tm_token');
    window.tracemateToken = '';
  }
}

/* =========================================================
   BASIC HELPERS
========================================================= */

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getPasswordError(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }

  if (!/[a-z]/.test(password)) {
    return 'Password must include a lowercase letter';
  }

  if (!/[A-Z]/.test(password)) {
    return 'Password must include an uppercase letter';
  }

  if (!/\d/.test(password)) {
    return 'Password must include a number';
  }

  if (!/[^\w\s]/.test(password)) {
    return 'Password must include a special character';
  }

  return '';
}

/* =========================================================
   PASSWORD VISIBILITY
========================================================= */

function togglePasswordVisibility(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);

  if (!input || !button) return;

  const isHidden = input.type === 'password';

  input.type = isHidden ? 'text' : 'password';

  button.classList.toggle('is-visible', isHidden);

  button.setAttribute(
    'aria-label',
    isHidden ? 'Hide password' : 'Show password'
  );

  button.setAttribute(
    'title',
    isHidden ? 'Hide password' : 'Show password'
  );
}

function resetPasswordToggle(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);

  if (!input || !button) return;

  input.type = 'password';
  button.classList.remove('is-visible');

  button.setAttribute('aria-label', 'Show password');
  button.setAttribute('title', 'Show password');
}

/* =========================================================
   FORGOT PASSWORD
========================================================= */

function resetForgotPasswordForm() {
  const passwordInput = document.getElementById('forgot-password');
  const confirmInput = document.getElementById('forgot-confirm');

  if (passwordInput) passwordInput.value = '';
  if (confirmInput) confirmInput.value = '';

  resetPasswordToggle(
    'forgot-password',
    'forgot-password-toggle'
  );

  resetPasswordToggle(
    'forgot-confirm',
    'forgot-confirm-toggle'
  );
}

function toggleForgotPassword(forceOpen) {
  const modal = document.getElementById('forgot-modal');

  if (!modal) return;

  const shouldOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : modal.classList.contains('hidden');

  modal.classList.toggle('hidden', !shouldOpen);

  if (shouldOpen) {
    document.getElementById('forgot-password')?.focus();
  } else {
    resetForgotPasswordForm();
  }
}

function handleForgotModalBackdrop(event) {
  if (
    event.target &&
    event.target.id === 'forgot-modal'
  ) {
    toggleForgotPassword(false);
  }
}

/* =========================================================
   AUTH TABS
========================================================= */

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle(
      'active',
      (tab === 'login' && i === 0) ||
      (tab === 'register' && i === 1)
    );
  });

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (loginForm) {
    loginForm.classList.toggle(
      'hidden',
      tab !== 'login'
    );
  }

  if (registerForm) {
    registerForm.classList.toggle(
      'hidden',
      tab !== 'register'
    );
  }

  if (tab !== 'login') {
    toggleForgotPassword(false);
  }
}

/* =========================================================
   LOGIN
========================================================= */

async function handleLogin() {
  const email =
    document.getElementById('login-email')?.value.trim() || '';

  const password =
    document.getElementById('login-password')?.value || '';

  if (!email || !password) {
    toast('Please enter email and password', 'error');
    return;
  }

  if (!isValidEmail(email)) {
    toast('Enter a valid email address', 'error');
    return;
  }

  try {
    const res = await fetch(
      apiUrl('/api/auth/login'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password
        })
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast(
        data.error ||
        data.message ||
        `Login failed (${res.status})`,
        'error'
      );
      return;
    }

    if (!data.token || !data.user) {
      toast(
        'Login response is missing authentication data.',
        'error'
      );
      return;
    }

    setAuthToken(data.token);

    loginUser(
      data.user,
      true
    );

  } catch (error) {
    console.error(
      'TraceMate login request failed:',
      error
    );

    toast(
      `Connection error: ${error.message || 'Unable to contact the server'}`,
      'error'
    );
  }
}

/* =========================================================
   ADMIN QUICK LOGIN
========================================================= */

function loginAsAdmin() {
  const emailInput =
    document.getElementById('login-email');

  const passwordInput =
    document.getElementById('login-password');

  if (emailInput) {
    emailInput.value = 'admin@campus.edu';
  }

  if (passwordInput) {
    passwordInput.value = 'Admin@123';
  }

  handleLogin();
}

/* =========================================================
   REGISTER
========================================================= */

async function handleRegister() {
  const name =
    document.getElementById('reg-name')?.value.trim() || '';

  const email =
    document.getElementById('reg-email')?.value.trim() || '';

  const password =
    document.getElementById('reg-password')?.value || '';

  if (!name || !email || !password) {
    toast('Please fill all required fields', 'error');
    return;
  }

  if (!isValidEmail(email)) {
    toast('Enter a valid email address', 'error');
    return;
  }

  const passwordError =
    getPasswordError(password);

  if (passwordError) {
    toast(passwordError, 'error');
    return;
  }

  try {
    const res = await fetch(
      apiUrl('/api/auth/register'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          email,
          password
        })
      }
    );

    const data =
      await res.json().catch(() => ({}));

    if (!res.ok) {
      toast(
        data.error ||
        data.message ||
        `Registration failed (${res.status})`,
        'error'
      );
      return;
    }

    toast(
      'Account created! Please sign in.',
      'success'
    );

    switchAuthTab('login');

  } catch (error) {
    console.error(
      'TraceMate registration request failed:',
      error
    );

    toast(
      `Connection error: ${error.message || 'Unable to contact the server'}`,
      'error'
    );
  }
}

/* =========================================================
   FORGOT PASSWORD REQUEST
========================================================= */

async function handleForgotPassword() {
  const email =
    document.getElementById('login-email')?.value.trim() || '';

  const newPassword =
    document.getElementById('forgot-password')?.value || '';

  const confirmPassword =
    document.getElementById('forgot-confirm')?.value || '';

  if (!email) {
    toast(
      'Enter your email in the sign-in form first',
      'error'
    );
    return;
  }

  if (!newPassword || !confirmPassword) {
    toast('Please fill all fields', 'error');
    return;
  }

  if (!isValidEmail(email)) {
    toast('Enter a valid email address', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    toast('Passwords do not match', 'error');
    return;
  }

  const passwordError =
    getPasswordError(newPassword);

  if (passwordError) {
    toast(passwordError, 'error');
    return;
  }

  try {
    const res = await fetch(
      apiUrl('/api/auth/forgot'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          newPassword,
          confirmPassword
        })
      }
    );

    const data =
      await res.json().catch(() => ({}));

    if (!res.ok) {
      toast(
        data.error ||
        data.message ||
        `Unable to reset password (${res.status})`,
        'error'
      );
      return;
    }

    toast(
      'Password updated. Please sign in.',
      'success'
    );

    toggleForgotPassword(false);

    const loginEmail =
      document.getElementById('login-email');

    if (loginEmail) {
      loginEmail.value = email;
    }

  } catch (error) {
    console.error(
      'TraceMate password reset request failed:',
      error
    );

    toast(
      `Connection error: ${error.message || 'Unable to contact the server'}`,
      'error'
    );
  }
}

/* =========================================================
   LOGIN USER
========================================================= */

function loginUser(
  user,
  persistSession = true
) {
  currentUser = user;

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  updateUserUI();

  const adminNav =
    document.getElementById('admin-nav');

  if (adminNav) {
    adminNav.style.display =
      user.role === 'admin'
        ? 'block'
        : 'none';
  }

  if (persistSession) {
    try {
      localStorage.setItem(
        'tm_user',
        JSON.stringify(user)
      );
    } catch {
      // Ignore local storage errors.
    }
  }

  showPage(
    user.role === 'admin'
      ? 'admin'
      : 'dashboard'
  );

  if (typeof refreshAll === 'function') {
    refreshAll();
  }

  toast(
    `Welcome, ${user.name.split(' ')[0]}! TraceMate`,
    'success'
  );
}

/* =========================================================
   DELETE PROFILE / ACCOUNT
========================================================= */

async function handleDeleteAccount() {
  if (!currentUser) {
    toast(
      'No active account is signed in.',
      'error'
    );
    return;
  }


  if (currentUser.role === 'admin') {
    toast(
      'The administrator account cannot be deleted here.',
      'error'
    );
    return;
  }


  const confirmed =
    window.confirm(
      'Delete your TraceMate profile permanently?\n\nYour account and associated personal records will be removed. This action cannot be undone.'
    );

  if (!confirmed) {
    return;
  }


  const token =
    getAuthToken();

  if (!token) {
    toast(
      'Your session has expired. Please sign in again.',
      'error'
    );
    return;
  }


  try {
    const res =
      await fetch(
        apiUrl('/api/auth/account'),
        {
          method: 'DELETE',
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );


    const data =
      await res.json().catch(() => ({}));


    if (!res.ok) {
      toast(
        data.error ||
        data.message ||
        `Unable to delete account (${res.status})`,
        'error'
      );
      return;
    }


    currentUser = null;
    setAuthToken('');

    sessionStorage.removeItem('tm_user');

    const app =
      document.getElementById('app');

    const authScreen =
      document.getElementById('auth-screen');

    const adminNav =
      document.getElementById('admin-nav');

    if (app) {
      app.style.display = 'none';
    }

    if (authScreen) {
      authScreen.style.display = 'flex';
    }

    if (adminNav) {
      adminNav.style.display = 'none';
    }

    switchAuthTab('login');

    toast(
      'Your TraceMate profile has been deleted successfully.',
      'success'
    );

  } catch (error) {
    console.error(
      'TraceMate account deletion failed:',
      error
    );

    toast(
      `Connection error: ${error.message || 'Unable to contact the server'}`,
      'error'
    );
  }
}


/* =========================================================
   LOGOUT
========================================================= */

async function handleLogout() {
  try {
    const token = getAuthToken();

    if (token) {
      await fetch(
        apiUrl('/api/auth/logout'),
        {
          method: 'POST',
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );
    }
  } catch (error) {
    console.warn(
      'Logout request failed:',
      error
    );
  }

  currentUser = null;
  setAuthToken('');

  sessionStorage.removeItem('tm_user');

  const app =
    document.getElementById('app');

  const authScreen =
    document.getElementById('auth-screen');

  const adminNav =
    document.getElementById('admin-nav');

  if (app) {
    app.style.display = 'none';
  }

  if (authScreen) {
    authScreen.style.display = 'flex';
  }

  if (adminNav) {
    adminNav.style.display = 'none';
  }
}

/* =========================================================
   UPDATE USER UI
========================================================= */

function updateUserUI() {
  if (!currentUser) return;

  const isAdmin =
    currentUser.role === 'admin';

  const initials =
    isAdmin
      ? 'AD'
      : currentUser.name
          .split(' ')
          .map(n => n[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();

  const avatarNav =
    document.getElementById('user-avatar-nav');

  const avatarTop =
    document.getElementById('user-avatar-top');

  const userName =
    document.getElementById('user-name-nav');

  const userRole =
    document.getElementById('user-role-nav');

  const welcomeName =
    document.getElementById('welcome-name');

  if (avatarNav) {
    avatarNav.textContent = initials;
  }

  if (avatarTop) {
    avatarTop.textContent = initials;
  }

  if (userName) {
    userName.textContent =
      currentUser.name;
  }

  if (userRole) {
    userRole.textContent =
      isAdmin
        ? 'Project Guide / Admin'
        : 'Student';
  }

  if (welcomeName) {
    welcomeName.textContent =
      currentUser.name.split(' ')[0];
  }

  if (userName) {
    userName.classList.toggle(
      'hidden',
      isAdmin
    );
  }

  if (userRole) {
    userRole.classList.toggle(
      'hidden',
      isAdmin
    );
  }
}

/* =========================================================
   RESTORE BACKEND SESSION
========================================================= */

async function restoreSession() {
  const token =
    getAuthToken();

  if (!token) return;

  try {
    const res =
      await fetch(
        apiUrl('/api/auth/me'),
        {
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );

    if (!res.ok) {
      console.warn(
        `Saved TraceMate session rejected (${res.status}).`
      );

      setAuthToken('');
      currentUser = null;
      return;
    }

    const data =
      await res.json().catch(() => ({}));

    if (data?.user) {
      loginUser(
        data.user,
        false
      );
    }

  } catch (error) {
    console.warn(
      'Could not restore TraceMate session:',
      error
    );

    // Do not show a false "Backend not reachable" toast here.
    // The user can continue normally and log in again if needed.
  }
}

/* =========================================================
   ENSURE CURRENT USER
========================================================= */

async function ensureCurrentUser() {
  if (currentUser) {
    return currentUser;
  }

  const token =
    getAuthToken();

  if (!token) {
    return null;
  }

  try {
    const res =
      await fetch(
        apiUrl('/api/auth/me'),
        {
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );

    if (!res.ok) {
      return null;
    }

    const data =
      await res.json().catch(() => ({}));

    if (data?.user) {
      loginUser(
        data.user,
        false
      );

      return data.user;
    }

  } catch (error) {
    console.warn(
      'Unable to verify current TraceMate user:',
      error
    );
  }

  return null;
}
