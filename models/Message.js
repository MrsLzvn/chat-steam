const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  text: String,
  steamName: String,
  steamAvatar: String,
  timestamp: { type: Date, default: Date.now },
  roomId: String, // Добавлено для поддержки приватных чатов
});

module.exports = mongoose.model('Message', messageSchema);
