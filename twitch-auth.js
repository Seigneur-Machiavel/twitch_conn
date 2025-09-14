const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const openBrowser = require('open').default;
const redirectUri = 'https://twitch-auth.contrast.science';
const scopes = 'chat:read+chat:edit+moderator:read:followers';
const tokenPath = 'twitch-token.json';

class TwitchAuthenticator {
	static async authenticate(clientId, clientSecret) {
		try {
			const data = JSON.parse(fs.readFileSync(tokenPath));
			if (Date.now() < data.expires_at) return data.access_token;
		} catch {}

		return new Promise((resolve, reject) => {
			const server = http.createServer(async (req, res) => {
				const url = new URL(req.url, redirectUri);
				const code = url.searchParams.get('code');

				if (!code) return;
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end('<h1>Success</h1><p>Close this window.</p>');
				server.close();

				try {
					const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&code=${code}&grant_type=authorization_code&redirect_uri=${redirectUri}`, { method: 'POST' });
					const data = await res.json();
					if (!data.access_token) throw new Error('Auth failed');
					data.expires_at = Date.now() + (data.expires_in * 1000);
					fs.writeFileSync(tokenPath, JSON.stringify(data));
					resolve(data.access_token);
				} catch (error) { reject(error); }
			});

			server.listen(9999, () => openBrowser(`https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}`));
			setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 300000);
		});
	}
}

/**
 * @typedef {Object} FollowerInfo
 * @property {string} followed_at ex: '2025-08-20T10:12:16Z'
 * @property {string} user_id ex: '123456789'
 * @property {string} user_login ex: 'totoDu87'
 * @property {string} user_name ex: 'toto1234'
 */

class TwitchAuth {
	/** @type {string|null} */ channelId = null;
	/** @type {Record<string, FollowerInfo>} */ followers = {};
	viewerCount = 0;
	/** @type {function} callback */ onAddFollower = null;

	constructor(clientId = '', channelName = '', onAddFollower) {
		this.clientId = clientId;
		this.channelName = channelName;
		this.onAddFollower = onAddFollower;
	}

	async initialize(clientSecret) {
		const token = await TwitchAuthenticator.authenticate(this.clientId, clientSecret);
		this.headers = { 'Client-ID': this.clientId, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
		await this.#getChannelId();
		setTimeout(() => this.#loadFollowers(), 1000); // time for tmiclient to start
		setInterval(() => this.#updateViewerCount(), 20000);
		return token;
	}
	async #getStreamInfo() {
		if (!this.channelId) return null;
		
		const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${this.channelId}`, { headers: this.headers });
		const data = await response.json();
		if (!data.data || data.data.length === 0) return { is_live: false, viewer_count: 0 };
		else return {
			viewer_count: data.data[0].viewer_count,
			title: data.data[0].title,
			game_name: data.data[0].game_name,
			started_at: data.data[0].started_at,
			is_live: true
		};
	}
	async #updateViewerCount() {
		const streamInfo = await this.#getStreamInfo();
		if (streamInfo) this.viewerCount = streamInfo.viewer_count;
	}
	async #getChannelId() {
		const response = await fetch(`https://api.twitch.tv/helix/users?login=${this.channelName}`, { headers: this.headers });
		const data = await response.json();
		if (data.data.length > 0) this.channelId = data.data[0].id;
	}
	async #loadFollowers() {
		if (!this.channelId) return;
		
		let cursor = '';
		let hasMore = true;
		
		while (hasMore) {
			const url = `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${this.channelId}&first=100${cursor ? `&after=${cursor}` : ''}`;
			const response = await fetch(url, { headers: this.headers });
			const data = await response.json();
			
			if (!data.data) break;

			for (const follower of data.data) this.addFollower(follower);
			cursor = data.pagination?.cursor;
			hasMore = !!cursor;
		}
	}
	getFollowerCount() {
		return Object.keys(this.followers).length;
	}
	addFollower(followerData) {
		const { followed_at, user_id, user_login, user_name } = followerData;
		const followInfo = { followed_at, user_id, user_login, user_name };
		this.followers[followerData.user_login.toLowerCase()] = followInfo;
		if (this.onAddFollower) this.onAddFollower(followInfo);
	}
	isFollower(username) {
		return !!this.followers[username.toLowerCase()];
	}
}

module.exports = TwitchAuth;