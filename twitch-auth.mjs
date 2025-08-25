/**
 * Module d'authentification et gestion des followers Twitch
 * @author LePerroquetRose
 */

export class TwitchAuth {
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
            const response = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${this.channelId}&first=100`, {
                headers: this.headers
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            data.data.forEach(follower => {
                this.followers.add(follower.user_login.toLowerCase());
            });
            
            console.log(`👥 ${this.followers.size} followers chargés initialement`);
            this.lastFollowerCheck = new Date();
        } catch (error) {
            console.error('Erreur lors du chargement initial des followers:', error.message);
            if (this.onError) this.onError(error);
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
        this.pollingInterval = setInterval(() => {
            this.checkNewFollowers();
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

export default TwitchAuth;