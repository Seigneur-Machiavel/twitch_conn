const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const TWITCH_CONFIG = require('./auth-keys.js');
const MessagesBox = require('./MessagesBox.js');
const TwitchAuth = require('./twitch-auth.js');
const TwitchEventSub = require('./twitchEventSub.js');
const FocusManager = require('./FocusManager.js');

const args = process.argv.slice(2);
const NO_AUTH_MODE = args.includes("-noAuth"); // -> disable Twitch Auth (read chat only)
const twitchAuth = new TwitchAuth(TWITCH_CONFIG.CLIENT_ID, TWITCH_CONFIG.CHANNEL_NAME);
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
app.use(express.json());
app.get('/', (req, res) => res.sendFile(__dirname + '/public/chat-overlay.html'));
app.get('/focus', (req, res) => res.sendFile(__dirname + '/public/focus-control.html'));


(async () => {
	if (!NO_AUTH_MODE) { // SETUP TWITCH AUTH -> GET OAUTH TOKEN
		const access_token = await twitchAuth.initialize(TWITCH_CONFIG.CLIENT_SECRET);
		tmiOptions.identity.username = TWITCH_CONFIG.BOT_USERNAME;
		tmiOptions.identity.password = `oauth:${access_token}`;

		const eventSub = new TwitchEventSub(TWITCH_CONFIG.CLIENT_ID, access_token, twitchAuth.channelId);
		await eventSub.initialize();
		eventSub.on('follow', (followerData) => {
			twitchAuth.addFollower(followerData);
			tmiClient.say(
				TWITCH_CONFIG.CHANNEL_NAME,
				`Merci pour le follow, ${followerData.user_name} ! 🎉`
			);
		});
		eventSub.on('connected', () => console.log('EventSub prêt !'));
	}

	// SETUP TMI CLIENT
	const tmiClient = new tmi.client(tmiOptions);
	tmiClient.connect();
	tmiClient.on('connected', () => { ioChat?.emit('started'); ioCmd?.emit('started'); messagesBox.emitHistoryDelay = 100; });
	tmiClient.on('disconnected', () => { ioChat?.emit('stopped'); ioCmd.emit('stopped'); });
	tmiClient.on('message', (channel, tags, message, self) => messagesBox.add(tags, message));

	// CHAT OVERLAY SERVER
	const chatOverlayServer = http.createServer(app);
	chatOverlayServer.listen(14597, () => console.log('Chat overlay: http://localhost:14597'));
	const ioChat = socketIo(chatOverlayServer);
	ioChat.on('connection', (socket) => messagesBox.emitChatHistory());

	// COMMAND SERVER
	const cmdServer = http.createServer(app);
	cmdServer.listen(14598, () => console.log('Command server: http://localhost:14598'));
	const ioCmd = socketIo(cmdServer);
	ioCmd.on('connection', (socket) => {
		messagesBox.emitCmdHistory();
		for (const username of Object.keys(twitchAuth.followers))
			ioCmd.emit('cmd-message', { user: 'bot', message: `!addFollower:${username}` });

		socket.emit('focus-status', focusManager.getStatus());
		socket.on('focus-start', (data) => {
			if (!data.minutes || data.minutes <= 0) return;
			
			const success = focusManager.start(data.minutes);
			if (success) console.log(`Focus ${data.minutes}min activé`);
			else console.log('Erreur lors du démarrage du focus');
		});

		socket.on('focus-stop', () => {
			const success = focusManager.stop();
			console.log(success ? 'Focus arrêté' : 'Pas de focus actif');
		});
	});
	// Setup onAddFollower callback
	twitchAuth.onAddFollower = (followInfo) => ioCmd.emit('cmd-message', { user: 'bot', message: `!addFollower:${followInfo.user_name}` });
	const messagesBox = new MessagesBox(tmiClient, ioChat, ioCmd, twitchAuth);
	const focusManager = new FocusManager(ioCmd, messagesBox);

	function destroyClients() { twitchAuth?.destroy(); tmiClient?.disconnect(); }
	process.on('SIGTERM', () => { destroyClients(); process.exit(0); });
	process.on('SIGINT', () => { destroyClients(); process.exit(0); });
})();