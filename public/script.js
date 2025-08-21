const socket = io();
const elements = {
	messages: document.getElementById('messages')
};

function clear() {
	elements.messages.innerHTML = '';
}

socket.on('started', () => clear());

socket.on('chat-message', (data) => {
  const li = document.createElement('li');
  li.innerHTML = `<strong>${data.user}:</strong> ${data.message}`;
  elements.messages.appendChild(li);
  elements.messages.scrollTop = elements.messages.scrollHeight; // Scroll auto vers le bas (optionnel)
});