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
    $rs = $pdo->prepare('SELECT change_amount, reason, time FROM rating_history WHERE user_id=? ORDER BY time ASC');
    $rs->execute([$user_id]);
    $bs = $pdo->prepare('SELECT change_amount, reason, time FROM balance_history WHERE user_id=? ORDER BY time ASC');
    $bs->execute([$user_id]);
    echo json_encode([
        'rating_history' => $rs->fetchAll(),
        'balance_history' => $bs->fetchAll()
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) $input = [];
    $type = $input['type'] ?? '';
    $change = isset($input['change']) ? (int)$input['change'] : 0;
    $reason = trim($input['reason'] ?? '');
    if ($type === 'rating') {
        $stmt = $pdo->prepare('INSERT INTO rating_history (user_id, change_amount, reason) VALUES (?, ?, ?)');
        $stmt->execute([$user_id, $change, $reason]);
    } elseif ($type === 'balance') {
        $stmt = $pdo->prepare('INSERT INTO balance_history (user_id, change_amount, reason) VALUES (?, ?, ?)');
        $stmt->execute([$user_id, $change, $reason]);
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid type']);
        exit;
    }
    echo json_encode(['status' => 'ok']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
