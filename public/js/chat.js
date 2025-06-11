// chat.js
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const container = btn.closest('.message');
    const textBlock = container.querySelector('.message-text');
    showCopiedIndicator(textBlock);
  });
}

function showCopiedIndicator(targetElement) {
  const indicator = document.createElement('div');
  indicator.textContent = 'Скопировано';
  indicator.className = 'copy-indicator';
  targetElement.appendChild(indicator);

  setTimeout(() => {
    indicator.remove();
  }, 1500);
}

// Функция для проверки, находится ли пользователь внизу чата
function isBelowHalf(element) {
  if (!element) return false;
  const visibleBottom = element.scrollTop + element.clientHeight;
  const halfway = element.scrollHeight / 2;
  return visibleBottom >= halfway;
}


// Функция для плавной прокрутки вниз
function scrollToBottom(element) {
  if (element) {
    element.scrollTo({
      top: element.scrollHeight,
      behavior: 'smooth'
    });
  }
}

function scrollToBottom(element) {
  if (element) {
    console.log('[scroll] Скроллим вниз!');
    element.scrollTop = element.scrollHeight;
  }
}


document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const elements = {
    steamUserInfo: document.getElementById('steam-user-info'),
    profileStatus: document.getElementById('profileStatus'),
    sendMessageButton: document.getElementById('sendMessage'),
    messageInput: document.getElementById('message'),
    messagesList: document.querySelector('.chat-messages'),
    profileLink: document.getElementById('profile-link'),
    profileWarning: document.getElementById('profile-warning'),
    chatTitle: document.getElementById('chatTitle'),
    backToGlobalBtn: document.getElementById('backToGlobal'),
    backToChatBtn: document.getElementById('backToChatBtn'),
    friendInfo: document.getElementById('friend-info'),
    friendAvatar: document.getElementById('friend-avatar'),
    friendName: document.getElementById('friend-name'),
    friendProfileLink: document.getElementById('friend-profile-link'),
    notificationSound: document.getElementById('notificationSound'),
    typingIndicator: document.getElementById('typing-indicator'),
    scrollToBottomBtn: document.getElementById('scrollToBottomBtn'),

  };

  const emojiList = [..."😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙😚🙂🤗🤩🤔🤨😐😑😶🙄😏😣😥😮‍💨😮😯😪😫🥱😴😌😛😜😝🤤😒😓😔😕🙃🤑😲😷🤒🤕🤢🤮🤧🥵🥶😵‍💫😵🥴😠😡🤬😤😭😢😥😓🤯😳🥺😬😰😱😖😞😟😤😩😨😧😦😿😾🙀😸😹😻😼😽👋🤚🖐✋🖖👌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🙏✍️💅🤳💪🦾🦿🦵🦶👂👃🧠🦷🦴👀👁️👅👄💋❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟🔞🎮🎲🎯🏆⚽🏀🏈⚾🎾🏐🥎🏓🏸🥅⛳🥇🥈🥉🎮"]; // Можешь добавить ещё

  const emojiPicker = document.getElementById('emojiPicker');
  const toggleEmojiPickerBtn = document.getElementById('toggleEmojiPicker');

// Переключение видимости панели смайлов
  toggleEmojiPickerBtn.addEventListener('click', () => {
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
  });

  const messageInput = document.getElementById('message');

  // Отрисуем смайлы
  emojiList.forEach(emoji => {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.addEventListener('click', () => {
      messageInput.value += emoji;
      messageInput.focus();
    });
    emojiPicker.appendChild(span);
  });

  const urlParts = window.location.pathname.split('/');
  const friendId = urlParts.length > 2 ? urlParts[2] : null;

  let steamUser = null;
  let currentRoomId = null;
  let recipientSteamId = null;
  let typingTimeout = null;

  fetch('/steam-profile')
    .then(response => response.json())
    .then(data => {
      steamUser = data;

      // Обновление информации о пользователе
      if (elements.steamUserInfo) {
        elements.steamUserInfo.innerHTML = `
          <p>Вы вошли как: <strong>${steamUser.personaname}</strong></p>
          <img src="${steamUser.avatar}" alt="Аватар" class="user-avatar">
        `;
      }

      // Обновление статуса профиля
      if (elements.profileStatus) {
        elements.profileStatus.textContent = steamUser.isPublic 
          ? '✅ Профиль открыт' 
          : '⚠ Профиль закрыт';
        elements.profileStatus.style.color = steamUser.isPublic 
          ? 'green' 
          : 'darkred';
      }

      if (!steamUser.isPublic && elements.profileWarning) {
        elements.profileWarning.style.display = 'block';
      }

      if (elements.profileLink) elements.profileLink.href = `/profile/${steamUser.steamId}`;

      if (friendId) {
        recipientSteamId = friendId;
        const roomId = [steamUser.steamId, friendId].sort().join('_');
        currentRoomId = roomId;
        socket.emit('joinPrivateChat', { userId: steamUser.steamId, friendId });
        if (elements.backToGlobalBtn) elements.backToGlobalBtn.style.display = 'inline';

        fetch(`/steam-user/${friendId}`)
          .then(res => res.json())
          .then(friend => {
            if (elements.chatTitle) elements.chatTitle.innerText = `💬 Чат с ${friend.personaname}`;
            if (elements.friendInfo) elements.friendInfo.style.display = 'block';
            if (elements.friendAvatar) elements.friendAvatar.src = friend.avatar || '/images/default-avatar.png';
            if (elements.friendName) elements.friendName.textContent = friend.personaname;
            if (elements.friendProfileLink) elements.friendProfileLink.href = `/profile/${friendId}`;
          })
          .catch(() => {
            if (elements.chatTitle) elements.chatTitle.innerText = '💬 Приватный чат';
          });
      } else {
        socket.emit('joinChat', steamUser);
      }
    });

  if (elements.backToGlobalBtn) {
    elements.backToGlobalBtn.addEventListener('click', () => {
      currentRoomId = null;
      if (elements.friendInfo) elements.friendInfo.style.display = 'none';
      if (elements.chatTitle) elements.chatTitle.innerText = '🌐 Общий чат';
      elements.backToGlobalBtn.style.display = 'none';
      if (elements.messagesList) elements.messagesList.innerHTML = '';
      socket.emit('joinChat', steamUser);
    });
  }

  const MAX_MESSAGE_LENGTH = 500;

  if (elements.sendMessageButton) {
    elements.sendMessageButton.addEventListener('click', sendMessageHandler);
  }

  if (elements.messageInput) {
    elements.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessageHandler();
    });

    elements.messageInput.addEventListener('input', () => {
      socket.emit('typing', { to: recipientSteamId });
    });
  }

  socket.on('message', (msg) => {
    if (elements.notificationSound) elements.notificationSound.play().catch(() => {});
    addMessage(msg);
  
    // ⬇ Автопрокрутка через requestAnimationFrame — точно прокрутит после отрисовки
    requestAnimationFrame(() => {
      if (isBelowHalf(elements.messagesList)) {
        scrollToBottom(elements.messagesList);
      }
    });
    
  });
  

  socket.on('chatHistory', (msgs) => {
    if (elements.messagesList) {
      elements.messagesList.innerHTML = '';
      msgs.forEach(addMessage);
      // При загрузке истории чата всегда прокручиваем вниз
      scrollToBottom(elements.messagesList);
    }
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    alert('Ошибка соединения с сервером');
  });

  socket.on('typing', (data) => {
    if (data.from === recipientSteamId && elements.typingIndicator) {
      elements.typingIndicator.innerText = `${data.username} пишет...`;
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        if (elements.typingIndicator) elements.typingIndicator.innerText = '';
      }, 3000);
    }
  });

  socket.on('connect_error', (err) => {
    console.error('Ошибка подключения:', err.message);
    alert('Ошибка соединения с сервером');
  });

  function addMessage(message) {
    if (!elements.messagesList) return;

    const li = document.createElement('li');
    li.className = 'message';

    li.innerHTML = `
      <img src="${message.steamAvatar}" class="message-avatar">
      <div class="message-content">
        <div class="message-header clickable-area" data-steamid="${message.steamId}">
          <span class="sender">${message.steamName}</span>
          <span class="time">${message.timestamp}</span>
        </div>
        <p class="message-text">${message.text}</p>
      </div>
      <div class="message-actions">
        <button onclick="copyText('${message.text.replace(/'/g, "\\'")}', this)">📋</button>
      </div>
    `;

    // обработчик клика на отправителя
    const clickableArea = li.querySelector('.clickable-area');
    if (clickableArea) {
      clickableArea.addEventListener('click', async (e) => {
        const steamId = e.currentTarget.dataset.steamid;
        if (steamId === steamUser.steamId) return;

        try {
          const response = await fetch(/api/is-friend/$,{steamId});
          const { isFriend } = await response.json();
          showContextMenu(e.clientX, e.clientY, steamId, isFriend);
        } catch (err) {
          console.error('Ошибка:', err);
          showContextMenu(e.clientX, e.clientY, steamId, false);
        }
      });
    }

    elements.scrollToBottomBtn.addEventListener('click', () => {
      scrollToBottom(elements.messagesList);
    });
    

    elements.messagesList.appendChild(li);
    elements.messagesList.addEventListener('scroll', () => {
      const el = elements.messagesList;
      if (!isBelowHalf(el)) {
        elements.scrollToBottomBtn.classList.add('show');
      } else {
        elements.scrollToBottomBtn.classList.remove('show');
      }
    });
    
  }

  fetch('/api/friends')
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById('friendListContainer');
      if (!container) return;

      container.innerHTML = '';

      if (Array.isArray(data.friends)) {
        data.forEach(friend => {
          const el = document.createElement('div');
          el.style.textAlign = 'center';
          el.style.marginBottom = '10px';
          el.innerHTML = `
            <img src="${friend.avatar}" width="40" height="40" style="border-radius:50%;"><br>
            <span>${friend.personaname}</span><br>
            <button onclick="openPrivateChat('${friend.steamid}')">💬 Чат</button><br>
            <button class="friend-profile" data-id="${friend.steamid}">👤 Профиль</button>
          `;
          container.appendChild(el);
        });
      }
    })
    .catch(err => {
      console.error('Ошибка загрузки друзей:', err);
    });

  function openPrivateChat(friendSteamID) {
    window.location.href = `/chat/${friendSteamID}`;
  }

  function savePreviousChatPathOnce() {
    if (!sessionStorage.getItem('previousChatPath')) {
      sessionStorage.setItem('previousChatPath', window.location.pathname);
    }
  }

  if (sessionStorage.getItem('previousChatPath') && elements.backToChatBtn) {
    elements.backToChatBtn.style.display = 'inline';
    elements.backToChatBtn.addEventListener('click', () => {
      const backTo = sessionStorage.getItem('previousChatPath');
      sessionStorage.removeItem('previousChatPath');
      window.location.href = backTo;
    });
  }

  if (elements.profileLink) {
    elements.profileLink.addEventListener('click', savePreviousChatPathOnce);
  }

  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== toggleEmojiPickerBtn) {
      emojiPicker.style.display = 'none';
    }
  });
  
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('friend-profile')) {
      savePreviousChatPathOnce();
      const id = e.target.dataset.id;
      window.location.href = `/profile/${id}`;
    }
  });

  document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('emojiPicker').style.display = 'none';
  }
});

  function sendMessageHandler() {
    const text = elements.messageInput.value.trim();
    if (!text) return;

    if (currentRoomId) {
      const [u1, u2] = currentRoomId.split('_');
      const toId = steamUser.steamId === u1 ? u2 : u1;
      
      socket.emit('sendPrivateMessage', {
        userId: steamUser.steamId,
        friendId: toId,
        message: text,
        roomId: currentRoomId
      });
    } else {
      socket.emit('sendMessage', text);
    }
    elements.messageInput.value = '';
    
    // Прокручиваем вниз после отправки сообщения
    setTimeout(() => {
      scrollToBottom(elements.messagesList);
    }, 100);
  }
});