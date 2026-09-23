// auth.js - Authentication and session management

let currentUser = null;

function isAllowedStudentEmail(email) {
  return email.toLowerCase().endsWith('@ges-coengg.org');
}

function getPasswordError(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/\d/.test(password)) return 'Password must include a number';
  if (!/[^\w\s]/.test(password)) return 'Password must include a special character';
  return '';
}

function togglePasswordVisibility(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  if (!input || !button) return;

  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  button.classList.toggle('is-visible', isHidden);
  button.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  button.setAttribute('title', isHidden ? 'Hide password' : 'Show password');
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

function resetForgotPasswordForm() {
  const passwordInput = document.getElementById('forgot-password');
  const confirmInput = document.getElementById('forgot-confirm');
  if (passwordInput) passwordInput.value = '';
  if (confirmInput) confirmInput.value = '';
  resetPasswordToggle('forgot-password', 'forgot-password-toggle');
  resetPasswordToggle('forgot-confirm', 'forgot-confirm-toggle');
}

function toggleForgotPassword(forceOpen) {
  const modal = document.getElementById('forgot-modal');
  if (!modal) return;

  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : modal.classList.contains('hidden');
  modal.classList.toggle('hidden', !shouldOpen);
  if (shouldOpen) {
    document.getElementById('forgot-password')?.focus();
  } else {
    resetForgotPasswordForm();
  }
}

function handleForgotModalBackdrop(event) {
  if (event.target && event.target.id === 'forgot-modal') {
    toggleForgotPassword(false);
  }
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1))
  );
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  if (tab !== 'login') toggleForgotPassword(false);
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Invalid email or password', 'error');
      return;
    }

    setAuthToken(data.token);
    loginUser(data.user, true);
  } catch {
    toast('Backend not reachable. Start server with npm start', 'error');
  }
}

function loginAsAdmin() {
  toast('Enter admin email and password, then click Sign In', 'info');
  document.getElementById('login-email')?.focus();
}

async function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const studentId = document.getElementById('reg-student-id')?.value.trim() || '';

  if (!name || !email || !password || !studentId) {
    toast('Please fill all fields', 'error');
    return;
  }

  if (!isAllowedStudentEmail(email)) {
    toast('Enter College Email', 'error');
    return;
  }

  const passwordError = getPasswordError(password);
  if (passwordError) {
    toast(passwordError, 'error');
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, studentId }),
    });

    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Registration failed', 'error');
      return;
    }

    toast('Account created! Please sign in.', 'success');
    switchAuthTab('login');
  } catch {
    toast('Backend not reachable. Start server with npm start', 'error');
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('login-email').value.trim();
  const newPassword = document.getElementById('forgot-password').value;
  const confirmPassword = document.getElementById('forgot-confirm').value;

  if (!email) {
    toast('Enter your email in the sign-in form first', 'error');
    return;
  }

  if (!newPassword || !confirmPassword) {
    toast('Please fill all fields', 'error');
    return;
  }

  if (!isAllowedStudentEmail(email)) {
    toast('Enter College Email', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    toast('Passwords do not match', 'error');
    return;
  }

  const passwordError = getPasswordError(newPassword);
  if (passwordError) {
    toast(passwordError, 'error');
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/auth/forgot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword, confirmPassword }),
    });

    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Unable to reset password', 'error');
      return;
    }

    toast('Password updated. Please sign in.', 'success');
    toggleForgotPassword(false);
    document.getElementById('login-email').value = email;
  } catch {
    toast('Backend not reachable. Start server with npm start', 'error');
  }
}

function loginUser(user, persistSession = true) {
  currentUser = user;

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  updateUserUI();

  if (user.role === 'admin') {
    document.getElementById('admin-nav').style.display = 'block';
  } else {
    document.getElementById('admin-nav').style.display = 'none';
  }

  showPage('dashboard');
  refreshAll();
  toast(`Welcome, ${user.name.split(' ')[0]}! TraceMate`, 'success');
}

async function handleLogout() {
  try {
    const token = getAuthToken();
    if (token) {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // ignore logout call failure and clear local session anyway
  }

  currentUser = null;
  setAuthToken('');

  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('admin-nav').style.display = 'none';
}

function updateUserUI() {
  if (!currentUser) return;
  const isAdmin = currentUser.role === 'admin';
  const initials = isAdmin
    ? 'AD'
    : currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('user-avatar-nav').textContent = initials;
  document.getElementById('user-avatar-top').textContent = initials;
  document.getElementById('user-name-nav').textContent = currentUser.name;
  document.getElementById('user-role-nav').textContent = currentUser.role === 'admin' ? 'Project Guide / Admin' : 'Student';
  document.getElementById('welcome-name').textContent = currentUser.name.split(' ')[0];

  document.getElementById('user-name-nav').classList.toggle('hidden', isAdmin);
  document.getElementById('user-role-nav').classList.toggle('hidden', isAdmin);
}

async function restoreSession() {
  const token = getAuthToken();
  if (!token) return;

  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      setAuthToken('');
      return;
    }

    const data = await res.json();
    if (data?.user) {
      loginUser(data.user, false);
    }
  } catch {
    setAuthToken('');
  }
}

async function ensureCurrentUser() {
  if (currentUser) return currentUser;

  const token = getAuthToken();
  if (!token) return null;

  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data?.user) {
      loginUser(data.user, false);
      return data.user;
    }
  } catch {
    return null;
  }

  return null;
}
