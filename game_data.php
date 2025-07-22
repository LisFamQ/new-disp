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
$stmt = $pdo->prepare('SELECT last_online FROM user_status WHERE user_id=?');
$stmt->execute([$user_id]);
$last_online = $stmt->fetchColumn();
$pdo->prepare('INSERT INTO user_status (user_id, last_online) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE last_online=NOW()')->execute([$user_id]);
if (!empty($_SESSION['is_admin']) && isset($_REQUEST['id'])) {
    $user_id = (int)$_REQUEST['id'];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $pdo->prepare('SELECT balance, rating, bases, calls FROM player_data WHERE user_id = ?');
    $stmt->execute([$user_id]);
    $row = $stmt->fetch();
    if (!$row) {
        $row = ['balance' => 10000, 'rating' => 100, 'bases' => '[]', 'calls' => '[]'];
        $ins = $pdo->prepare('INSERT INTO player_data (user_id, balance, rating, bases, calls) VALUES (?, ?, ?, ?, ?)');
        $ins->execute([$user_id, $row['balance'], $row['rating'], $row['bases'], $row['calls']]);
    }
    $row['bases'] = json_decode($row['bases'], true) ?: [];
    $row['calls'] = json_decode($row['calls'], true) ?: [];
    $row['last_online'] = $last_online;
    echo json_encode($row);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) $input = [];
    $balance = isset($input['balance']) ? (int)$input['balance'] : 0;
    $rating  = isset($input['rating']) ? (int)$input['rating'] : 100;
    $bases = json_encode($input['bases'] ?? []);
    $calls = json_encode($input['calls'] ?? []);
    $stmt = $pdo->prepare('INSERT INTO player_data (user_id, balance, rating, bases, calls)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE balance=VALUES(balance), rating=VALUES(rating), bases=VALUES(bases), calls=VALUES(calls)');
    $stmt->execute([$user_id, $balance, $rating, $bases, $calls]);
    echo json_encode(['status' => 'ok']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
