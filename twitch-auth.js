class TwitchAuth {
    constructor(clientId, accessToken, channelName) {
        this.clientId = clientId;
        this.accessToken = accessToken;
        this.channelName = channelName;
        this.channelId = null;
        this.followers = new Set(); // Pour éviter les doublons
        this.followersCheckInterval = 30000; // Vérifier toutes les 30 secondes
        this.lastFollowerCheck = new Date();
		this.callbacks = {
			newFollower: null,
			error: null
		};
        this.headers = {
            'Client-ID': this.clientId,
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };
    }

    async initialize() {
        try {
            await this.getChannelId();
            await this.loadFollowers();
            this.startFollowerPolling();
            console.log(`✅ TwitchAuth initialisé pour ${this.channelName} (ID: ${this.channelId})`);
        } catch (error) { if (this.callbacks.error) this.callbacks.error(error); }
    }
    async getChannelId() {
        try {
            const response = await fetch(`https://api.twitch.tv/helix/users?login=${this.channelName}`, { headers: this.headers });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            
            const data = await response.json();
            if (data.data.length === 0) throw new Error(`Canal ${this.channelName} introuvable`);
            
            this.channelId = data.data[0].id;
            console.log(`📺 Canal trouvé: ${this.channelName} (ID: ${this.channelId})`);
        } catch (error) { console.error('Erreur lors de la récupération de l\'ID du canal:', error.message); }
    }
	async loadFollowers() {
        this.followers.clear();
        this.lastFollowerCheck = new Date();
        
        try { await this.getFollowerCountFromThirdParty();
        } catch (err) { console.warn('Impossible d\'obtenir le compte via API tierce'); return; }
        console.log('✅ Mode détection de nouveaux followers activé');
    }
	async getFollowerCountFromThirdParty() {
        try {
            const response = await fetch(`https://decapi.me/twitch/followcount/${this.channelName}`);
            if (!response.ok) return;

			const count = parseInt(await response.text());
			if (isNaN(count)) return;

			// Simuler des followers pour le comptage (sans les noms)
			for (let i = 0; i < count; i++) this.followers.add(`follower_${i}`); // Placeholder
			console.log(`👥 ${count} followers (comptage via DecAPI)`);
			return count;
        } catch (err) { console.warn('Erreur DecAPI:', err.message); }
        return 0;
    }
	async setupEventSubWebhooks() {
        try {
            // Créer un webhook pour les follows
            const webhookResponse = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    type: 'channel.follow',
                    version: '2',
                    condition: {
                        broadcaster_user_id: this.channelId,
                        moderator_user_id: this.channelId // Requis pour v2
                    },
                    transport: {
                        method: 'webhook',
                        callback: 'https://votre-domaine.com/webhooks/twitch',
                        secret: 'votre-secret-webhook'
                    }
                })
            });

			const t = await webhookResponse.json();

            if (webhookResponse.ok) {
                console.log('✅ EventSub webhook configuré pour les follows');
                return true;
            } else {
                console.warn('⚠️  Impossible de configurer EventSub webhook');
                return false;
            }
        } catch (error) {
            console.error('Erreur EventSub setup:', error.message);
            return false;
        }
    }
    async checkNewFollowers() {
        try {
            const response = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${this.channelId}&first=20`, { headers: this.headers });
            
            if (!response.ok) {
                if (response.status === 401) throw new Error('Token d\'accès invalide ou expiré');
                else throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            const newFollowers = [];
            
            for (const follower of data.data) {
                const followedAt = new Date(follower.followed_at);
                const userLogin = follower.user_login.toLowerCase();
                
                // Vérifier si c'est un nouveau follower depuis la dernière vérification
                if (followedAt > this.lastFollowerCheck && !this.followers.has(userLogin)) {
                    newFollowers.push(follower);
                    this.followers.add(userLogin);
                }
            }
            
            // Traiter les nouveaux followers
            for (const newFollower of newFollowers) this.handleNewFollower(newFollower);
            this.lastFollowerCheck = new Date();
        } catch (error) { if (this.callbacks.error) this.callbacks.error(error); }
    }
    handleNewFollower(follower) {
        console.log(`🎉 Nouveau follower: ${follower.user_name}`);
        const followerData = {
            username: follower.user_login,
            displayName: follower.user_name,
            followedAt: follower.followed_at,
            userId: follower.user_id
        };
        if (this.callbacks.newFollower) this.callbacks.newFollower(followerData);
    }
    startFollowerPolling() {
        this.pollingInterval = setInterval(async () => await this.checkNewFollowers(), this.followersCheckInterval);
        console.log(`🔄 Polling des followers démarré (toutes les ${this.followersCheckInterval/1000}s)`);
    }
    stopFollowerPolling() {
        if (!this.pollingInterval) return;
		clearInterval(this.pollingInterval);
		this.pollingInterval = null;
		console.log('⏹️ Polling des followers arrêté');
    }
    isFollower(username) {
        return this.followers.has(username.toLowerCase());
    }
    getFollowerCount() {
        return this.followers.size;
    }
	on(event, callback) {
		if (!this.callbacks.hasOwnProperty(event)) console.warn(`Événement inconnu: ${event}`);
		this.callbacks[event] = callback;
	}
    destroy() {
        this.stopFollowerPolling();
        this.followers.clear();
		for (const key in this.callbacks) this.callbacks[key] = null;
    }
}

module.exports = TwitchAuth;