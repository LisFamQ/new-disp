const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const db = mysql.createPool({
  host: 'localhost',
  user: 'lis',
  password: 'xdC5Hkz-e4',
  database: 'game',
  waitForConnections: true
});

app.use(express.static(__dirname + '/public'));
// ⚠️ не нужно ручками подключать socket.io.js — сервер отдаёт сам

io.on('connection', (socket) => {
  console.log('🔌 Новое подключение');

  let userId = null;

  socket.on('register', (data) => {
    if (data && typeof data.userId === 'number') {
      userId = data.userId;
    }
  });

  socket.on('chat message', (msg) => {
    io.emit('chat message', msg);
  });

  socket.on('balance update', async (data) => {
    const uid = (data && typeof data.userId === 'number') ? data.userId : userId;
    io.emit('balance update', data);
    if (typeof uid === 'number') {
      try {
        await db.execute('UPDATE player_data SET balance=? WHERE user_id=?', [data.balance, uid]);
      } catch (e) {
        console.error('DB error:', e);
      }
    }
  });

  socket.on('rating update', async (data) => {
    const uid = (data && typeof data.userId === 'number') ? data.userId : userId;
    io.emit('rating update', data);
    if (typeof uid === 'number') {
      try {
        await db.execute('UPDATE player_data SET rating=? WHERE user_id=?', [data.rating, uid]);
      } catch (e) {
        console.error('DB error:', e);
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
