document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('license-input');
  const btn = document.getElementById('activate-btn');
  const msg = document.getElementById('activation-msg');

  // Auto-format as XXXX-XXXX-XXXX-XXXX while typing
  input.addEventListener('input', () => {
    let raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    const groups = raw.match(/.{1,4}/g) || [];
    input.value = groups.join('-');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btn.click();
  });

  btn.addEventListener('click', async () => {
    const licenseKey = input.value.trim();
    if (licenseKey.length < 19) {
      showMessage('Enter a complete license key.', false);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Activating...';
    showMessage('', false);

    const result = await window.hostAPI.activateLicense(licenseKey);

    if (result.valid) {
      showMessage('Activated! Loading Remote Desk...', true);
      // main.js already navigates to index.html on success — this
      // message just covers the brief moment before that happens.
    } else {
      btn.disabled = false;
      btn.textContent = 'Activate';
      showMessage(result.reason || 'Invalid license key.', false);
    }
  });

  function showMessage(text, success) {
    msg.textContent = text;
    msg.classList.toggle('success', success);
  }
});
