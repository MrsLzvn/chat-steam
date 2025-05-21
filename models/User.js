// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  steamId: String,
  personaname: String,
  avatar: String,
  profileurl: String,
  isPublic: Boolean, // 👈 ДОБАВЛЕНО
  lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
