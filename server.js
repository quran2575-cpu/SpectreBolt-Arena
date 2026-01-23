/*
 * SpectreBolt Arena - Multiplayer 2D Shooter Game Server-Side
 * Copyright (C) 2026 Saif Kayyali
 * GNU GPLv3
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();

app.use((req, res, next) => {
  if (req.url === '/robots.txt' || req.url === '/sitemap.xml') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));


const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

const MAP_SIZE = 2000;
const TICK_RATE = 1000 / 30;
const MAX_ATTEMPTS = 5;
const BASE_SPEED = 4.6;
const SPRINT_SPEED = 6.8;
const ENTITY_RADIUS = 18;
const MAX_PLAYERS=15;
const JOIN_CUTOFF_SECONDS=5*60;
const BULLET_LIFETIME = 1200;
const MAX_BULLETS=60;
const BULLET_RADIUS = 4;
const NET_TICK_IDLE = 1000 / 10;
const NET_TICK_ACTIVE = 1000 / 20;

const BANNED_WORDS = ['fuck','ass','badass','shit', 'nigger', 'nigga', 'bitch', 'slut', 'nazi', 'hitler', 'milf', 'cunt', 'retard', 'dick', 'diddy', 'epstein', 'diddle', 'rape', 'pedo', 'rapist','porn','mussolini','stalin','trump','cock', 'israel','genocide','homicide','suicide','genocidal','suicidal','homicidal','arson'];
const WORD_ONLY_BANS = ['ass'];
const SUBSTRING_BANS = BANNED_WORDS.filter(w => w !== 'ass'&& w !=='badass');


const RESERVED=['bobby','rob','eliminator','spectrebolt','admin','server','saifkayyali3','sunbul-k','you','player','skayyali3']


const DOMAIN_REGEX = /\b[a-z0-9-]{2,}\.(com|net|org|io|gg|dev|app|xyz|tv|me|co|info|site|online)\b/i;
const URL_SCHEME_REGEX = /(https?:\/\/|www\.)/i;


let resetPending = false;
let lastNetSend = 0;
let lastTickTime = Date.now();
let players = {};
let nameAttempts = {};
let bots = {};
let bullets = {};
let bulletIdCounter = 0;
let matchTimer = 15 * 60;
let walls = generateWalls(12);
let botAccumulator = 0;
let bulletAccumulator = 0; 
let NET_TICK = NET_TICK_IDLE;
let matchPhase = 'running'; 
let lastFirePacket = {};


function validateName(name) {
    if (typeof name !== 'string') return false;
    if (!name.trim()) return false;
    if (!/[a-z]/i.test(name)) return false;

    const lower = name.toLowerCase();

    // Block links / domains
    if (URL_SCHEME_REGEX.test(lower)) return false;
    if (DOMAIN_REGEX.test(lower)) return false;

    // English only, length 1–14
    if (!/^[A-Za-z0-9 _.-]{1,14}$/.test(name)) return false;

    // Normalize leetspeak
    const leetMap = { 
        '0': 'o','1': 'i','3': 'e','4': 'a',
        '5': 's','7': 't','8': 'b',
        '@': 'a','$': 's','!': 'i',
        '-': '','_': '','.': '',
        '9': 'g','2': 'z'
    };

    const baseNormalized = lower.split('').map(c => leetMap[c] ?? c).join('').replace(/[^a-z]/g, '');

    const collapsed = baseNormalized.replace(/(.)\1+/g, '$1');
    const stripped = baseNormalized.replace(/[0-9]/g, '');

    if (RESERVED.includes(lower) ||RESERVED.includes(baseNormalized) ||RESERVED.includes(collapsed) ||RESERVED.includes(stripped)) return false;

    if (SUBSTRING_BANS.some(w => baseNormalized.includes(w) || collapsed.includes(w))) return false;

    if (WORD_ONLY_BANS.some(w => new RegExp(`\\b${w}\\b`).test(baseNormalized))) return false;

    return true;
}


function rectsIntersect(r1, r2, padding = 0) {
    return (r1.x < r2.x + r2.w + padding && r1.x + r1.w + padding > r2.x &&
            r1.y < r2.y + r2.h + padding && r1.y + r1.h + padding > r2.y);
}

function getBotSafeSpawn() {
    let x, y, attempts = 0;
    const MIN_DIST = 300;

    do {
        x = 100 + Math.random() * (MAP_SIZE - 200);
        y = 100 + Math.random() * (MAP_SIZE - 200);
        attempts++;
    } while (
        attempts < 100 &&
        (
            collidesWithWall(x, y, 40) ||
            Object.values(players).some(p =>
                !p.isSpectating &&
                Math.hypot(p.x - x, p.y - y) < MIN_DIST
            )
        )
    );

    return { x, y };
}


function generateWalls(count) {
    const newWalls = [];
    const MIN_CORRIDOR_WIDTH = 120;
    const MARGIN = 100;
    let attempts = 0;
    while (newWalls.length < count && attempts < 500) {
        attempts++;
        const w = 150 + Math.random() * 200;
        const h = 150 + Math.random() * 200;
        const x = MARGIN + Math.random() * (MAP_SIZE - w - MARGIN * 2);
        const y = MARGIN + Math.random() * (MAP_SIZE - h - MARGIN * 2);
        const candidate = { x, y, w, h };
        if (!newWalls.some(existing => rectsIntersect(candidate, existing, MIN_CORRIDOR_WIDTH))) {
            newWalls.push(candidate);
        }
    }
    return newWalls;
}

function collidesWithWall(x, y, r = ENTITY_RADIUS) {
    if (x < r || y < r || x > MAP_SIZE - r || y > MAP_SIZE - r) return true;
    return walls.some(w => x + r > w.x && x - r < w.x + w.w && y + r > w.y && y - r < w.y + w.h);
}

function getSafeSpawn() {
    let x, y, attempts = 0;
    const SPAWN_BUFFER = 50;
    do {
        x = SPAWN_BUFFER + Math.random() * (MAP_SIZE - SPAWN_BUFFER * 2);
        y = SPAWN_BUFFER + Math.random() * (MAP_SIZE - SPAWN_BUFFER * 2);
        attempts++;
    } while (collidesWithWall(x, y, SPAWN_BUFFER) && attempts < 100);
    return { x, y };
}
const USED_COLORS = new Set();

function generateUniqueColor() {
    let attempts = 0;

    while (attempts < 50) {
        const hue = Math.floor(Math.random() * 360);
        const color = `hsl(${hue},70%,50%)`;

        if (!USED_COLORS.has(color)) {
            USED_COLORS.add(color);
            return color;
        }
        attempts++;
    }

    return `hsl(${Math.random() * 360},70%,50%)`;
}

function shouldRespawnBot(botId) {
    if (matchTimer <= 0) return false;
    if (botId === 'bot_rob') return Math.random() < 0.75;
    if (botId === 'bot_eliminator') return Math.random() < 0.5;
    return true; // Bobby always respawns
}

let specialsSpawned = false;

function spawnSpecialBots() {
    if (specialsSpawned) return;
    delete bots['bot_rob'];
    delete bots['bot_eliminator'];
    specialsSpawned = true;

    setTimeout(() => {
        if (Math.random() < 0.75) {
            const rob = new Bot('bot_rob', 'Rob', '#4A90E2', BASE_SPEED, 950);
            rob.damageTakenMultiplier = 0.75;
            rob.hp = 100;
            bots['bot_rob'] = rob;
            io.emit('RobSpawned', {id: 'bot_rob', name: 'Rob',timestamp: Date.now()});
        }

        if (Math.random() < 0.25) {
            const elim = new Bot('bot_eliminator', 'Eliminator', '#E24A4A', 3.9, 1100);
            elim.isRetreating = false;
            elim.damageTakenMultiplier = 0.4;
            bots['bot_eliminator'] = elim;
            io.emit('EliminatorSpawned', {id: 'bot_eliminator',name: 'Eliminator',timestamp: Date.now()});
        }
    }, 5000);
}

app.set('trust proxy', true);

function getClientIP(socket) {
  return socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address;
}



function handleSuccessfulJoin(socket, name, forcedSpectator = false, waitingForRematch=false) {
    const pos = getSafeSpawn();
    players[socket.id] = {
        id: socket.id,
        name: name,
        x: pos.x, y: pos.y, hp: 100, lives: 3, score: 0, stamina: 100,
        angle: 0, color: generateUniqueColor(),
        isSpectating: forcedSpectator, 
        forcedSpectator,
        spawnProtectedUntil: Date.now() + 3000,
        lastRegenTime: Date.now(),
        damageTakenMultiplier: 1,
        lastFireTime: 0,
        fireCooldown: 100, // ms (10 shots/sec)
        input: {moveX: 0,moveY: 0,sprint: false,angle: 0},
        waitingForRematch,
    };
    
    spawnSpecialBots();
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, walls, spawnX: pos.x, spawnY: pos.y,name, forcedSpectator, waitingForRematch});

}

function maybeResetMatch() {
    if (matchPhase === 'ended' && resetPending) {
        resetPending = false;
        resetMatch();
        return true; // reset happened
    }
    return false;
}


function resetMatch() {
    if (matchPhase === 'running') return;
    resetPending=false;
    matchTimer = 15 * 60;
    bullets = {};
    walls = generateWalls(12);
    specialsSpawned = false;
    spawnSpecialBots();
    
    Object.values(players).forEach(p => {
        if (!p.isSpectating) {
            const pos = getSafeSpawn();
            Object.assign(p, {
                id:p.id,
                x: pos.x,
                y: pos.y,
                color:generateUniqueColor(),
                hp: 100,
                lives:3,
                stamina: 100,
                spawnProtectedUntil: Date.now() + 3000,
                lastRegenTime: Date.now(),
                isSpectating: false,
                waitingForRematch: false,
                forcedSpectator:false,
                score: 0,
                input: { moveX: 0, moveY: 0, sprint: false, angle: 0 } ,
                damageTakenMultiplier: 1,
                lastFireTime: 0,
                fireCooldown: 100,
            });
        }
    });

    Object.values(bots).forEach(b => {
        const pos = getBotSafeSpawn();
        Object.assign(b, {
            x: pos.x,
            y: pos.y,
            hp: 100,
            score: 0,
            spawnTime: Date.now(),
            justDied: false,
            retired: false,
            hitChain: 0,
            recentHits: 0,
        });
    });

    io.emit('mapUpdate', { mapSize: MAP_SIZE, walls });
    matchPhase = 'running';
    io.emit('matchReset', { matchTimer, matchPhase });
}


class Bot {
    constructor(id, name, color, speed, bulletSpeed) {
        this.id = id; this.name = name; this.color = color;
        this.speed = speed; this.bulletSpeed = bulletSpeed;
        const pos = getBotSafeSpawn();
        this.x = pos.x; this.y = pos.y;
        this.hp = 100; this.score = 0; this.angle = 0;
        this.wanderAngle = Math.random() * Math.PI * 2;
        this.lastFireTime = 0;
        this.lastRegenTime = Date.now();
        this.spawnTime = Date.now();
        this.isRetreating = false;
        this.spawnProtectedUntil = 0;
        this.recentHits = 0;
        this.lastHitTime = 0;
        this.hitChain = 0;
    }

    fireAtPlayers(players) {
        if (collidesWithWall(
            this.x + Math.cos(this.angle) * 30,
            this.y + Math.sin(this.angle) * 30,
            6
        )) return;

        if (Date.now() - this.spawnTime < 1200) return;
        if (Object.keys(bullets).length > MAX_BULLETS) return;

        const targets = Object.values(players).filter(p => !p.isSpectating);
        if (!targets.length) return;

        let nearest = targets.reduce((a, b) =>
            Math.hypot(a.x - this.x, a.y - this.y) <
            Math.hypot(b.x - this.x, b.y - this.y) ? a : b
        );

        const dist = Math.hypot(nearest.x - this.x, nearest.y - this.y);
        if (dist > 800) return;
        this.angle = Math.atan2(nearest.y - this.y, nearest.x - this.x);

        const fireCooldown =this.id === 'bot_bobby' ? 1500 :this.id === 'bot_rob' ? 700 : 400; // Eliminator

        let burstChance = 0;

        if (this.id === 'bot_eliminator') {
            if (this.recentHits >= 4) {
                burstChance = 1;
                this.recentHits = 0;
            } else {
                burstChance = 0.25;
            }
        }

        if (dist < 700 && Date.now() - this.lastFireTime > fireCooldown) {
            const shots = Math.random() < burstChance ? 4 : 1;

            for (let i = 0; i < shots; i++) {
                const id = 'bot_b' + (++bulletIdCounter);
                bullets[id] = {id,x: this.x,y: this.y,angle: this.angle + (Math.random() - 0.5) * 0.08,owner: this.id,speed: this.bulletSpeed / 60,born: Date.now()};
            }

            this.lastFireTime = Date.now();
        }
    }

    update(players) {
        let moveSpeed=this.speed
        if (Date.now() - this.lastRegenTime > 3000) {
            const maxHp =100;
            const regen = 5;

            this.hp = Math.min(maxHp, this.hp + regen);

            this.lastRegenTime = Date.now();
        }

        this.wanderAngle += (Math.random() - 0.5) * 0.2;

        const vx = Math.cos(this.wanderAngle);
        const vy = Math.sin(this.wanderAngle);
        const len = Math.hypot(vx, vy) || 1;

        let nx = this.x + (vx / len) * moveSpeed;
        let ny = this.y + (vy / len) * moveSpeed;

        if (!collidesWithWall(nx, ny, ENTITY_RADIUS)) {
            this.x = nx;
            this.y = ny;
        } else {
            this.wanderAngle += Math.PI;
        }

        this.fireAtPlayers(players);
    }
    updateAdvanced(players) {
        if (Date.now() - this.lastRegenTime > 3000) {
            const regen = this.isRetreating ? 2 : 5;
            this.hp = Math.min(100, this.hp + regen);
            this.lastRegenTime = Date.now();
        }

        if (this.isRetreating && Math.random() < 0.02) {
            this.angle += Math.PI * (0.8 + Math.random() * 0.4);
        }

        let moveSpeed = this.speed;

        if (this.id === 'bot_eliminator' && Date.now() - this.lastFireTime < 600) {
            moveSpeed *= 0.5;
        }

        if (this.hp <= 45) this.isRetreating = true;

        if (this.isRetreating) {
            moveSpeed *= 1.25;

            const targets = Object.values(players).filter(p => !p.isSpectating);
            if (targets.length) {
                const nearest = targets.reduce((a, b) =>
                    Math.hypot(a.x - this.x, a.y - this.y) <
                    Math.hypot(b.x - this.x, b.y - this.y) ? a : b
                );
                this.angle = Math.atan2(this.y - nearest.y, this.x - nearest.x);
            }

            const vx = Math.cos(this.angle);
            const vy = Math.sin(this.angle);
            const len = Math.hypot(vx, vy) || 1;

            let nx = this.x + (vx / len) * moveSpeed;
            let ny = this.y + (vy / len) * moveSpeed;

            if (!collidesWithWall(nx, this.y, ENTITY_RADIUS)) this.x = nx;
            if (!collidesWithWall(this.x, ny, ENTITY_RADIUS)) this.y = ny;


            if (this.hp >= 70) this.isRetreating = false;
            return;
        }

        this.wanderAngle += (Math.random() - 0.5) * 0.08;
        const vx = Math.cos(this.wanderAngle);
        const vy = Math.sin(this.wanderAngle);
        const len = Math.hypot(vx, vy) || 1;

        let nx = this.x + (vx / len) * moveSpeed;
        let ny = this.y + (vy / len) * moveSpeed;

        if (!collidesWithWall(nx, ny)) {
            this.x = nx;
            this.y = ny;
        } else {
            this.wanderAngle += Math.PI;
        }
        this.fireAtPlayers(players);
    }
}
bots['bot_bobby'] = new Bot('bot_bobby', 'Bobby', '#8A9A5B', 3.1, 800);
bots['bot_bobby'].damageTakenMultiplier = 1.35;

io.on('connection', socket => {
    socket.on('joinGame', (data) => {
        let name = (data.name || "").trim().slice(0, 14);
        if (!name || name.toLowerCase() === "sniper") {
            name = "Sniper" + Math.floor(1000 + Math.random() * 9000);
        }

        else if (!validateName(name)) {
            const key = getClientIP(socket) + ':' + socket.id.slice(0, 6);
            nameAttempts[key] = (nameAttempts[key] || 0) + 1;


            if (nameAttempts[key] >= MAX_ATTEMPTS) {
                socket.emit('errorMsg', 'Disconnected for repeated naming violations.');
                socket.disconnect();
                return;
            }

            socket.emit('errorMsg',`Inappropriate name, or reserved name, or name doesn't use English letters/numbers (max 14), retry again while fulfilling these requirements ${MAX_ATTEMPTS - nameAttempts[key]} attempts left.`);
            return;
        }
        if (Object.keys(players).length >= MAX_PLAYERS) {
            socket.emit('errorMsg', 'Match is full.');
            return;
        }

        let forcedSpectator = false;
        let waitingForRematch = false;

        const didReset = maybeResetMatch();

        if (!didReset && matchPhase !== 'running') {
            waitingForRematch = true;
            forcedSpectator = false;
        }


        else if (matchTimer <= JOIN_CUTOFF_SECONDS) {
            forcedSpectator = true;
        }
        

        handleSuccessfulJoin(socket, name, forcedSpectator, waitingForRematch);
        console.log(`${players[socket.id].name} has joined the arena`)
    });

    socket.on('input', input => {
        const p = players[socket.id];
        if (!p || typeof input !== 'object') return;

        p.input = {moveX: Math.max(-1, Math.min(1, Number(input.moveX) || 0)),moveY: Math.max(-1, Math.min(1, Number(input.moveY) || 0)),sprint: !!input.sprint,angle: Number.isFinite(input.angle) ? input.angle : p.angle};
    });

    socket.on('fire', data => {
        const now = Date.now();
        if (lastFirePacket[socket.id] && now - lastFirePacket[socket.id] < 30) return;
        lastFirePacket[socket.id] = now;
        const p = players[socket.id];
        if (!p || p.isSpectating || p.lives <= 0 || p.forcedSpectator) return;

        const ownerBullets = Object.values(bullets).filter(b => b.owner === socket.id);
        if (ownerBullets.length >= 8) return;
        if (now - p.lastFireTime < p.fireCooldown) return; // 10 shots/sec
        p.lastFireTime = now;

        if (Object.keys(bullets).length > MAX_BULLETS) return;

        const id = 'b' + (++bulletIdCounter);
        bullets[id] = {
            id,
            x: p.x,
            y: p.y,
            angle: Number.isFinite(data.angle) ? data.angle : p.angle,
            owner: socket.id,
            speed: 900 / 60,
            born: now
        };
    });

    socket.on('disconnect', () => { 
        const color = players[socket.id]?.color;

        delete players[socket.id];
        delete nameAttempts[getClientIP(socket)];
        delete lastFirePacket[socket.id];

        if (color) USED_COLORS.delete(color);
    });

    socket.on('rematch', () => {
        const p = players[socket.id];
        if (!p) return;

        if (matchPhase === 'running' && !p.isSpectating) {
            socket.emit('rematchDenied', 'Match already in progress.');
            return;
        }

        if (matchPhase === 'ended' && resetPending) {
            maybeResetMatch();
        }

        const pos = getSafeSpawn();
        Object.assign(p, {x: pos.x, y: pos.y, hp: 100, lives: 3, stamina: 100, score: 0, isSpectating: false, forcedSpectator: false, waitingForRematch: false, spawnProtectedUntil: Date.now() + 3000,lastRegenTime:Date.now()});
        socket.emit('rematchAccepted', { x: p.x, y: p.y, matchTimer, matchPhase });
    });
});


setInterval(() => {
    const playerArray = Object.values(players);
    if (playerArray.length > 0) {
        const anyAlive = playerArray.some(p => !p.isSpectating);
        if (!anyAlive && matchTimer > 0) {
            console.log("All players are ghosts. Ending match early...");
            matchTimer = 0;
        }
    }
    const activePlayers = Object.values(players).some(p => !p.isSpectating);
    NET_TICK = activePlayers ? NET_TICK_ACTIVE : NET_TICK_IDLE;

    const now = Date.now();
    const delta = Math.min((now - lastTickTime) / 1000, 0.05);
    lastTickTime = now;

    if (activePlayers) {
        matchTimer = Math.max(0, matchTimer - delta);
    }

    if (matchTimer <= 0 && matchPhase === 'running') {
        matchPhase = 'ended';
        resetPending = true;
    }




    Object.values(players).forEach(p => {
        if (p.waitingForRematch) return;
        if (!p.isSpectating && Date.now() - p.lastRegenTime > 3000) {
            p.hp = Math.min(100, p.hp + 5);
            p.lastRegenTime = Date.now();
        }
        

        
        const input = p.input || {sprint:false};
        let speed = p.isSpectating ? 15 : (p.input.sprint && p.stamina > 0? SPRINT_SPEED: BASE_SPEED);



        let dx = input.moveX || 0;
        let dy = input.moveY || 0;

        if (!p.isSpectating){
            if (p.input.sprint && (dx || dy)) {
                p.stamina = Math.max(0, p.stamina - 1);
            } else {
                p.stamina = Math.min(100, p.stamina + 0.6);
            }
        }
        if (p.isSpectating) {
            const sx = Math.abs(dx) > 0.01 ? dx : 0;
            const sy = Math.abs(dy) > 0.01 ? dy : 0;
            p.x += sx * speed * delta * 60;
            p.y += sy * speed * delta * 60;
            return;
        }

        if (dx || dy) {
            const len = Math.hypot(dx, dy);

    
            if (len > 1) {
                dx /= len;
                dy /= len;
            }
            const moveFactor = delta * 60;
            let nx = p.x + dx * speed * moveFactor;
            if (!collidesWithWall(nx, p.y, ENTITY_RADIUS)) {
                p.x = nx;
            }

            let ny = p.y + dy * speed * moveFactor;
            if (!collidesWithWall(p.x, ny, ENTITY_RADIUS)) {
                p.y = ny;
            }
        }

        p.angle = p.input.angle;
    });
    botAccumulator += delta;
    if (botAccumulator >= 1 / 30) {
        Object.values(bots).forEach(b => {
            if (b.retired) return;
            if (b.id === 'bot_eliminator') b.updateAdvanced(players);
            else b.update(players);
        });
        botAccumulator = 0;
    }
    bulletAccumulator += delta;

    while (bulletAccumulator >= 1 / 15) {
        bulletAccumulator -= 1/15;

        Object.values(bullets).forEach(b => {
            if (Date.now() - b.born > BULLET_LIFETIME) {
                delete bullets[b.id];
                return;
            }

            const bulletStep = (1/15)*60;
            b.x += Math.cos(b.angle) * b.speed * bulletStep;
            b.y += Math.sin(b.angle) * b.speed * bulletStep;

            if (
                collidesWithWall(b.x, b.y, BULLET_RADIUS) ||
                b.x < 0 || b.x > MAP_SIZE ||
                b.y < 0 || b.y > MAP_SIZE
            ) {
                delete bullets[b.id];
                return;
            }

            let hit = false;

            const livePlayers = Object.values(players).filter(p => !p.isSpectating);
            const liveBots = Object.values(bots).filter(b => !b.retired);
            for (const target of [...livePlayers, ...liveBots]) {
                if (Math.abs(target.x - b.x) > 40 || Math.abs(target.y - b.y) > 40) continue;
                if (
                    hit ||
                    target.id === b.owner ||
                    target.isSpectating ||
                    Date.now() < target.spawnProtectedUntil ||
                    target.retired
                ) continue;

                const dx = b.x - target.x;
                const dy = b.y - target.y;
                const HIT_RADIUS = ENTITY_RADIUS + BULLET_RADIUS + 6;

                let damage = 10;
                if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
                    hit=true;
                    if (target.id === 'bot_rob') {
                        const now = Date.now();
                        if (now - target.lastHitTime < 250) target.hitChain++;
                        else target.hitChain = 0;
                        target.lastHitTime = now;
                        const spamReduction = Math.min(0.6, target.hitChain * 0.1);
                        damage *= (1 - spamReduction);
                    }

                    if (target.id === 'bot_eliminator') {
                        const now = Date.now();
                        if (now - target.lastHitTime < 400) target.recentHits++;
                        else target.recentHits = 1;
                        target.lastHitTime = now;
                    }

                    let multiplier = target.damageTakenMultiplier ?? 1;

                    if (target.id === 'bot_eliminator') {
                        if (target.isRetreating) {
                            multiplier *= 1.35; // exposed
                        } else {
                            multiplier *= 0.75; // armored
                        }
                    }

                    target.hp -= damage * multiplier;


                    target.lastRegenTime = Date.now();

                    if (target.hp <= 0) {
                        if (target.justDied) {
                            delete bullets[b.id];
                            break;
                        }

                        target.justDied = true;
                        const shooter = players[b.owner] || bots[b.owner];
                        const victimName = target.name;
                        const shooterName = shooter ? shooter.name : "The Void";

                        let pointsAwarded = 0;

                        if (shooter) {
                            if (b.owner.toString().includes('bot')) {
                                if (!target.id.toString().includes('bot')) pointsAwarded = b.owner === 'bot_bobby' ? 6 : 3;
                            } else {
                                if (target.id === 'bot_bobby') pointsAwarded = 1;
                                else if (target.id === 'bot_eliminator') pointsAwarded = 6;
                                else pointsAwarded = 3;
                            }
                            shooter.score += pointsAwarded;
                        }


                        io.emit('killEvent', { shooter: shooterName, victim: victimName });


                        if (!target.id.toString().includes('bot')) {
                            target.lives--;
                            if (target.lives <= 0) {
                                target.hp = 0;
                                target.isSpectating = true;
                            } else {
                                const respawnPos = getSafeSpawn();
                                Object.assign(target, {
                                    x: respawnPos.x,
                                    y: respawnPos.y,
                                    hp: 100,
                                    stamina: 100,
                                    spawnProtectedUntil: Date.now() + 3000,
                                    lastRegenTime: Date.now(),
                                    justDied:false
                                });
                                io.to(target.id).emit('respawned', {
                                    x: target.x,
                                    y: target.y
                                });
                            }
                        } else {
                            if (shouldRespawnBot(target.id)) {
                                const respawn = getBotSafeSpawn();
                                Object.assign(target, {hp: 100,x: respawn.x,y: respawn.y,spawnTime: Date.now(),justDied:false});
                            } else {
                                target.retired = true;
                                if (target.id === 'bot_eliminator') {
                                    io.emit('EliminatorRetired','The Eliminator has fallen…');
                                } else if (target.id === 'bot_rob') {
                                    io.emit('RobRetired','Rob has left the arena.');
                                }
                            }
                        }
                        
                    }
                    if (hit) {delete bullets[b.id]; break;}
                }
            }
        });
    }

    if (Date.now() - lastNetSend > NET_TICK) {
        const slimPlayers = {};
        for (const [id, p] of Object.entries(players)) {
            slimPlayers[id] = {id,x: p.x,y: p.y,hp: p.hp,angle: p.angle,isSpectating: p.isSpectating,forcedSpectator: p.forcedSpectator,spawnProtected: Date.now() < p.spawnProtectedUntil,stamina: p.stamina,score:p.score,lives:p.lives,color:p.color,name:p.name};
        }
        const slimBots = {};
        for (const [id, b] of Object.entries(bots)) {
            slimBots[id] = {id: b.id,x: b.x,y: b.y,hp: b.hp,score: b.score,angle: b.angle,name: b.name,color: b.color,retired: !!b.retired};
        }


        const slimBullets = {};
        for (const [id, b] of Object.entries(bullets)) {
            slimBullets[id] = {x: b.x,y: b.y,angle: b.angle};
        }

        io.emit('state', { players:slimPlayers, bots:slimBots, bullets:slimBullets, matchTimer, matchPhase });
        lastNetSend = Date.now();
    }
}, TICK_RATE);

server.listen(PORT, '0.0.0.0', () => { 
    console.log(`SpectreBolt Arena Server Active on Port ${PORT}`); 
    console.log(`Running on http://localhost:${PORT}`)
});