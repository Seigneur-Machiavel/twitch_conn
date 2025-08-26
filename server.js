const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const TwitchAuth = require('./twitch-auth.js');
const TWITCH_CONFIG = require('./twitch-auth-keys.js');
const MessagesBox = require('./MessagesBox.js');

const args = process.argv.slice(2);
const NO_AUTH_MODE = args.includes("-noAuth"); // -> disable Twitch Auth (read chat only)
const twitchAuth = new TwitchAuth(TWITCH_CONFIG.CLIENT_ID, TWITCH_CONFIG.ACCESS_TOKEN, TWITCH_CONFIG.CHANNEL_NAME);
const tmiOptions = { // DEFAULT OPTIONS, OVERRIDE ON OAUTH CONNECTION
	options: { debug: false },
	connection: { reconnect: true },
	identity: {
		username: 'justinfan123456', // Override with TWITCH_CONFIG.BOT_USERNAME
		password: 'blah', 			 // Override with Oauth:token
	},
	channels: [TWITCH_CONFIG.CHANNEL_NAME]
};

const app = express();
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(__dirname + '/public/chat-overlay.html'));

(async () => {
	if (!NO_AUTH_MODE) { // SETUP TWITCH AUTH -> GET OAUTH TOKEN
	}

	// SETUP TMI CLIENT
	const tmiClient = new tmi.client(tmiOptions);
	tmiClient.connect();
	tmiClient.on('connected', () => { ioChat?.emit('started'); ioCmd?.emit('started'); messagesBox.emitHistoryDelay = 100; });
	tmiClient.on('disconnected', () => { ioChat?.emit('stopped'); ioCmd.emit('stopped'); });
	tmiClient.on('message', (channel, tags, message, self) => messagesBox.add(tags, message));

	const chatOverlayServer = http.createServer(app);
	chatOverlayServer.listen(14597, () => console.log('Chat overlay: http://localhost:14597'));
	const ioChat = socketIo(chatOverlayServer);
	ioChat.on('connection', (socket) => messagesBox.emitChatHistory());

	const cmdServer = http.createServer(app);
	cmdServer.listen(14598, () => console.log('Command server: http://localhost:14598'));
	const ioCmd = socketIo(cmdServer);
	ioCmd.on('connection', (socket) => messagesBox.emitCmdHistory());

	const messagesBox = new MessagesBox(tmiClient, ioChat, ioCmd);

	function destroyClients() { twitchAuth?.destroy(); tmiClient?.disconnect(); }
	process.on('SIGTERM', () => { destroyClients(); process.exit(0); });
	process.on('SIGINT', () => { destroyClients(); process.exit(0); });
})();