<?php
require_once 'session.php';
require_once 'version.php';
require 'db.php';
if (!isset($_SESSION['user'])) {
    header('Location: welcome.php');
    exit;
}

$view_user_id = null;
$view_username = null;
if (!empty($_SESSION['is_admin']) && isset($_GET['user'])) {
    $view_user_id = (int)$_GET['user'];
    $stmt = $pdo->prepare('SELECT username FROM users WHERE id=?');
    $stmt->execute([$view_user_id]);
    $view_username = $stmt->fetchColumn();
    if ($view_username === false) {
        $view_user_id = null;
    }
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Диспетчер dudLis</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
  <link rel="icon" href="favicon.png" type="image/png" />
  <link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>" />
</head>
<body>
  <script>
    window.adminUserId = <?php echo $view_user_id !== null ? $view_user_id : 'null'; ?>;
    window.isAdminView = <?php echo $view_user_id !== null ? 'true' : 'false'; ?>;
    window.viewUsername = <?php echo $view_user_id !== null ? json_encode($view_username) : 'null'; ?>;
    window.currentUser = <?php echo isset($_SESSION['user']) ? json_encode($_SESSION['user']) : 'null'; ?>;
    (function(){
      var dark=localStorage.getItem('darkMode')==='true';
      if(dark) document.body.classList.add('dark-mode');
      if(window.isAdminView) document.body.classList.add('admin-view-mode');
    })();
  </script>

  <div id="topbar">
    <?php if(isset($_SESSION['user'])): ?>
      <span id="moscow-time">--:--:--</span>
      <span class="greeting">Здравствуйте,</span>
      <button id="profile-btn" class="btn profile-btn" onclick="openProfileModal()">
        <?php echo htmlspecialchars($_SESSION['user']); ?>
      </button>
      <?php if($view_user_id !== null): ?>
        <span class="admin-view">(Игрок: <?php echo htmlspecialchars($view_username); ?>)</span>
        <a href="index.php" class="exit-admin">Выйти из управления</a>
      <?php endif; ?>
      <span id="balance" onclick="openHistoryModal()">Баланс: --</span>
      <span id="rating" onclick="openHistoryModal()">Рейтинг: --</span>
      <a href="logout.php" onclick="setSkipUnload();">Выход</a>
    <?php else: ?>
      <a href="login.php">Вход</a>
      <a href="register.php">Регистрация</a>
    <?php endif; ?>
    <?php if(isset($_SESSION['user'])): ?>
      <a href="#" onclick="openBugReportModal(); return false;">Баг-репорт</a>
    <?php endif; ?>
    <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>

  </div>

  <div id="notification-container"></div>


  <div id="map-status"></div>
  <div id="zone-edit-menu" style="display:none;">
    <button class="btn" onclick="clearZonePoints()">🗑 Очистить</button>
    <button class="btn" onclick="finishZoneEdit(true)">💾 Сохранить</button>
    <button class="btn cancel-btn" onclick="finishZoneEdit(false)">❌ Отмена</button>
    <p class="hint">Кликайте по карте, чтобы добавлять точки.<br>Правый клик по точке удалит её, правый клик вне точки отменит редактирование.</p>
  </div>
<!-- Изначально скрыт -->
<div id="base-type-select" style="display:none;">
  <p><strong>Выберите тип здания:</strong></p>
  <button onclick="selectBaseType('Полицейский участок')">👮 Полицейский участок - 1000₽</button>
  <button onclick="selectBaseType('Больница')">🚑 Больница - 1500₽</button>
  <button onclick="selectBaseType('Пожарная часть')">🚒 Пожарная часть - 2000₽</button>
  <button onclick="selectBaseType('Диспетчерский пункт')">🎙 Диспетчерский пункт - 2500₽</button>
  <br />
  <button onclick="cancelAddBase()" class="cancel-btn" style="margin-top:10px;">❌ Отменить строительство</button>
</div>

<button onclick="manualAddBase()" id="add-base-btn">Построить здание</button>


  <div id="sidebar">

    <h2>Панель управления</h2>
    <button onclick="manualAddBase()">➕ Построить здание</button>
    <hr>
    <div id="testing-block">
      <h3>Тестирование</h3>
      <select id="call-type-select">
        <option value="">Случайный вызов</option>
      </select>
      <button onclick="generateCallTester()" id="generate-call-btn">🚨 Сгенерировать вызов</button>
      <?php if(!empty($_SESSION['is_admin'])): ?>
      <button onclick="setSkipUnload(); window.location.href='admin_panel.php';">Админ-панель</button>
      <button onclick="window.location.href='news_admin.php';">Новости</button>
      <?php endif; ?>
    </div>
    <hr>
    <div id="status" style="font-size: 13px; color: #333;"></div>
  </div>
  
  <div id="map"></div>
  <div id="calllist"></div>
  <div id="history-modal">
    <div class="modal-content">
      <span class="modal-close" onclick="closeHistoryModal()">&#x2715;</span>
      <div id="rating-history"></div>
      <hr>
      <div id="balance-history"></div>
    </div>
  </div>

  <div id="base-modal">
    <div class="modal-content">
      <span class="modal-close" onclick="closeBasePanel()">&#x2715;</span>
      <div id="base-panel"></div>
    </div>
  </div>
  <div id="vehicle-modal">
    <div class="modal-content">
      <span class="modal-close" onclick="closeVehicleModal()">&#x2715;</span>
      <div id="vehicle-info"></div>
    </div>
  </div>
  <div id="cart-modal">
    <div class="modal-content">
      <span class="modal-close" onclick="closeCartModal()">&#x2715;</span>
      <div id="cart-content"></div>
    </div>
  </div>
  <div id="call-modal">
    <div class="modal-content">
      <span class="modal-close" onclick="closeCallModal()">&#x2715;</span>
      <div id="call-content"></div>
    </div>
  </div>
  <div id="profile-modal">
    <div class="modal-content">
      <span class="modal-close" onclick="closeProfileModal()">&#x2715;</span>
      <div id="profile-content"></div>
    </div>
  </div>
  <div id="bug-report-modal">
    <div class="modal-content">
      <span class="modal-close" onclick="closeBugReportModal()">&#x2715;</span>
      <iframe id="bug-report-frame" src="" style="width:100%;height:100%;border:none;"></iframe>
    </div>
  </div>
  <div id="news-window">
    <button id="news-collapse-btn" class="collapse-btn">&#x25B2;</button>
    <button id="news-readall-btn" class="read-all-btn">Прочитать всё</button>
    <h3>Новости</h3>
    <div id="news-content"><p>Загрузка...</p></div>
  </div>

  <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>

<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>



  <script src="main.js?v=<?php echo asset_version('main.js'); ?>"></script>
  <script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
</body>
</html>
