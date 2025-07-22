<?php
require_once 'session.php';
require 'db.php';
$uid = $_SESSION['user_id'] ?? null;
if ($uid) {
    $pdo->prepare('UPDATE user_status SET last_online=NOW() WHERE user_id=?')->execute([$uid]);
}
session_destroy();
header('Location: index.php');
exit;
?>
