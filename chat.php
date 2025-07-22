<?php
require_once 'session.php';
header('Content-Type: application/json');
require 'db.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $since = isset($_GET['since']) ? (int)$_GET['since'] : 0;
    $stmt = $pdo->prepare('SELECT c.id, u.username, c.message, c.created_at FROM chat_messages c JOIN users u ON c.user_id=u.id WHERE c.id>? ORDER BY c.id ASC');
    $stmt->execute([$since]);
    echo json_encode($stmt->fetchAll());
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
    $input = json_decode(file_get_contents('php://input'), true);
    $msg = trim($input['message'] ?? '');
    if ($msg === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Empty message']);
        exit;
    }
    $stmt = $pdo->prepare('INSERT INTO chat_messages (user_id, message) VALUES (?, ?)');
    $stmt->execute([$_SESSION['user_id'], $msg]);
    echo json_encode(['status'=>'ok', 'id'=>$pdo->lastInsertId()]);
    exit;
}

http_response_code(405);
echo json_encode(['error'=>'Method not allowed']);
?>
