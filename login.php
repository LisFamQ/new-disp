<?php
require_once 'session.php';
require 'db.php';
require_once 'version.php';
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = trim($_POST['password'] ?? '');
    if ($username && $password) {
        $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        if ($user && password_verify($password, $user['password'])) {
            $pdo->prepare('UPDATE users SET last_login=NOW() WHERE id=?')->execute([$user['id']]);
            $pdo->prepare('INSERT IGNORE INTO user_status (user_id, last_online) VALUES (?, NOW())')->execute([$user['id']]);
            $_SESSION['user'] = $user['username'];
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['is_admin'] = (bool)$user['is_admin'];
            header('Location: index.php');
            exit;
        } else {
            $error = 'Неверный логин или пароль';
        }
    } else {
        $error = 'Заполните все поля';
    }
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Вход</title>
<link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>">
</head>
<body>
<script>(function(){var dark=localStorage.getItem('darkMode')==='true';if(dark)document.body.classList.add('dark-mode');})();</script>
<div id="topbar">
  <a href="welcome.php">На главную</a>
  <a href="register.php">Регистрация</a>
  <?php if(isset($_SESSION['user'])): ?>
    <a href="bug_report.php">Баг-репорт</a>
  <?php endif; ?>
  <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>
</div>
<div class="auth-box">
<h2>Вход</h2>
<?php if ($error): ?><p class="error"><?php echo $error; ?></p><?php endif; ?>
<form method="post">
  <input type="text" name="username" placeholder="Логин" required>
  <input type="password" name="password" placeholder="Пароль" required>
  <button type="submit">Войти</button>
</form>
<p><a href="register.php">Регистрация</a></p>
</div>
  <script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
</body>
</html>
