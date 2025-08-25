const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const player = require('node-wav-player');
const TwitchAuth = require('./twitch-auth.js');
const TWITCH_CONFIG = require('./twitch-auth-keys.js');

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

		// Vérifier les prérequis des commandes
		const cmdAttributes = commandsAttributes[command];
		if (cmdAttributes?.followersOnly && twitchAuth && !twitchAuth.isFollower(user)) {
			client.say(TWITCH_CONFIG.CHANNEL_NAME, `@${user}, tu dois être follower pour utiliser cette commande ! 😊`);
			return;
		}

		// HANDLE LOCAL COMMANDS
		this.#handleSpecialCommands(command, user, message);

		// HANDLE DISTANT COMMANDS (sent through API)
		this.cmdMessages[command].push({ user, message });
		if (emit) ioCmd.emit('cmd-message', { user, message });
	}

	#handleSpecialCommands(command, user, message) {
        switch (command) {
            case '!followers':
                if (twitchAuth) {
                    const count = twitchAuth.getFollowerCount();
                    client.say(TWITCH_CONFIG.CHANNEL_NAME, `Nous avons actuellement ${count} followers ! 🎉`);
                }
                break;
                
            case '!uptime':
                const uptime = process.uptime();
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                client.say(TWITCH_CONFIG.CHANNEL_NAME, `Le bot tourne depuis ${hours}h ${minutes}min ! 🤖`);
                break;
        }
    }
}

//#region TWITCH SETUP
const tmiOptions = {
	options: { debug: false },
	connection: { reconnect: true },
	identity: {
		username: TWITCH_CONFIG.CHANNEL_NAME,
		password: `oauth:${TWITCH_CONFIG.ACCESS_TOKEN}`
	},
	channels: [TWITCH_CONFIG.CHANNEL_NAME]
};
// Initialisation des instances
const messagesBox = new MessagesBox();
const client = new tmi.client(tmiOptions);
const twitchAuth = new TwitchAuth(TWITCH_CONFIG.CLIENT_ID, TWITCH_CONFIG.ACCESS_TOKEN, TWITCH_CONFIG.CHANNEL_NAME);

// Configuration des callbacks TwitchAuth
twitchAuth.setOnNewFollower((followerData) => {
    console.log(`🎉 Nouveau follower détecté: ${followerData.displayName}`);
    SoundBox.playSound('follow');
    
    const welcomeMessages = [
        `Merci pour le follow @${followerData.displayName} ! 🎉`,
        `Bienvenue dans la famille @${followerData.displayName} ! 💜`,
        `Un nouveau membre ! Salut @${followerData.displayName} ! 🎊`
    ];
    const randomMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
    if (client && client.readyState() === 'OPEN') client.say(TWITCH_CONFIG.CHANNEL_NAME, randomMessage);
    if (ioChat) ioChat.emit('new-follower', followerData); // Émettre vers l'overlay
});

twitchAuth.setOnError((error) => console.error('🚨 Erreur TwitchAuth:', error.message));

process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt du bot...');
    if (twitchAuth) twitchAuth.destroy();
    if (client) client.disconnect();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Arrêt du bot (SIGTERM)...');
    if (twitchAuth) twitchAuth.destroy();
    if (client) client.disconnect();
    process.exit(0);
});
//#endregion

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