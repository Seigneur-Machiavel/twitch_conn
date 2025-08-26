const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const player = require('node-wav-player');

// la page HTML est servit à l'url : http://localhost:14597

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

class SoundBox {
    static async playSound(soundId = 'toto') {
        try { await player.play({ path: `public/sounds/${soundId}.wav`, sync: true });
        } catch (err) { console.error('Erreur lors de la lecture du son:', err.message); }
    }
}

class MessagesBox {
	emitHistoryDelay = 1000;
	maxLength = 100; // Limite de messages
	messages = [];

	constructor() {
		this.#loadHistory('messages');
		console.log('test')
	}

	save() {
		this.#saveHistory('messages');
		this.#saveHistory('commands');
	}
	add(tags, message, emit = true) {
		if (message.includes('http')) return; // Ignore les messages avec des liens
		const { username, subscriber } = tags;
		this.messages.push({ username, message }); // sauver le message
		if (emit) ioChat.emit('chat-message', { username, message }); // l'envoyer au front
		
		SoundBox.playSound('message');

		if (this.messages.length > this.maxLength) this.messages.shift(); // limit à 100 msg
		this.save();
	}
	emitChatHistory() {
		setTimeout(() => { for (const msg of this.messages)ioChat.emit('chat-message', msg);
		}, this.emitHistoryDelay);
	}

	#loadHistory() {
		fs.readFile('messages.json', (err, data) => {
			if (err) { console.info('Erreur de lecture du fichier :', err.message); return; }
			try { this.messages = JSON.parse(data);
			} catch (error) { console.error('Erreur de parsing JSON :', error); }
		});
	}
	#saveHistory() {
		fs.writeFile(`messages.json`, JSON.stringify(this.messages), (err) => {
			if (err) console.error('Erreur d\'écriture du fichier :', err);
		});
	}
}

const messagesBox = new MessagesBox();
const client = new tmi.client(options);
client.connect();
client.on('connected', () => ioChat.emit('started'));
client.on('message', (channel, tags, message, self) => messagesBox.add(tags, message));

const chatApp = express();
chatApp.use(express.static('public'));
chatApp.get('/', (req, res) => res.sendFile(__dirname + '/public/chat-overlay.html'));

const chatOverlayServer = http.createServer(chatApp);
chatOverlayServer.listen(14597, () => console.log('Serveur lancé sur http://localhost:14597'));
const ioChat = socketIo(chatOverlayServer);
ioChat.on('connection', (socket) => messagesBox.emitChatHistory());