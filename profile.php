<?php
require_once 'session.php';
header('Content-Type: application/json');
require 'db.php';

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

$user_id = (int)$_SESSION['user_id'];
if (!empty($_SESSION['is_admin']) && isset($_REQUEST['id'])) {
    $user_id = (int)$_REQUEST['id'];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $pdo->prepare('SELECT status_text, last_online FROM user_status WHERE user_id=?');
    $stmt->execute([$user_id]);
    $row = $stmt->fetch();
    if (!$row) {
        $row = ['status_text' => '', 'last_online' => null];
    }
    $online = false;
    if ($row['last_online']) {
        $dt = new DateTime($row['last_online']);
        $online = (time() - $dt->getTimestamp()) < 300; // 5 min
    }
    echo json_encode([
        'status_text' => $row['status_text'],
        'last_online' => $row['last_online'],
        'online' => $online
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($user_id !== (int)$_SESSION['user_id']) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }
    $input = json_decode(file_get_contents('php://input'), true);
    $text = trim($input['status_text'] ?? '');
    $stmt = $pdo->prepare('INSERT INTO user_status (user_id, status_text, last_online) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE status_text=VALUES(status_text), last_online=NOW()');
    $stmt->execute([$user_id, $text]);
    echo json_encode(['status' => 'ok']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
