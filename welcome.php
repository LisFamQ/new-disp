<?php
require_once 'session.php';
require_once 'version.php';
if (isset($_SESSION['user'])) {
    header('Location: index.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Добро пожаловать</title>
<link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>">
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<link rel="icon" href="favicon.png" type="image/png" />
</head>
<body class="welcome-page">
  <script>(function(){var dark=localStorage.getItem('darkMode')==='true';if(dark)document.body.classList.add('dark-mode');})();</script>
  <div id="topbar" class="welcome-bar">
      <?php if(isset($_SESSION['user'])): ?>
        <a href="bug_report.php">Баг-репорт</a>
      <?php endif; ?>
      <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>
  </div>
  <div class="welcome-content">
    <h1>Добро пожаловать в Dispatcher</h1>
    <p>Управляйте экстренными службами города, стройте здания и реагируйте на вызовы!</p>
    <img src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80" alt="City" />
    <p>Присоединяйтесь, чтобы попробовать свои силы в роли диспетчера.</p>
    <p>
      <a href="login.php" class="btn">Войти</a>
      <a href="register.php" class="btn">Регистрация</a>
    </p>
  </div>
  <script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
</body>
</html>
