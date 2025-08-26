const fs = require('fs');

class TwitchAuth {
	clientId = '';
	channelName = '';
	/** @type {string|null} */ channelId = null;
	/** @type {string[]} */ followers = [];
	followersCheckInterval = 30000;
	lastFollowerCheck = new Date();

	/** @type {Record<string, Function|null>} */
	callbacks = { newFollower: null, error: null };

    constructor(clientId = '', accessToken = '', channelName = '') {
        this.channelName = channelName;
        this.headers = { 'Client-ID': clientId, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    }

    async initialize() {
		//await this.getChannelId();
		//await this.loadFollowers();
    }
    async getChannelId() {
        try {
            const response = await fetch(`https://api.twitch.tv/helix/users?login=${this.channelName}`, { headers: this.headers });
			if (!response.ok) console.error(`Erreur HTTP ${response.status} lors de la récupération de l'ID du canal`);
            
            const data = await response.json();
			if (data.data.length === 0) { console.error(`Canal ${this.channelName} introuvable`); return; };
            
            this.channelId = data.data[0].id;
            console.log(`📺 Canal trouvé: ${this.channelName} (ID: ${this.channelId})`);
        } catch (error) { console.error('Erreur lors de la récupération de l\'ID du canal:', error.message); }
    }
	async loadFollowers() {
        this.followers.clear();
        this.lastFollowerCheck = new Date();
        
        
    }
    isFollower(username) {
        return this.followers.has(username.toLowerCase());
    }
	on(event, callback) {
		if (!this.callbacks.hasOwnProperty(event)) console.warn(`Événement inconnu: ${event}`);
		this.callbacks[event] = callback;
	}
    destroy() {
        this.followers.clear();
		for (const key in this.callbacks) this.callbacks[key] = null;
    }
}

module.exports = TwitchAuth;