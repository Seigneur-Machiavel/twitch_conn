const fs = require('fs');
const player = require('node-wav-player');
const COMMANDS_ATTRIBUTES = require('./commands.js');

class SoundBox {
	/** @param {'message' | 'sub' | 'createnode'} soundId */
	static async playSound(soundId) {
		try { await player.play({ path: `public/sounds/${soundId}.wav`, sync: true });
		} catch (err) { console.error('Erreur lors de la lecture du son:', err.message); }
	}
}

class MessagesBox {
	tmiClient;
	ioChat;
	ioCmd;
	commandsList = Object.keys(COMMANDS_ATTRIBUTES).map(cmd => cmd.toLowerCase());
	emitHistoryDelay = 2000;
	maxLength = 100; // Limite de messages
	messages = [];
	cmdMessages = {
		'!createnode': [],
	};
	
	/** Initialize MessagesBox Instance based on tmi.js
	 * @param {import('tmi.js').Client} tmiClient
	 * @param {import('socket.io').Server} ioChat
	 * @param {import('socket.io').Server} ioCmd */
	constructor(tmiClient, ioChat, ioCmd) {
		this.tmiClient = tmiClient;
		this.ioChat = ioChat;
		this.ioCmd = ioCmd;
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
		if (this.ioChat) setTimeout(() => {
			for (const msg of this.messages) this.ioChat.emit('chat-message', msg);
		}, this.emitHistoryDelay);
	}
	emitCmdHistory() {
		if (this.ioCmd) setTimeout(() => {
			for (const cmd of Object.keys(this.cmdMessages))
				for (const msg of this.cmdMessages[cmd])
					this.ioCmd.emit('cmd-message', msg);
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
		if (emit) this.ioChat?.emit('chat-message', { user, message });
	}
	#digestCmdMessage(user, message, emit) {
		const splitted  = message.split(':');
		const command = splitted[0].trim().toLowerCase();
		if (!this.commandsList.includes(command)) return;

		// check requirements - aborted for now: we can't check follow without API Auth access
		//if (COMMANDS_ATTRIBUTES[command]?.followersOnly) {

		// Vérifier les prérequis des commandes
		const cmdAttributes = COMMANDS_ATTRIBUTES[command];
		if (cmdAttributes?.followersOnly && twitchAuth && !twitchAuth.isFollower(user)) {
			this.tmiClient.say(TWITCH_CONFIG.CHANNEL_NAME, `@${user}, tu dois être follower pour utiliser cette commande ! 😊`);
			return;
		}

		// HANDLE LOCAL COMMANDS
		this.#handleSpecialCommands(command, user, message);

		// HANDLE DISTANT COMMANDS (sent through API)
		this.cmdMessages[command].push({ user, message });
		if (emit) this.ioCmd?.emit('cmd-message', { user, message });
	}
	#handleSpecialCommands(command, user, message) {
        switch (command) {
            case '!followers':
                if (twitchAuth) {
                    const count = twitchAuth.getFollowerCount();
                    this.tmiClient.say(TWITCH_CONFIG.CHANNEL_NAME, `Nous avons actuellement ${count} followers ! 🎉`);
                }
                break;
                
            case '!uptime':
                const uptime = process.uptime();
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                this.tmiClient.say(TWITCH_CONFIG.CHANNEL_NAME, `Le bot tourne depuis ${hours}h ${minutes}min ! 🤖`);
                break;
        }
    }
}

module.exports = MessagesBox;