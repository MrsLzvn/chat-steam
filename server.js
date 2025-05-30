require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const http = require('http');
const cors = require('cors');
const path = require('path');
const mustacheExpress = require('mustache-express');
const axios = require('axios');

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

const moment = require('moment'); // npm install moment


// 🔧 Подключение к MongoDB с обработкой ошибок
async function connectToMongoDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Подключение к MongoDB успешно');
  } catch (err) {
    console.error('❌ Ошибка подключения к MongoDB:', err.message);
    process.exit(1);
  }
}
connectToMongoDB();

// Настройка CORS
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Настройка шаблонизатора Mustach
app.engine('mustache', mustacheExpress());
app.set('view engine', 'mustache');
app.set('views', path.join(__dirname, 'views'));

// Настройка сессий
app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

//  Конфигурация Steam-авторизации с обработкой ошибок
passport.use(new SteamStrategy({
  returnURL: process.env.STEAM_RETURN_URL,
  realm: process.env.STEAM_REALM,
  apiKey: process.env.STEAM_API_KEY
}, async (identifier, profile, done) => {
  try {
    const steamId = profile.id;
    const personaname = profile.displayName;
    const avatar = profile.photos[0].value;
    const profileurl = profile._json.profileurl;

    console.log(`🟢 Авторизация: ${personaname} (${steamId})`);

    let user = await User.findOneAndUpdate(
      { steamId: steamId },
      { personaname, avatar, profileurl },
      { upsert: true, new: true }
    );

    return done(null, user);
  } catch (err) {
    console.error('❌ Ошибка SteamStrategy:', err.message);
    return done(err);
  }
}));


passport.serializeUser((user, done) => {
  done(null, user.steamId);
});
passport.deserializeUser(async (steamId, done) => {
  try {
    const user = await User.findOne({ steamId });
    done(null, user);
  } catch (err) {
    done(err);
  }
});


// 🚪 Маршруты авторизации
app.get('/auth/steam', passport.authenticate('steam'));

app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }),
  async (req, res) => {
    try {
      res.redirect('/friends');
    } catch (error) {
      console.error('❌ Ошибка редиректа после Steam авторизации:', error.message);
      res.status(500).send('Ошибка авторизации через Steam');
    }
  }
);

app.get('/', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/auth/steam');
  res.redirect('/friends');
});


app.get('/api/friend/:steamid', async (req, res) => {
  const steamId = req.params.steamid;
  try {
      const user = await getSteamUserInfo(steamId);
      res.json({ success: true, friend: user });
  } catch (err) {
      res.json({ success: false, error: 'Не удалось получить информацию о друге' });
  }
});

app.get('/api/friends', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Не авторизован' });

  try {
    const steamId = req.user.steamId;
    const response = await axios.get(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/`, {
      params: {
        key: STEAM_API_KEY,
        steamid: steamId,
        relationship: 'friend',
      },
    });

    const friendIds = response.data.friendslist.friends.map(f => f.steamid).join(',');
    const profileResponse = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/`, {
      params: {
        key: STEAM_API_KEY,
        steamids: friendIds,
      },
    });

    const friends = profileResponse.data.response.players.map(p => ({
      steamid: p.steamid,
      personaname: p.personaname,
      avatar: p.avatarfull,
      profileurl: p.profileurl,
      online: p.personastate > 0
    }));
    res.json(friends);    
  } catch (err) {
    console.error('❌ Ошибка получения друзей:', err.message);
    res.status(500).json({ error: 'Не удалось загрузить друзей' });
  }
});


// 🔄 Получение данных из Steam API
async function getSteamProfile(steamId) {
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`;
    const response = await axios.get(url);
    const players = response.data.response.players;
    return players.length > 0 ? players[0] : null;
  } catch (error) {
    console.error('❌ Ошибка получения профиля Steam API:', error.message);
    return null;
  }
}

// 👤 Получение текущего пользователя
app.get('/steam-profile', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    res.json(req.user);
  } catch (error) {
    console.error('❌ Ошибка steam-profile:', error.message);
    res.status(500).json({ error: 'Ошибка получения профиля' });
  }
});

app.get('/steam-user/:steamId', async (req, res) => {
  const steamId = req.params.steamId;
  try {
    const response = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/`, {
      params: {
        key: STEAM_API_KEY,
        steamids: steamId,
      },
    });
    const user = response.data.response.players[0];
    res.json(user);
  } catch (err) {
    console.error('Ошибка получения информации о пользователе Steam:', err.message);
    res.status(500).json({ error: 'Не удалось получить информацию о пользователе Steam' });
  }
});

app.get('/profile/:steamId', async (req, res) => {
  const steamId = req.params.steamId;

  try {
      const apiKey = process.env.STEAM_API_KEY;
      const response = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`);
      const data = await response.json();
      const player = data.response.players[0];

      const user = {
          steamid: player.steamid,
          personaname: player.personaname,
          profileurl: player.profileurl,
          avatar: player.avatarfull,
          avatarfull: player.avatarfull,
          lastOnline: moment.unix(player.lastlogoff).fromNow(),
          isOnline: player.personastate > 0 // 0 = offline
      };

      res.render('profile', { user });
  } catch (err) {
      console.error(err);
      res.status(500).send('Ошибка загрузки профиля Steam');
  }
});

const NodeCache = require('node-cache');
const friendsCache = new NodeCache({ stdTTL: 300 }); // Кэш на 5 минут

async function getFriends(steamId) {
  // Проверка кэша
  const cached = friendsCache.get(steamId);
  if (cached) return cached;

  try {
    // Получение списка друзей
    const friendListResponse = await axios.get(
      'https://api.steampowered.com/ISteamUser/GetFriendList/v1/',
      {
        params: {
          key: STEAM_API_KEY,
          steamid: steamId,
          relationship: 'friend'
        }
      }
    );

    // Извлечение SteamID друзей
    const friendIds = friendListResponse.data.friendslist.friends.map(f => f.steamid);

    // Разбиение на чанки по 100 SteamID
    const chunkSize = 100;
    const profileChunks = [];
    
    for (let i = 0; i < friendIds.length; i += chunkSize) {
      const chunk = friendIds.slice(i, i + chunkSize).join(',');
      
      // Запрос данных профилей для чанка
      const profileResponse = await axios.get(
        'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
        {
          params: {
            key: STEAM_API_KEY,
            steamids: chunk
          }
        }
      );
      
      profileChunks.push(...profileResponse.data.response.players);
    }

    // Фильтрация и преобразование данных
    const friendsList = profileChunks
      .filter(p => p?.steamid && p?.personaname) // Валидация профилей
      .map(p => ({
        steamid: p.steamid,
        personaname: p.personaname,
        avatar: p.avatarfull,
        profileurl: p.profileurl,
        online: p.personastate > 0
      }));

    // Сохранение в кэш
    friendsCache.set(steamId, friendsList);
    
    return friendsList;

  } catch (error) {
    console.error('Ошибка получения друзей:', error.message);
    throw new Error('Не удалось загрузить список друзей');
  }
}

// Маршрут со страницами друзей
// server.js (исправленный фрагмент)
app.get('/friends', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  try {
    const steamId = req.user.steamId;
    const page = parseInt(req.query.page) || 1;
    const perPage = 12;

    const friendsList = await getFriends(steamId);
    const sortedFriends = [...friendsList].sort((a, b) => 
      a.steamid.localeCompare(b.steamid)
    );

    const total = sortedFriends.length;
    const totalPages = Math.ceil(total / perPage);
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;

    res.render('friends', {
      friends: sortedFriends.slice(startIndex, endIndex),
      currentPage: page,
      totalPages: totalPages,
      total: total,
      hasPagination: totalPages > 1,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page - 1,
      nextPage: page + 1
    });

  } catch (error) {
    console.error('Ошибка:', error.message);
    res.status(500).send('Ошибка загрузки страницы');
  }
});


// 🚪 Выход из аккаунта
app.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) {
      console.error('❌ Ошибка при выходе:', err.message);
      return res.status(500).send('Ошибка выхода');
    }
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

app.get('/chat', (req, res) => {
  res.redirect('/friends');
});

// Приватный чат с другом

app.get('/chat/:friendId', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const user = await User.findOne({ steamId: req.user.steamId });
  


  if (!user) {
    return res.status(404).send('Пользователь не найден');
  }

  try {
    const friendId = req.params.friendId;
    const friend = await getSteamProfile(friendId);
    const roomId = [user.steamId, friendId].sort().join('_');
    const messages = await Message.find({ roomId }).sort({ timestamp: 1 });

    const formattedMessages = messages.map(msg => ({
      ...msg._doc,
      timestamp: moment(msg.timestamp).format('D MMM HH:mm')
    }));

    res.render('chat', {
      user: req.user,
      friend: friend,
      messages: formattedMessages,
      roomId: roomId,
      isPrivate: true
    });
  } catch (error) {
    console.error('Ошибка загрузки чата:', error);
    res.status(500).render('error', { 
      message: 'Ошибка загрузки чата',
      error: error.message 
    });
  }
});


// 🧠 Подключение Socket.io
let users = [];

io.on('connection', (socket) => {
  console.log('🔵 Пользователь подключен:', socket.id);

 
// server.js
socket.on('joinPrivateChat', async ({ userId, friendId }) => {
  try {
    const roomId = [userId, friendId].sort().join('_');
    socket.join(roomId);
    
    // Добавляем логирование
    console.log(`🟢 Пользователь ${userId} присоединился к комнате ${roomId}`);
    
    const messages = await Message.find({ roomId }).sort({ timestamp: 1 });
    socket.emit('chatHistory', messages.map(msg => ({
      ...msg._doc,
      timestamp: moment(msg.timestamp).format('D MMM HH:mm')
    })));
  } catch (err) {
    console.error('❌ Ошибка joinPrivateChat:', err.message);
  }
});

// В обработчике sendPrivateMessage
// server.js
// server.js
socket.on('sendPrivateMessage', async ({ userId, friendId, message, roomId }) => {
  try {
    const user = await User.findOne({ steamId: userId });
    if (!user) {
      console.error('Пользователь не найден');
      return;
    }

    // Создаем roomId, если не передан
    const finalRoomId = roomId || [userId, friendId].sort().join('_');
    
    const messageData = {
      text: message,
      steamName: user.personaname,
      steamAvatar: user.avatar,
      timestamp: new Date(),
      roomId: finalRoomId
    };

    // Сохраняем в БД
    const newMessage = new Message(messageData);
    await newMessage.save();

    // Отправляем в комнату с форматированием времени
    io.to(finalRoomId).emit('message', {
      ...messageData,
      timestamp: moment(messageData.timestamp).format('D MMM HH:mm')
    });

    console.log(`Сообщение сохранено в комнате ${finalRoomId}`);

  } catch (err) {
    console.error('❌ Ошибка sendPrivateMessage:', err.message);
  }
});

  socket.on('disconnect', () => {
    console.log('🔴 Пользователь отключен:', socket.id);
    users = users.filter((u) => u.id !== socket.id);
  });
});


// 🌍 Запуск сервера
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});

// 🧯 Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Необработанное отклонение промиса:', reason);
});
