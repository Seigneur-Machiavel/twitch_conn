const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const player = require('node-wav-player');

//import TwitchAuth from './twitch-auth.mjs';

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
        try { await player.play({ path: `public/sounds/${soundId}.wav`, sync: true });
        } catch (err) { console.error('Erreur lors de la lecture du son:', err.message); }
    }
}

class MessagesBox {
	commandsList = Object.keys(commandsAttributes).map(cmd => cmd.toLowerCase());
	emitHistoryDelay = 2000;
	maxLength = 100; // Limite de messages
	messages = [];
	cmdMessages = {
		'!createnode': [],
	};

	constructor() {
		this.#loadHistory('messages');
		this.#loadHistory('commands');

		console.log('test')
	}

	save() {
		this.#saveHistory('messages');
		this.#saveHistory('commands');
	}
	add(tags, message, emit = true) {
		if (message.includes('http')) return; // Ignore les messages avec des liens
		const { username, subscriber } = tags;
		if (message.startsWith('!')) this.#digestCmdMessage(username, message, emit);
		else this.#digestChatMessage(username, message, emit);
		if (this.messages.length > this.maxLength) this.messages.shift(); // crop and save
		this.save();
	}
	emitChatHistory() {
		setTimeout(() => {
			//this.messages.forEach(msg => ioChat.emit('chat-message', msg));
			for (const msg of this.messages)
				ioChat.emit('chat-message', msg);
		}, this.emitHistoryDelay);
	}
	emitCmdHistory() {
		setTimeout(() => {
			for (const cmd of Object.keys(this.cmdMessages))
				for (const msg of this.cmdMessages[cmd])
					ioCmd.emit('cmd-message', msg);
		}, this.emitHistoryDelay);
	}

	/** @param {'messages' | 'commands'} type */
	#loadHistory(type) {
		fs.readFile(type === 'messages' ? 'messages.json' : 'commands.json', (err, data) => {
			if (err) { console.info('Erreur de lecture du fichier :', err.message); return; }
			try {
				if (type === 'messages') this.messages = JSON.parse(data);
				else this.cmdMessages = JSON.parse(data);
			} catch (error) { console.error('Erreur de parsing JSON :', error); }
		});
	}
	#saveHistory(type) {
		const objToSave = type === 'messages' ? this.messages : this.cmdMessages;
		fs.writeFile(`${type}.json`, JSON.stringify(objToSave), (err) => {
			if (err) console.error('Erreur d\'écriture du fichier :', err);
		});
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

		// check requirements - aborted for now: we can't check follow without API Auth access
		//if (commandsAttributes[command]?.followersOnly) {
		this.cmdMessages[command].push({ user, message });
		if (emit) ioCmd.emit('cmd-message', { user, message });
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