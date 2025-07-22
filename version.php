<?php
function asset_version(string $file): int {
    $path = __DIR__ . '/' . ltrim($file, '/');
    return is_file($path) ? filemtime($path) : time();
}
?>
