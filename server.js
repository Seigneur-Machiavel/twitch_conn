const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const fs = require('fs');

//#region TWITCH CHAT OVERLAY
const options = { // Options pour la connexion au chat Twitch (anonyme pour lecture seulement)
	options: { debug: true },
	connection: { reconnect: true },
	identity: {
		username: 'justinfan12345', // Utilisateur anonyme pour lire le chat
		password: 'blah' // Mot de passe bidon pour anonyme
	},
	channels: ['leperroquetrose'] // Ton channel
};

class MessagesBox {
	emitHistoryDelay = 2000;
	maxLength = 100; // Limite de messages
	messages = [];

	constructor() { this.loadHistory(); }

	loadHistory() {
		fs.readFile('messages.json', (err, data) => {
			if (err) {
				console.error('Erreur de lecture du fichier :', err);
				return;
			}
			try { this.messages = JSON.parse(data)?.messages || [];
			} catch (error) { console.error('Erreur de parsing JSON :', error); }
		});
	}
	saveHistory() {
		fs.writeFile('messages.json', JSON.stringify({ messages: this.messages }), (err) => {
			if (err) console.error('Erreur d\'écriture du fichier :', err);
		});
	}
	add(user, message, emit = true) {
		if (message.includes('http')) return; // Ignore les messages avec des liens
		const msg = { user, message };
		this.messages.push(msg);
		if (this.messages.length > this.maxLength) this.messages.shift();
		if (emit) this.#emit(msg);
		this.saveHistory();
	}
	#emit(msg) {
		io.emit('chat-message', msg);
	}
	emitHistory() {
		setTimeout(() => this.messages.forEach(msg => io.emit('chat-message', msg)), this.emitHistoryDelay);
	}
}

const messagesBox = new MessagesBox();
const client = new tmi.client(options);
client.connect();
client.on('connected', () => { io.emit('started'); messagesBox.emitHistoryDelay = 100; });
client.on('message', (channel, tags, message, self) => messagesBox.add(tags.username, message));

const chatApp = express();
chatApp.use(express.static('public'));
chatApp.get('/', (req, res) => res.sendFile(__dirname + '/public/chat-overlay.html'));

const chatOverlayServer = http.createServer(chatApp);
chatOverlayServer.listen(14597, () => console.log('Serveur lancé sur http://localhost:14597'));

const io = socketIo(chatOverlayServer);
io.on('connection', (socket) => messagesBox.emitHistory());
//#endregion

//#region LEGEND OVERLAY
const legendApp = express();
legendApp.use(express.static('public'));
legendApp.get('/', (req, res) => res.sendFile(__dirname + '/public/legend-overlay.html'));
const legendOverlayServer = http.createServer(legendApp);
legendOverlayServer.listen(14598, () => console.log('Serveur lancé sur http://localhost:14598'));
//#endregion