<?php
require_once 'session.php';
require 'db.php';
require_once 'version.php';
if (empty($_SESSION['is_admin'])) {
    http_response_code(403);
    echo 'Access denied';
    exit;
}
$user_id = (int)($_GET['id'] ?? 0);
$stmt = $pdo->prepare('SELECT username FROM users WHERE id=?');
$stmt->execute([$user_id]);
$user = $stmt->fetch();
if (!$user) {
    echo 'User not found';
    exit;
}
$pd = $pdo->prepare('SELECT bases FROM player_data WHERE user_id=?');
$pd->execute([$user_id]);
$row = $pd->fetch();
$bases = $row ? json_decode($row['bases'], true) : [];
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Здания игрока <?php echo htmlspecialchars($user['username']); ?></title>
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>">
</head>
<body>
<script>(function(){var dark=localStorage.getItem('darkMode')==='true';if(dark)document.body.classList.add('dark-mode');})();</script>
<div id="topbar">
  <a href="admin_panel.php">Назад</a>
  <a href="index.php?user=<?php echo $user_id; ?>">Управлять</a>
  <a href="bug_report.php">Баг-репорт</a>
  <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>
</div>
<div id="map-status" style="display:block;">Здания игрока <?php echo htmlspecialchars($user['username']); ?></div>
<div id="map"></div>
<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
<script>
const bases = <?php echo json_encode($bases); ?>;
const map = L.map('map').setView([56.36, 41.32], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
}).addTo(map);
const icons = {
  "Полицейский участок": new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/9830/9830833.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  }),
  "Больница": new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/15406/15406239.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  }),
  "Пожарная часть": new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/11210/11210082.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  })
};
const baseTypeNames = { 'Полицейский участок': 'Полицейский участок', 'Больница': 'Больница', 'Пожарная часть': 'Пожарная часть' };
const markers = [];
bases.forEach(b => {
  const icon = icons[b.type] || icons['Полицейский участок'];
  const m = L.marker([b.lat, b.lng], { icon }).addTo(map)
    .bindPopup(`<strong>${b.name}</strong><br>Тип: ${baseTypeNames[b.type] || b.type}`);
  markers.push(m);
});
if (markers.length) {
  const group = L.featureGroup(markers);
  map.fitBounds(group.getBounds().pad(0.2));
}
</script>
<script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
</body>
</html>
