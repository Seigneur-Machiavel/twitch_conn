class TwitchAuth {
    constructor(clientId, accessToken, channelName) {
        this.clientId = clientId;
        this.accessToken = accessToken;
        this.channelName = channelName;
        this.channelId = null;
        this.followers = new Set(); // Pour éviter les doublons
        this.followersCheckInterval = 30000; // Vérifier toutes les 30 secondes
        this.lastFollowerCheck = new Date();
        
        this.headers = {
            'Client-ID': this.clientId,
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };

        // Callbacks pour les événements
        this.onNewFollower = null;
        this.onError = null;
    }

    async initialize() {
        try {
            await this.getChannelId();
            await this.loadInitialFollowers();
            this.startFollowerPolling();
            console.log(`✅ TwitchAuth initialisé pour ${this.channelName} (ID: ${this.channelId})`);
            return true;
        } catch (error) {
            console.error('❌ Erreur d\'initialisation TwitchAuth:', error.message);
            if (this.onError) this.onError(error);
            return false;
        }
    }

    async getChannelId() {
        try {
            const response = await fetch(`https://api.twitch.tv/helix/users?login=${this.channelName}`, {
                headers: this.headers
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.data.length === 0) {
                throw new Error(`Canal ${this.channelName} introuvable`);
            }
            
            this.channelId = data.data[0].id;
            console.log(`📺 Canal trouvé: ${this.channelName} (ID: ${this.channelId})`);
        } catch (error) {
            console.error('Erreur lors de la récupération de l\'ID du canal:', error.message);
            throw error;
        }
    }

    async loadInitialFollowers() {
        try {
            // OPTION 1: Essayer l'endpoint officiel (peut échouer pour les nouvelles apps)
            let response = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${this.channelId}&first=100`, {
                headers: this.headers
            });
            
            if (!response.ok) {
                if (response.status === 403) {
                    console.warn('⚠️  Accès aux followers refusé (app non autorisée). Utilisation d\'une approche alternative...');
                    await this.loadFollowersAlternative();
                    return;
                } else if (response.status === 401) {
                    throw new Error('Token d\'accès invalide ou scope manquant (moderator:read:followers requis)');
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Vérifier si on a des données
            if (!data.data || data.data.length === 0) {
                console.warn('⚠️  Aucun follower retourné par l\'API officielle');
                await this.loadFollowersAlternative();
                return;
            }
            
            data.data.forEach(follower => {
                this.followers.add(follower.user_login.toLowerCase());
            });
            
            console.log(`👥 ${this.followers.size} followers chargés via API officielle`);
            this.lastFollowerCheck = new Date();
            
        } catch (error) {
            console.error('Erreur lors du chargement initial des followers:', error.message);
            await this.loadFollowersAlternative();
        }
    }
	async loadFollowersAlternative() {
        console.log('🔄 Utilisation du mode follower tracking en temps réel uniquement...');
        
        // On ne peut pas charger la liste initiale, mais on peut tracker les nouveaux
        // En initialisant à 0, les nouveaux follows seront détectés
        this.followers.clear();
        this.lastFollowerCheck = new Date();
        
        // Optionnel: utiliser une API tierce pour le count (ex: TwitchTracker, StreamElements)
        try {
            await this.getFollowerCountFromThirdParty();
        } catch (err) {
            console.warn('Impossible d\'obtenir le compte via API tierce');
        }
        
        console.log('✅ Mode détection de nouveaux followers activé');
    }
	async getFollowerCountFromThirdParty() {
        try {
            // Exemple avec DecAPI (gratuit et public)
            const response = await fetch(`https://decapi.me/twitch/followcount/${this.channelName}`);
            if (response.ok) {
                const count = parseInt(await response.text());
                if (!isNaN(count)) {
                    // Simuler des followers pour le comptage (sans les noms)
                    for (let i = 0; i < count; i++) {
                        this.followers.add(`follower_${i}`); // Placeholder
                    }
                    console.log(`👥 ${count} followers (comptage via DecAPI)`);
                    return count;
                }
            }
        } catch (err) {
            console.warn('Erreur DecAPI:', err.message);
        }
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
            // Récupérer les nouveaux follows depuis la dernière vérification
            const response = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${this.channelId}&first=20`, {
                headers: this.headers
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Token d\'accès invalide ou expiré');
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
            for (const newFollower of newFollowers) {
                this.handleNewFollower(newFollower);
            }
            
            this.lastFollowerCheck = new Date();
            
        } catch (error) {
            console.error('Erreur lors de la vérification des nouveaux followers:', error.message);
            if (this.onError) this.onError(error);
        }
    }

    handleNewFollower(follower) {
        console.log(`🎉 Nouveau follower: ${follower.user_name}`);
        
        const followerData = {
            username: follower.user_login,
            displayName: follower.user_name,
            followedAt: follower.followed_at,
            userId: follower.user_id
        };

        // Callback personnalisé si défini
        if (this.onNewFollower) {
            this.onNewFollower(followerData);
        }
    }

    startFollowerPolling() {
        this.pollingInterval = setInterval(async () => {
            await this.checkNewFollowers();
        }, this.followersCheckInterval);
        
        console.log(`🔄 Polling des followers démarré (toutes les ${this.followersCheckInterval/1000}s)`);
    }

    stopFollowerPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log('⏹️ Polling des followers arrêté');
        }
    }

    // Méthode pour vérifier si un utilisateur est follower
    isFollower(username) {
        return this.followers.has(username.toLowerCase());
    }

    // Obtenir le nombre total de followers
    getFollowerCount() {
        return this.followers.size;
    }

    // Obtenir la liste des followers
    getFollowersList() {
        return Array.from(this.followers);
    }

    // Vérifier la validité du token
    async validateToken() {
        try {
            const response = await fetch('https://id.twitch.tv/oauth2/validate', {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            console.log(`✅ Token valide. Scopes: ${data.scopes?.join(', ') || 'aucun'}`);
            return true;
        } catch (error) {
            console.error('Erreur lors de la validation du token:', error.message);
            return false;
        }
    }

    // Obtenir des informations sur le canal
    async getChannelInfo() {
        try {
            const response = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${this.channelId}`, {
                headers: this.headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return data.data[0] || null;
        } catch (error) {
            console.error('Erreur lors de la récupération des infos du canal:', error.message);
            return null;
        }
    }

    // Définir des callbacks pour les événements
    setOnNewFollower(callback) {
        this.onNewFollower = callback;
    }

    setOnError(callback) {
        this.onError = callback;
    }

    // Cleanup
    destroy() {
        this.stopFollowerPolling();
        this.followers.clear();
        this.onNewFollower = null;
        this.onError = null;
    }
}

module.exports = TwitchAuth;