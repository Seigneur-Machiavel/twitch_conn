const socket = io();
const elements = {
	messages: document.getElementById('messages')
};

socket.on('started', () => elements.messages.innerHTML = '');
socket.on('chat-message', (data) => {
  const li = document.createElement('li');
  const userName = document.createElement('strong');
  userName.textContent = data.user + ': ';
  li.appendChild(userName);
  li.appendChild(document.createTextNode(data.message));
  elements.messages.appendChild(li);
  elements.messages.scrollTop = elements.messages.scrollHeight; // Scroll auto vers le bas (optionnel)
});