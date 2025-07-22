function applyStoredTheme() {
  const dark = localStorage.getItem('darkMode') === 'true';
  document.body.classList.toggle('dark-mode', dark);
  document.body.classList.toggle('admin-view-mode', window.isAdminView === true);
  const btn = document.getElementById('toggle-theme-btn');
  if (btn) btn.textContent = dark ? '☀️ Светлая тема' : '🌙 Тёмная тема';
  if (window.vehicleModalBaseType && window.setVehicleModalBackground) {
    setVehicleModalBackground(window.vehicleModalBaseType);
  }
}

function toggleTheme() {
  const dark = !document.body.classList.contains('dark-mode');
  document.body.classList.toggle('dark-mode', dark);
  localStorage.setItem('darkMode', dark);
  const btn = document.getElementById('toggle-theme-btn');
  if (btn) btn.textContent = dark ? '☀️ Светлая тема' : '🌙 Тёмная тема';
  if (window.vehicleModalBaseType && window.setVehicleModalBackground) {
    setVehicleModalBackground(window.vehicleModalBaseType);
  }
  document.body.classList.toggle('admin-view-mode', window.isAdminView === true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyStoredTheme);
} else {
  applyStoredTheme();
}
