<?php
require_once 'session.php';
require 'db.php';
require_once 'version.php';
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = trim($_POST['password'] ?? '');
    if ($username && $password) {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ?');
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            $error = 'Пользователь уже существует';
        } else {
            $hash = password_hash($password, PASSWORD_BCRYPT);
            $stmt = $pdo->prepare('INSERT INTO users (username, password) VALUES (?, ?)');
            $stmt->execute([$username, $hash]);
            $_SESSION['user'] = $username;
            $_SESSION['user_id'] = $pdo->lastInsertId();
            $_SESSION['is_admin'] = false;
            header('Location: index.php');
            exit;
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
<title>Регистрация</title>
<link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>">
</head>
<body>
<script>(function(){var dark=localStorage.getItem('darkMode')==='true';if(dark)document.body.classList.add('dark-mode');})();</script>
<div id="topbar">
  <a href="welcome.php">На главную</a>
  <a href="login.php">Вход</a>
  <?php if(isset($_SESSION['user'])): ?>
    <a href="bug_report.php">Баг-репорт</a>
  <?php endif; ?>
  <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>
</div>
<div class="auth-box">
<h2>Регистрация</h2>
<?php if ($error): ?><p class="error"><?php echo $error; ?></p><?php endif; ?>
<form method="post">
  <input type="text" name="username" placeholder="Логин" required>
  <input type="password" name="password" placeholder="Пароль" required>
  <button type="submit">Зарегистрироваться</button>
</form>
<p><a href="login.php">Вход</a></p>
</div>
  <script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
</body>
</html>
