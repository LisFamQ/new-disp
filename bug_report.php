<?php
require_once 'session.php';
require_once 'version.php';
$error = '';
$success = false;
$embedded = isset($_GET['embedded']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $title = trim($_POST['title'] ?? '');
    $message = trim($_POST['message'] ?? '');
    $video = trim($_POST['video'] ?? '');
    $nickname = $_SESSION['user'] ?? 'Гость';
    if ($title && $message) {
        $key  = getenv('TRELLO_KEY');
        $token = getenv('TRELLO_TOKEN');
        $list = getenv('TRELLO_LIST_ID');
        if ($key && $token && $list) {
            $desc = "Ник: $nickname\n\n$message";
            if ($video) {
                $desc .= "\n\nВидео: $video";
            }
            $url = 'https://api.trello.com/1/cards';
            $data = http_build_query([
                'name'   => $title,
                'desc'   => $desc,
                'idList' => $list,
                'key'    => $key,
                'token'  => $token
            ]);
            $opts = [
                'http' => [
                    'method'  => 'POST',
                    'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
                    'content' => $data
                ]
            ];
            $context = stream_context_create($opts);
            $result = @file_get_contents($url, false, $context);
            if ($result === false) {
                $error = 'Не удалось отправить сообщение в Trello';
            } else {
                $card = json_decode($result, true);
                $hasFile = isset($_FILES['screenshot']) && $_FILES['screenshot']['error'] === UPLOAD_ERR_OK;
                $base64 = trim($_POST['screenshot_base64'] ?? '');
                if (isset($card['id']) && ($hasFile || $base64)) {
                    $attachUrl = "https://api.trello.com/1/cards/{$card['id']}/attachments?key={$key}&token={$token}";
                    $boundary = uniqid();
                    if ($hasFile) {
                        $file = file_get_contents($_FILES['screenshot']['tmp_name']);
                        $filename = basename($_FILES['screenshot']['name']);
                        $contentType = mime_content_type($_FILES['screenshot']['tmp_name']);
                    } else {
                        if (preg_match('/^data:(.*);base64,(.*)$/', $base64, $m)) {
                            $contentType = $m[1];
                            $file = base64_decode($m[2]);
                        } else {
                            $file = base64_decode($base64);
                            $contentType = 'image/png';
                        }
                        $filename = 'pasted_image.' . explode('/', $contentType)[1];
                    }
                    $payload = "--$boundary\r\n".
                        "Content-Disposition: form-data; name=\"file\"; filename=\"$filename\"\r\n".
                        "Content-Type: $contentType\r\n\r\n".
                        $file."\r\n".
                        "--$boundary--\r\n";
                    $opts = [
                        'http' => [
                            'method' => 'POST',
                            'header' => "Content-Type: multipart/form-data; boundary=$boundary\r\n".
                                        "Content-Length: ".strlen($payload)."\r\n",
                            'content' => $payload
                        ]
                    ];
                    @file_get_contents($attachUrl, false, stream_context_create($opts));
                }
                $success = true;
            }
        } else {
            $error = 'Не настроены переменные TRELLO_KEY, TRELLO_TOKEN и TRELLO_LIST_ID';
        }
    } else {
        $error = 'Заполните все поля';
    }
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Сообщить об ошибке</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<link rel="icon" href="favicon_bug.png" type="image/png" />
<link rel="stylesheet" href="style.css?v=<?php echo asset_version('style.css'); ?>">
</head>
<body class="bug-report-page<?php echo $embedded ? ' embedded' : ''; ?>">
<script>(function(){var dark=localStorage.getItem('darkMode')==='true';if(dark)document.body.classList.add('dark-mode');})();</script>
<?php if (!$embedded): ?>
  <div id="topbar">
    <a href="index.php">На главную</a>
    <button id="toggle-theme-btn" class="btn" onclick="toggleTheme()">🌙 Тёмная тема</button>
  </div>
<?php endif; ?>
  <div class="bug-report-box">
    <h2>Сообщить об ошибке</h2>
    <?php if ($success): ?>
      <p>Ваш отчёт отправлен. Спасибо!</p>
      <script>
        setTimeout(function () {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({type: 'bug-report-submitted'}, '*');
          } else {
            window.close();
          }
        }, 5000);
      </script>
    <?php else: ?>
      <?php if ($error): ?><p class="error"><?php echo htmlspecialchars($error); ?></p><?php endif; ?>
      <form method="post" enctype="multipart/form-data">
        <input type="text" name="title" placeholder="Краткое описание" required>
        <textarea name="message" placeholder="Подробности" required></textarea>
        <input type="file" name="screenshot" accept="image/*">
        <input type="hidden" name="screenshot_base64" id="screenshot_base64">
        <img id="screenshot-preview" class="screenshot-preview" alt="" />
        <p class="small-note">Можно вставить изображение из буфера обмена (Ctrl+V)</p>
        <input type="url" name="video" placeholder="Ссылка на видео">
        <?php if (isset($_SESSION['user'])): ?>
          <p>Ваш ник: <?php echo htmlspecialchars($_SESSION['user']); ?></p>
        <?php endif; ?>
        <button type="submit">Отправить</button>
      </form>
    <?php endif; ?>
  </div>
  <script src="theme.js?v=<?php echo asset_version('theme.js'); ?>"></script>
  <script>
  document.addEventListener('DOMContentLoaded', function () {
    const hidden = document.getElementById('screenshot_base64');
    const form = document.querySelector('.bug-report-box form');
    const fileInput = form.querySelector('input[name="screenshot"]');
    const preview = document.getElementById('screenshot-preview');
    if (!form || !hidden || !fileInput || !preview) return;

    function showPreview(src) {
      preview.src = src;
      preview.style.display = 'block';
    }

    fileInput.addEventListener('change', function () {
      hidden.value = '';
      if (fileInput.files && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = function (ev) {
          showPreview(ev.target.result);
        };
        reader.readAsDataURL(fileInput.files[0]);
      } else {
        preview.style.display = 'none';
        preview.src = '';
      }
    });

    form.addEventListener('paste', function (e) {
      const items = (e.clipboardData || window.clipboardData).items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.indexOf('image') === 0) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = function(ev) {
              hidden.value = ev.target.result;
              fileInput.value = '';
              showPreview(ev.target.result);
            };
            reader.readAsDataURL(file);
            e.preventDefault();
            break;
          }
        }
      }
    });
  });
  </script>
</body>
</html>
