<?php
require_once 'session.php';
require_once 'version.php';
if (empty($_SESSION['is_admin'])) {
    http_response_code(403);
    echo 'Access denied';
    exit;
}

$newsFile = __DIR__ . '/news.json';
$news = [];
if (file_exists($newsFile)) {
    $json = file_get_contents($newsFile);
    $news = json_decode($json, true) ?: [];
    usort($news, function($a, $b){
        return ($b['timestamp'] ?? 0) <=> ($a['timestamp'] ?? 0);
    });
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $items  = array_filter(array_map('trim', $_POST['items'] ?? []));
    if ($action === 'add') {
        if ($items) {
            $news[] = [
                'id'        => uniqid('', true),
                'timestamp' => time(),
                'time'      => date('H:i d/m/Y'),
                'items'     => array_values($items)
            ];
        }
    } elseif ($action === 'update') {
        $id = $_POST['id'] ?? '';
        foreach ($news as &$n) {
            if (($n['id'] ?? '') === $id) {
                if ($items) {
                    // Keep original time information when editing
                    $n['items'] = array_values($items);
                }
                break;
            }
        }
        unset($n);
    } elseif ($action === 'delete') {
        $id = $_POST['id'] ?? '';
        $news = array_values(array_filter($news, function ($n) use ($id) {
            return ($n['id'] ?? '') !== $id;
        }));
    }
    usort($news, function($a, $b){
        return ($b['timestamp'] ?? 0) <=> ($a['timestamp'] ?? 0);
    });
    file_put_contents($newsFile, json_encode($news, JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE));
    header('Location: news_admin.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Управление новостями</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
  <link rel="icon" href="favicon_news.png" type="image/png" />
  <link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>">
</head>
<body>
  <script>(function(){var dark=localStorage.getItem('darkMode')==='true';if(dark)document.body.classList.add('dark-mode');})();</script>
<div id="topbar">
  <a href="index.php">На главную</a>
  <a href="admin_panel.php">Админ-панель</a>
  <a href="bug_report.php">Баг-репорт</a>
  <a href="logout.php" onclick="setSkipUnload();">Выход</a>
  <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>
</div>
<div class="admin-container">
<h2>Управление новостями</h2>
<table class="admin-table news-admin-table">
<thead><tr><th>Время</th><th class="items-column">Пункты обновления</th><th>Действия</th></tr></thead>
<tbody>
<form id="fnew" method="post" class="news-form"></form>
<tr>
  <td><?php echo date('H:i d/m/Y'); ?></td>
  <td class="items-column">
    <div class="items-container" data-form="fnew">
      <textarea name="items[]" placeholder="Пункт обновления" rows="2" form="fnew"></textarea>
    </div>
    <button type="button" onclick="addItemField(this)" data-form="fnew">+</button>
  </td>
  <td><button type="submit" name="action" value="add" form="fnew">Добавить</button></td>
</tr>
<?php foreach ($news as $n): ?>
<form id="f<?php echo $n['id']; ?>" method="post" class="news-form"></form>
<tr>
  <td>
    <input type="hidden" name="id" value="<?php echo $n['id']; ?>" form="f<?php echo $n['id']; ?>">
    <?php echo htmlspecialchars($n['time'] ?? ''); ?>
  </td>
  <td class="items-column">
    <div class="items-container" data-form="f<?php echo $n['id']; ?>">
    <?php foreach (($n['items'] ?? []) as $it): ?>
      <textarea name="items[]" rows="2" form="f<?php echo $n['id']; ?>"><?php echo htmlspecialchars($it); ?></textarea><br>
    <?php endforeach; ?>
      <textarea name="items[]" placeholder="Пункт обновления" rows="2" form="f<?php echo $n['id']; ?>"></textarea>
    </div>
    <button type="button" onclick="addItemField(this)" data-form="f<?php echo $n['id']; ?>">+</button>
  </td>
  <td>
    <button type="submit" name="action" value="update" form="f<?php echo $n['id']; ?>">Сохранить</button>
    <button type="submit" name="action" value="delete" form="f<?php echo $n['id']; ?>" onclick="return confirm('Удалить запись?');">Удалить</button>
  </td>
</tr>
<?php endforeach; ?>
</tbody>
</table>
</div>
<script>
function addItemField(btn){
  const container = btn.previousElementSibling;
  const formId = btn.dataset.form || container.dataset.form;
  const textarea = document.createElement('textarea');
  textarea.name = 'items[]';
  textarea.rows = 2;
  if (formId) textarea.setAttribute('form', formId);
  textarea.placeholder = 'Пункт обновления';
  container.appendChild(document.createElement('br'));
  container.appendChild(textarea);
}
</script>
<script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
</body>
</html>
