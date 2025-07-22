<?php
require_once 'session.php';
require 'db.php';
require_once 'version.php';
if (empty($_SESSION['is_admin'])) {
    http_response_code(403);
    echo 'Access denied';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $user_id = (int)($_POST['user_id'] ?? 0);
    if ($action === 'balance') {
        $balance = (int)($_POST['balance'] ?? 0);
        $rating  = (int)($_POST['rating'] ?? 0);
        $stmt = $pdo->prepare('INSERT INTO player_data (user_id, balance, rating, bases, calls)
            VALUES (?, ?, ?, "[]", "[]")
            ON DUPLICATE KEY UPDATE balance = VALUES(balance), rating = VALUES(rating)');
        $stmt->execute([$user_id, $balance, $rating]);
    } elseif ($action === 'make_admin') {
        $is_admin = isset($_POST['is_admin']) && $_POST['is_admin'] ? 1 : 0;
        $stmt = $pdo->prepare('UPDATE users SET is_admin=? WHERE id=?');
        $stmt->execute([$is_admin, $user_id]);
    }
    header('Location: admin_panel.php');
    exit;
}

$stmt = $pdo->query('SELECT u.id, u.username, u.is_admin, IFNULL(pd.balance, 10000) AS balance, IFNULL(pd.rating, 100) AS rating
                      FROM users u LEFT JOIN player_data pd ON u.id = pd.user_id');
$users = $stmt->fetchAll();
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Админ-панель</title>
<link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>">
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<link rel="icon" href="favicon_admin.png" type="image/png" />
</head>
<body>
<script>(function(){var dark=localStorage.getItem('darkMode')==='true';if(dark)document.body.classList.add('dark-mode');})();</script>
<div id="topbar">
  <a href="index.php">На главную</a>
  <a href="bug_report.php">Баг-репорт</a>
  <a href="logout.php" onclick="setSkipUnload();">Выход</a>
  <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>
</div>
<div class="admin-container">
  <h2>Админ-панель</h2>
  <input type="text" id="user-search" placeholder="Поиск по нику" />
  <table id="user-table" class="admin-table">
    <thead>
      <tr>
        <th>ID</th>
        <th>Ник</th>
        <th>Баланс + рейтинг</th>
        <th>Админ</th>
        <th>Действия</th>
      </tr>
    </thead>
    <tbody>
    <?php foreach ($users as $u): ?>
    <tr>
      <td><?php echo $u['id']; ?></td>
      <td><?php echo htmlspecialchars($u['username']); ?></td>
      <td>
        <form method="post" style="display:inline;">
          <input type="hidden" name="action" value="balance">
          <input type="hidden" name="user_id" value="<?php echo $u['id']; ?>">
          <input type="number" name="balance" value="<?php echo $u['balance']; ?>" style="width:80px;">
          <input type="number" name="rating" value="<?php echo $u['rating']; ?>" style="width:60px;">
          <button type="submit">Обновить</button>
        </form>
      </td>
      <td>
         <form method="post" style="display:inline;">
          <input type="hidden" name="action" value="make_admin">
          <input type="hidden" name="user_id" value="<?php echo $u['id']; ?>">
          <input type="hidden" name="is_admin" value="<?php echo $u['is_admin'] ? 0 : 1; ?>">
          <?php if ($u['is_admin']): ?>
            <button class="btn-admin-remove" type="submit">Снять админа</button>
          <?php else: ?>
            <button class="btn-admin-add" type="submit">Назначить админом</button>
          <?php endif; ?>
        </form>
      </td>
      <td>
        <a class="btn" href="index.php?user=<?php echo $u['id']; ?>">Управлять</a>
      </td>
    </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
  <script>
    const searchInput = document.getElementById('user-search');
    searchInput.addEventListener('input', () => {
      const filter = searchInput.value.toLowerCase();
      document.querySelectorAll('#user-table tbody tr').forEach(row => {
        const name = row.querySelector('td:nth-child(2)').textContent.toLowerCase();
        row.style.display = name.includes(filter) ? '' : 'none';
      });
    });
  </script>
  <script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
</div>
</body>
</html>
