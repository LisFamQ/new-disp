const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(express.static(__dirname + '/public'));
// ⚠️ не нужно ручками подключать socket.io.js — сервер отдаёт сам

io.on('connection', (socket) => {
  console.log('🔌 Новое подключение');

  socket.on('chat message', (msg) => {
    // отправляем сообщение всем подключённым клиентам
    io.emit('chat message', msg);
  });

  socket.on('balance update', (data) => {
    // рассылаем новую сумму баланса всем клиентам
    io.emit('balance update', data);
  });

  socket.on('rating update', (data) => {
    // рассылаем новое значение рейтинга всем клиентам
    io.emit('rating update', data);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
