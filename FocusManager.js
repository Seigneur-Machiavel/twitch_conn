class FocusManager {
    #activeTimer = null;
    #endTime = null;
    #duration = null;
    #io = null;
    
    constructor(io) {
        this.#io = io;
    }
    
    start(minutes) {
        if (!minutes || minutes <= 0) return false;
        
        this.#clear();
        this.#duration = minutes * 60 * 1000;
        this.#endTime = Date.now() + this.#duration;
        
        this.#activeTimer = setTimeout(() => this.#onComplete(), this.#duration);
        this.#broadcast();
        return true;
    }
    
    stop() {
        if (!this.#activeTimer) return false;
        
        this.#clear();
        this.#broadcast();
        return true;
    }
    
    getStatus() {
        if (!this.#activeTimer) return { active: false };
        
        const remaining = Math.max(0, this.#endTime - Date.now());
        const totalSeconds = Math.floor(remaining / 1000);
        
        return {
            active: true,
            remaining: totalSeconds,
            minutes: Math.floor(totalSeconds / 60),
            seconds: totalSeconds % 60,
            endTime: this.#endTime,
            duration: this.#duration
        };
    }
    
    #clear() {
        if (this.#activeTimer) {
            clearTimeout(this.#activeTimer);
            this.#activeTimer = null;
        }
        this.#endTime = null;
        this.#duration = null;
    }
    
    #onComplete() {
        this.#clear();
        this.#broadcast();
        console.log('Focus mode terminé !');
    }
    
    #broadcast() {
        if (!this.#io) return;
        this.#io.emit('focus-status', this.getStatus());
    }
}

module.exports = FocusManager;