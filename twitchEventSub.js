const WebSocket = require('ws');

class TwitchEventSub {
	/** @type {WebSocket|null} */ ws = null;
	/** @type {string|null} */ sessionId = null;
	/** @type {Record<string, Function|null>} */
	callbacks = { follow: null, error: null, connected: null };
	reconnectAttempts = 0;
	maxReconnectAttempts = 5;
	botUserId = '';

	constructor(clientId, token, channelId) {
		this.clientId = clientId;
		this.token = token;
		this.channelId = channelId;
		this.headers = { 'Client-ID': clientId, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
	}

	async initialize() {
		const userResponse = await fetch('https://api.twitch.tv/helix/users', { headers: this.headers });
		const userData = await userResponse.json();
		this.botUserId = userData.data[0].id;
		await this.connect(); // Initialize the WebSocket connection
	}
	async connect() {
		this.ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
		this.ws.on('open', () => console.log('EventSub WebSocket connected'));
		this.ws.on('message', (data) => this.#handleMessage(JSON.parse(data.toString())));
		this.ws.on('close', () => { console.log('EventSub WebSocket closed'); this.#reconnect(); });
		this.ws.on('error', (error) => {
			console.error('EventSub WebSocket error:', error);
			if (this.callbacks.error) this.callbacks.error(error);
		});
	}
	#handleMessage(message) {
		const { metadata, payload } = message;

		if (metadata.message_type === 'session_welcome') {
			this.sessionId = payload.session.id;
			console.log('EventSub session established:', this.sessionId);
			this.#subscribeToFollows();
			if (this.callbacks.connected) this.callbacks.connected();
		}

		if (metadata.message_type === 'session_keepalive') {
			// Keep-alive, nothing to do
		}

		if (metadata.message_type === 'notification') {
			if (metadata.subscription_type === 'channel.follow') {
				if (this.callbacks.follow) this.callbacks.follow(payload.event);
			}
		}

		if (metadata.message_type === 'session_reconnect') {
			console.log('EventSub reconnect requested');
			this.ws.close();
			this.connect();
		}
	}
	async #subscribeToFollows() {
		if (!this.sessionId) return;

		const subscription = {
			type: 'channel.follow',
			version: '2',
			condition: {
				broadcaster_user_id: this.channelId,
				moderator_user_id: this.botUserId
			},
			transport: {
				method: 'websocket',
				session_id: this.sessionId
			}
		};

		try {
			const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
				method: 'POST',
				headers: this.headers,
				body: JSON.stringify(subscription)
			});
			const data = await response.json();
			if (response.ok) console.log('EventSub follow subscription created');
			else {
				console.error('EventSub subscription failed:', data);
				if (this.callbacks.error) this.callbacks.error(data);
			}
		} catch (error) {
			console.error('EventSub subscription error:', error);
			if (this.callbacks.error) this.callbacks.error(error);
		}
	}
	#reconnect() {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error('Max reconnect attempts reached');
			return;
		}

		this.reconnectAttempts++;
		const delay = Math.pow(2, this.reconnectAttempts) * 1000;
		
		setTimeout(() => {
			console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
			this.connect();
		}, delay);
	}
	on(event, callback) {
		if (!this.callbacks.hasOwnProperty(event)) console.warn(`Événement inconnu: ${event}`);
		this.callbacks[event] = callback;
	}
	destroy() {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.sessionId = null;
		for (const key in this.callbacks) this.callbacks[key] = null;
	}
}

module.exports = TwitchEventSub;