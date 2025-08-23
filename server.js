const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const player = require('node-wav-player');

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

const commandsAttributes = {
	'!createnode': { description: 'Créer un nouveau nœud', usage: '!createNode', followersOnly: true }
}

class SoundBox {
    /** @param {'message' | 'sub' | 'createnode'} soundId */
    static async playSound(soundId) {
        try {
            // Si le fichier est très petit (< 200KB), on le joue 2 fois
            const soundPath = `public/sounds/${soundId}.wav`;
            const stats = fs.statSync(soundPath);
            const shouldRepeat = stats.size < 200000;
            const repeatCount = shouldRepeat ? 2 : 1;
            for (let i = 0; i < repeatCount; i++) await player.play({ path: soundPath, sync: true });
        } catch (err) { console.error('Erreur lors de la lecture du son:', err.message); }
    }
}

class MessagesBox {
	commandsList = Object.keys(commandsAttributes).map(cmd => cmd.toLowerCase());
	emitHistoryDelay = 2000;
	maxLength = 100; // Limite de messages
	messages = [];
	cmdMessages = {
		createNode: [],
	};

	constructor() {
		this.#loadMessagesHistory();
		this.#loadCmdHistory();
	}

	#loadMessagesHistory() {
		fs.readFile('messages.json', (err, data) => {
			if (err) { console.info('Erreur de lecture du fichier :', err.message); return; }
			try { this.messages = JSON.parse(data)?.messages || [];
			} catch (error) { console.error('Erreur de parsing JSON :', error); }
		});
	}
	#loadCmdHistory() {
		fs.readFile('commands.json', (err, data) => {
			if (err) { console.info('Erreur de lecture du fichier :', err.message); return; }
			try { this.cmdMessages = JSON.parse(data)?.commands || {};
			} catch (error) { console.error('Erreur de parsing JSON :', error); }
		});
	}
	save() {
		this.#saveHistory();
		this.#saveCmdHistory();
	}
	#saveHistory() {
		fs.writeFile('messages.json', JSON.stringify({ messages: this.messages }), (err) => {
			if (err) console.error('Erreur d\'écriture du fichier :', err);
		});
	}
	#saveCmdHistory() {
		fs.writeFile('commands.json', JSON.stringify({ commands: this.cmdMessages }), (err) => {
			if (err) console.error('Erreur d\'écriture du fichier :', err);
		});
	}
	add(tags, message, emit = true) {
		if (message.includes('http')) return; // Ignore les messages avec des liens
		//const msg = { user: tags.username, message };
		const { username, subscriber } = tags;
		// Chose route
		if (message.startsWith('!')) this.#digestCmdMessage(username, message, emit);
		else this.#digestChatMessage(username, message, emit);
		// crop and save
		if (this.messages.length > this.maxLength) this.messages.shift();
		this.save();
	}
	#digestChatMessage(user, message, emit) {
		SoundBox.playSound('message');
		this.messages.push({ user, message });
		if (emit) ioChat.emit('chat-message', { user, message });
	}
	#digestCmdMessage(user, message, emit) {
		const splitted  = message.split(':');
		const command = splitted[0].trim().toLowerCase();
		if (!this.commandsList.includes(command)) return;

		// check requirements
		if (commandsAttributes[command].followersOnly && !this.isUserFollower(user)) {
			ioCmd.emit('cmd-message', { user, message: 'Vous devez être follower pour utiliser cette commande.' });
			return;
		}
		this.cmdMessages[command].push({ user, message });
		if (emit) ioCmd.emit('cmd-message', { user, message });
	}
	emitChatHistory() {
		setTimeout(() => this.messages.forEach(msg => ioChat.emit('chat-message', msg)), this.emitHistoryDelay);
	}
	emitCmdHistory() {
		setTimeout(() => {
			Object.keys(this.cmdMessages).forEach(cmd => this.cmdMessages[cmd].forEach(msg => ioCmd.emit('cmd-message', msg)));
		}, this.emitHistoryDelay);
	}
}

const messagesBox = new MessagesBox();
const client = new tmi.client(options);
client.connect();
client.on('connected', () => { 
	ioChat.emit('started');
	ioCmd.emit('started');
	messagesBox.emitHistoryDelay = 100;
});
client.on('disconnected', () => { ioChat.emit('stopped'); ioCmd.emit('stopped'); });
client.on('message', (channel, tags, message, self) => messagesBox.add(tags, message));

const chatApp = express();
chatApp.use(express.static('public'));
chatApp.get('/', (req, res) => res.sendFile(__dirname + '/public/chat-overlay.html'));

const chatOverlayServer = http.createServer(chatApp);
chatOverlayServer.listen(14597, () => console.log('Serveur lancé sur http://localhost:14597'));
const ioChat = socketIo(chatOverlayServer);
ioChat.on('connection', (socket) => messagesBox.emitChatHistory());

const cmdServer = http.createServer(chatApp);
cmdServer.listen(14598, () => console.log('Serveur lancé sur http://localhost:14598'));

const ioCmd = socketIo(cmdServer);
ioCmd.on('connection', (socket) => messagesBox.emitCmdHistory());
//#endregion

//#region LEGEND OVERLAY -> Load as HTML in OBS directly
/*const legendApp = express();
legendApp.use(express.static('public'));
legendApp.get('/', (req, res) => res.sendFile(__dirname + '/public/cmds-overlay.html'));
const legendOverlayServer = http.createServer(legendApp);
legendOverlayServer.listen(14599, () => console.log('Serveur lancé sur http://localhost:14599'));*/
//#endregion