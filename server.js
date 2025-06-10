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

const fs = require('fs');

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

// Настройка шаблонизатора Mustache
app.engine('mustache', mustacheExpress());
app.set('view engine', 'mustache');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // 🔐 Render — это прокси, чтобы Express знал про HTTPS

// Настройка сессий
app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,       // 🔐 куки только по HTTPS
    sameSite: 'lax'     // 🛡️ защита от CSRF, без ломания логина
  }
}));


app.use(passport.initialize());
app.use(passport.session());
app.use((err, req, res, next) => {
    console.error('🔥 Ошибка на сервере:', err.stack);
    res.status(500).send('Что-то пошло не так!');
});


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
    console.log('🛬 Получен профиль от Steam:', {
      steamId: profile.id,
      displayName: profile.displayName
  });
  

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
      console.log('✅ Аутентификация прошла успешно. Сессия:', req.session);
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
    const friendsList = await getFriends(steamId); // ⬅ используем готовую функцию
    res.json(friendsList);
  } catch (err) {
    console.error('❌ Ошибка получения друзей:', err.message);
    res.status(500).json({ error: 'Не удалось загрузить друзей' });
  }
});



// 🔄 Получение данных из Steam API
const steamProfileCache = new Map();
const CACHE_TTL = 60 * 1000; // 60 секунд

async function getSteamProfile(steamId) {
  const now = Date.now();
  const cached = steamProfileCache.get(steamId);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    console.log(`⚡ Кэш Hit: профиль ${steamId} взят из памяти`);
    return cached.data;
  }

  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`;
    
    console.log(`🌐 Отправка запроса к Steam API: ${url}`);
    const response = await axios.get(url);

    console.log(`📡 Статус ответа Steam API: ${response.status}`);

    const players = response.data?.response?.players;

    if (!players || players.length === 0) {
      console.warn(`⚠️ Профиль Steam ${steamId} не найден или пустой ответ`);
      return null;
    }

    const profile = players[0];

    // Сохраняем в кэш
    steamProfileCache.set(steamId, {
      data: profile,
      timestamp: now
    });

    console.log(`🛬 Получен и закэширован профиль от Steam:`, profile);
    return profile;
    
  } catch (error) {
    if (error.response?.status === 429) {
      console.error('🚫 Превышен лимит запросов к Steam API (429 Too Many Requests)');
    } else {
      console.error('❌ Ошибка получения профиля Steam API:', error.message);
    }
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
  let user = null;

  try {
    const response = await axios.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', {
      params: {
        key: STEAM_API_KEY,
        steamids: steamId,
      },
    });

    if (
      response.data &&
      response.data.response &&
      response.data.response.players &&
      response.data.response.players.length > 0
    ) {
      user = response.data.response.players[0];
    } else {
      console.warn(`⚠️ Steam API вернул пустой список игроков для SteamID ${steamId}`);
      return res.status(404).json({
        error: 'Пользователь не найден. Возможно, профиль скрыт или Steam API временно недоступен.'
      });
    }

  } catch (err) {
    console.error('❌ Ошибка получения информации о пользователе Steam:', err.message);
    return res.status(500).json({
      error: 'Не удалось получить информацию о пользователе Steam. Попробуйте позже.'
    });
  }

  res.json(user);
});


app.get('/profile/:steamId', async (req, res) => {
  const steamId = req.params.steamId;

  try {
    const [summaryRes, bansRes, gamesRes] = await Promise.all([
      axios.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', {
        params: { key: STEAM_API_KEY, steamids: steamId }
      }),
      axios.get('https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/', {
        params: { key: STEAM_API_KEY, steamids: steamId }
      }),
      axios.get('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/', {
        params: {
          key: STEAM_API_KEY,
          steamid: steamId,
          include_appinfo: true,
          include_played_free_games: true
        }
      })
    ]);

    const player = summaryRes.data.response.players[0];
    const banInfo = bansRes.data.players[0];
    const allGames = gamesRes.data.response?.games || [];

    const sortedGames = allGames
      .filter(g => g.playtime_forever > 0)
      .sort((a, b) => b.playtime_forever - a.playtime_forever)
      .slice(0, 10)
      .map(game => ({
        name: game.name,
        playtime: (game.playtime_forever / 60).toFixed(1),
        icon: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/capsule_184x69.jpg`,
        url: `https://store.steampowered.com/app/${game.appid}`
      }));

    const personastate = player.personastate || 0;
    const isOnline = personastate > 0;
    const isInGame = !!player.gameextrainfo;

    const statusLabel = isInGame
      ? `🎮 В игре (${player.gameextrainfo})`
      : isOnline
      ? '🟢 Онлайн'
      : '⚫ Оффлайн';

    let statusClass = 'status-offline';
    if (isInGame) statusClass = 'status-ingame';
    else if (isOnline) statusClass = 'status-online';

    const lastOnline = player.lastlogoff
      ? moment.unix(player.lastlogoff).fromNow()
      : 'Неизвестно';

    const user = {
      steamid: player.steamid,
      personaname: player.personaname,
      profileurl: player.profileurl,
      avatar: player.avatarfull,
      avatarfull: player.avatarfull,
      lastOnline,
      isOnline,
      statusLabel,
      statusClass,
      bans: banInfo,
      games: sortedGames
    };

    res.render('profile', { user });
  } catch (err) {
    console.error('❌ Ошибка загрузки профиля Steam:', err.message);
    res.status(500).send('Ошибка загрузки профиля Steam');
  }
});



const NodeCache = require('node-cache');
const friendsCache = new NodeCache({ stdTTL: 300 }); // Кэш на 5 минут

async function getFriends(steamId) {
  const cached = friendsCache.get(steamId);
  if (cached) return cached;

  try {
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

    const friendIds = friendListResponse.data.friendslist.friends.map(f => f.steamid);

    const chunkSize = 100;
    const profileChunks = [];

    for (let i = 0; i < friendIds.length; i += chunkSize) {
      const chunk = friendIds.slice(i, i + chunkSize).join(',');

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

    const friendsList = profileChunks
      .filter(p => p?.steamid && p?.personaname)
      .map(p => {
        const isInGame = p.gameextrainfo !== undefined;
        const isOnline = p.personastate > 0;

        let statusClass = 'offline';
        if (isInGame) statusClass = 'ingame';
        else if (isOnline) statusClass = 'online';

        return {
          steamid: p.steamid,
          personaname: p.personaname,
          avatar: p.avatarfull,
          profileurl: p.profileurl,
          online: isOnline,
          inGame: isInGame,
          game: p.gameextrainfo || null,
          statusClass
        };
      });

    // ✅ Сортировка: в игре → онлайн → оффлайн
    friendsList.sort((a, b) => {
      const statusScore = (f) => f.inGame ? 2 : f.online ? 1 : 0;
      return statusScore(b) - statusScore(a);
    });

    friendsCache.set(steamId, friendsList);
    return friendsList;

  } catch (error) {
    console.error('Ошибка получения друзей:', error.message);
    throw new Error('Не удалось загрузить список друзей');
  }
}


// Маршрут со страницами друзей
app.get('/friends', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  try {
    const steamId = req.user.steamId;
    const page = parseInt(req.query.page) || 1;
    const perPage = 12;

    // Получаем уже отсортированных друзей по статусу (в игре → онлайн → оффлайн)
    const friendsList = await getFriends(steamId);

    const total = friendsList.length;
    const totalPages = Math.ceil(total / perPage);
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;

    res.render('friends', {
      friends: friendsList.slice(startIndex, endIndex), // ❗ не переопределяем сортировку
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

    const isOnline = friend.personastate > 0;
    const isInGame = !!friend.gameextrainfo;

    let statusClass = 'status-offline';
    if (isInGame) statusClass = 'status-ingame';
    else if (isOnline) statusClass = 'status-online';

    friend.statusClass = statusClass;


    const roomId = [user.steamId, friendId].sort().join('_');
    const messages = await Message.find({ roomId }).sort({ timestamp: 1 });

    const formattedMessages = messages.map(msg => ({
      ...msg._doc,
      timestamp: moment(msg.timestamp).format('D MMM HH:mm')
    }));

    const fixedUser = {
      ...req.user,
      avatarfull: req.user.avatarfull || req.user.avatar?.replace(/\.jpg$/, '_full.jpg')
    };
    

    res.render('chat', {
      user: fixedUser,
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

app.get('/docs', (req, res) => {
  const specPath = path.join(__dirname, 'swagger.yaml');
  const spec = fs.readFileSync(specPath, 'utf8').replace(/'/g, "\\'");
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>API Docs</title>
        <meta charset="utf-8"/>
        <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
      </head>
      <body>
        <redoc spec='${spec}'></redoc>
      </body>
    </html>
  `);
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
      steamAvatar: user.avatarfull,
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