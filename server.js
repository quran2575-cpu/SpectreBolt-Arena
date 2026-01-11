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

const PORT = process.env.PORT || 8080;

const RELEASES = {
    ROB: false,
    ELIMINATOR: false
};

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


let lastNetSend = 0;
let lastTickTime = Date.now();
let players = {};
let nameAttempts = {};
let bots = {};
let bullets = {};
let bulletIdCounter = 0;
let matchTimer = 15 * 60;
let walls = generateWalls(12);
let resetScheduled = false;
let matchStarted = false;
let botAccumulator = 0;
let bulletAccumulator = 0;
let specialsSpawned = false;
const NET_TICK_IDLE = 1000 / 10;
const NET_TICK_ACTIVE = 1000 / 20;
let NET_TICK = NET_TICK_IDLE;



const BANNED_WORDS = ['fuck', 'nigger', 'nigga', 'bitch', 'slut', 'nazi', 'hitler', 'milf', 'cunt', 'retard', 'ass', 'dick', 'diddy', 'epstein', 'diddle', 'rape', 'pedo'];

function cleanUsername(name) {
    if (!name || name.trim().length === 0) return "Sniper";
    let sanitized = name.trim().slice(0, 14);
    const leetMap = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '-': '', '_': '' };
    const normalized = sanitized.toLowerCase().replace(/[0134578@$!]/g, c => leetMap[c]);
    if (BANNED_WORDS.some(word => normalized.includes(word))) {
        return 'Spectre' + Math.floor(1000 + Math.random() * 9000);
    }
    return sanitized;
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

function shouldRespawnBot(botId) {
    if (botId === 'bot_rob') return Math.random() < 0.75;
    if (botId === 'bot_eliminator') return Math.random() < 0.25;
    return true; // Bobby always respawns
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

function handleSuccessfulJoin(socket, name) {
    if (matchTimer <= 0) resetMatch();
    if (Object.values(players).some(p => !p.isSpectating)) {
        spawnSpecialBots();
    }
    const pos = getSafeSpawn();
    players[socket.id] = {
        id: socket.id,
        name: name,
        x: pos.x, y: pos.y, hp: 100, lives: 3, score: 0, stamina: 100,
        angle: 0, color: generateUniqueColor(),
        isSpectating: false, 
        spawnProtectedUntil: Date.now() + 3000,
        lastRegenTime: Date.now(),
        damageTakenMultiplier: 1,
        lastFireTime: 0,
        fireCooldown: 100, // ms (10 shots/sec)
        input: {moveX: 0,moveY: 0,sprint: false,angle: 0}
    };
    
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, walls, spawnX: pos.x, spawnY: pos.y,name});

}
function spawnSpecialBots() {
    delete bots['bot_rob'];
    delete bots['bot_eliminator'];
    if (specialsSpawned) return;
    specialsSpawned=true;

    if (RELEASES.ROB && Math.random() < 0.75) {
        const rob = new Bot('bot_rob', 'Rob', '#4A90E2', BASE_SPEED, 950);
        rob.damageTakenMultiplier = 0.75;
        rob.hp = 100;
        rob.regenRate = 8; // per tick
        bots['bot_rob'] = rob;
        console.log('Rob has entered the arena.');
    }

    if (RELEASES.ELIMINATOR && Math.random() < 0.25) {
        const elim = new Bot('bot_eliminator', 'Eliminator', '#E24A4A', 3.9, 1100);
        elim.isRetreating = false;
        elim.damageTakenMultiplier = 0.55;
        bots['bot_eliminator'] = elim;
        console.log('The Eliminator has entered the arena.');
    }
    // Force test at least one of them:

    /*if (!bots['bot_rob'] && !bots['bot_eliminator'] && RELEASES.ROB && RELEASES.ELIMINATOR) {
        if (Math.random() < 0.75) {
            const rob = new Bot('bot_rob', 'Rob', '#4A90E2', BASE_SPEED, 950);
            rob.damageTakenMultiplier = 0.75;
            rob.hp = 100;
            bots['bot_rob'] = rob;
        } else {
            const elim = new Bot('bot_eliminator', 'Eliminator', '#E24A4A', 3.9, 1100);
            elim.damageTakenMultiplier = 0.55;
            bots['bot_eliminator'] = elim;
        }
    }*/
}

function resetMatch() {
    console.log("Match resetting...");
    matchTimer = 15 * 60;
    bullets = {};
    walls = generateWalls(12);
    specialsSpawned=false;
    matchStarted = Object.values(players).length > 0;
    Object.values(players).forEach(p => {
        const pos = getSafeSpawn();
        Object.assign(p, { x: pos.x, y: pos.y, hp: 100, lives: 3, score: 0, isSpectating: false, lastFireTime: 0 });
    });
    spawnSpecialBots()
    Object.values(bots).forEach(b => {
        const pos = getBotSafeSpawn();
        Object.assign(b, { x: pos.x, y: pos.y, hp: 100, score: 0 , spawnTime:Date.now()});
    });
    io.emit('init', { id: null, mapSize: MAP_SIZE, walls });
    io.emit('matchReset');
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

        const minDist = Math.hypot(nearest.x - this.x, nearest.y - this.y);
        if (minDist > 800) return;
        this.angle = Math.atan2(nearest.y - this.y, nearest.x - this.x);

        const fireCooldown =
            this.id === 'bot_bobby' ? 1500 :
            this.id === 'bot_rob' ? 700 :
            400; // Eliminator

        let burstChance = 0;

        if (this.id === 'bot_eliminator') {
            if (this.recentHits >= 4) {
                burstChance = 1; 
                this.recentHits = 0;
            } else {
                burstChance = 0.25;
            }
        }

        if (minDist < 700 && Date.now() - this.lastFireTime > fireCooldown) {
            const shots = Math.random() < burstChance ? 4 : 1;

            for (let i = 0; i < shots; i++) {
                const bid = 'bot_b' + (++bulletIdCounter);
                bullets[bid] = {
                    id: bid,
                    x: this.x,
                    y: this.y,
                    angle: this.angle + (Math.random() - 0.5) * 0.08,
                    owner: this.id,
                    speed: this.bulletSpeed / 60,
                    born:Date.now(),
                };
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
            const maxHp = 100;
            const regen = this.isRetreating ? 6 : 3;
            this.hp = Math.min(maxHp, this.hp + regen);


            this.lastRegenTime = Date.now();
        }

        let moveSpeed = this.speed;

        if (this.id === 'bot_eliminator' && Date.now() - this.lastFireTime < 600) {
            moveSpeed *= 0.5;
        }

        if (this.hp <= 30) {
            this.isRetreating = true;
        }

        if (this.isRetreating) {
            moveSpeed *= 1.25;

            const targets = Object.values(players).filter(p => !p.isSpectating);
            if (targets.length) {
                let nearest = targets.reduce((a, b) =>
                    Math.hypot(a.x - this.x, a.y - this.y) <
                    Math.hypot(b.x - this.x, b.y - this.y) ? a : b
                );
                this.angle = Math.atan2(this.y - nearest.y, this.x - nearest.x);
            }

            const vx = Math.cos(this.angle);
            const vy = Math.sin(this.angle);
            const len = Math.hypot(vx, vy) || 1;

            let nx=this.x + (vx / len) * moveSpeed;
            let ny=this.y + (vy / len) * moveSpeed;
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

        if (!collidesWithWall(nx, ny, ENTITY_RADIUS)) {
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
        const rawName = data.name || "";
        const cleanedName = cleanUsername(rawName);
        
        if (cleanedName.startsWith('Spectre') && cleanedName !== rawName && rawName !== "") {
            nameAttempts[socket.id] = (nameAttempts[socket.id] || 0) + 1;
            if (nameAttempts[socket.id] >= MAX_ATTEMPTS) {
                socket.emit('errorMsg', 'Disconnected for repeated naming violations.');
                socket.disconnect();
                return;
            }
            socket.emit('errorMsg', `Inappropriate name. ${MAX_ATTEMPTS - nameAttempts[socket.id]} attempts remaining.`);
            return;
        }
        if (Object.keys(players).length >= MAX_PLAYERS) {
            socket.emit('errorMsg', 'Match is full.');
            return;
        }

        if (matchStarted && matchTimer <= JOIN_CUTOFF_SECONDS) {
            socket.emit('errorMsg', 'Match already in progress. Joining is disabled during final 5 minutes of a match.');
            return;
        }

        handleSuccessfulJoin(socket, cleanedName);
    });

    socket.on('input', input => {
        const p = players[socket.id];
        if (!p) return;
        if (!matchStarted) {
            matchStarted = true;
            matchTimer = 15 * 60;
        }
        p.input = input;
    });


    socket.on('fire', data => {
        const p = players[socket.id];
        if (!p || p.isSpectating || p.lives<=0) return;

        const now = Date.now();
        if (now - p.lastFireTime < p.fireCooldown) return; // 10 shots/sec
        p.lastFireTime = now;

        if (Object.keys(bullets).length > MAX_BULLETS) return;

        const id = 'b' + (++bulletIdCounter);
        bullets[id] = {
            id,
            x: p.x,
            y: p.y,
            angle: data.angle,
            owner: socket.id,
            speed: 900 / 60,
            born: now
        };
    });


    socket.on('disconnect', () => { 
        const color = players[socket.id]?.color;

        delete players[socket.id];
        delete nameAttempts[socket.id];

        if (color) USED_COLORS.delete(color);

        if (Object.keys(players).length === 0) {
            matchStarted = false;
            resetScheduled = false;
        }

        if (Object.keys(players).length === 0 && !resetScheduled) {
            resetScheduled=true;
            setTimeout(()=>{
                resetScheduled=false
                resetMatch()
            },1000);
        }

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

    if (matchStarted && activePlayers) {
        matchTimer = Math.max(0, matchTimer - delta);
    }

    if (matchTimer <= 0 && matchTimer !== -1 && !resetScheduled) {
        matchTimer = -1;
        resetScheduled = true;
        setTimeout(() => {
            resetScheduled = false;
            resetMatch();
        }, 10000);
    }


    Object.values(players).forEach(p => {
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
    botAccumulator+=delta;
    if (botAccumulator>= 1/30){
        Object.values(bots).forEach(b => {if (b.retired) return; if (b.id === 'bot_eliminator') b.updateAdvanced(players); else b.update(players);});
        botAccumulator=0;
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

                if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
                    let damage = 10;

                    if (target.id === 'bot_rob') {
                        const now = Date.now();

                        if (now - target.lastHitTime < 250) {
                            target.hitChain++;
                        } else {
                            target.hitChain = 0;
                        }

                        target.lastHitTime = now;
                        const spamReduction = Math.min(0.6, target.hitChain * 0.1);
                        damage *= (1 - spamReduction);
                    }
                    if (target.id === 'bot_eliminator') {
                        const now = Date.now();
                        if (now - target.lastHitTime < 400) {
                            target.recentHits++;
                        } else {
                            target.recentHits = 1;
                        }
                        target.lastHitTime = now;
                    }


                    const multiplier = target.damageTakenMultiplier ?? 1;
                    target.hp -= damage * multiplier;

                    target.lastRegenTime = Date.now();

                    if (target.hp <= 0) {
                        const shooter = players[b.owner] || bots[b.owner];
                        const victimName = target.name;
                        const shooterName = shooter ? shooter.name : "The Void";

                        io.emit('killEvent', { shooter: shooterName, victim: victimName });

                        if (shooter) {
                            hit = true;
                            if (b.owner.toString().includes('bot')) {
                                if (!target.id.toString().includes('bot')) {
                                    shooter.score += (b.owner === 'bot_bobby' ? 6 : 3);
                                }
                            } else {
                                if (target.id === 'bot_bobby') shooter.score += 1;
                                else if (target.id === 'bot_rob') shooter.score += 3;
                                else if (target.id === 'bot_eliminator') shooter.score += 6;
                                else shooter.score += 3;
                            }
                        }

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
                                    lastRegenTime: Date.now()
                                });
                                io.to(target.id).emit('respawned', {
                                    x: target.x,
                                    y: target.y
                                });
                            }
                        } else {
                            if (target.retired) return;

                            if (shouldRespawnBot(target.id)) {
                                const respawn = getBotSafeSpawn();
                                Object.assign(target, {
                                    hp: 100,
                                    x: respawn.x,
                                    y: respawn.y,
                                    spawnTime: Date.now()
                                });
                            } else {
                                target.retired = true;
                                if (target.id === 'bot_eliminator') {
                                    console.log('The Eliminator has fallen…');
                                } else if (target.id === 'bot_rob') {
                                    console.log('Rob has left the arena.');
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
            slimPlayers[id] = {
                x: p.x,
                y: p.y,
                hp: p.hp,
                angle: p.angle,
                isSpectating: p.isSpectating,
                spawnProtected: Date.now() < p.spawnProtectedUntil,
                stamina: p.stamina,
                score:p.score,
                lives:p.lives,
                color:p.color,
                name:p.name
            };
        }
        const slimBots = {};
        for (const [id, b] of Object.entries(bots)) {
            if (b.retired) continue;
            slimBots[id] = {
                id: b.id,
                x: b.x,
                y: b.y,
                hp: b.hp,
                score: b.score,
                angle: b.angle,
                name: b.name,
                color: b.color
            };
        }

        const slimBullets = {};
        for (const [id, b] of Object.entries(bullets)) {
            slimBullets[id] = {
                x: b.x,
                y: b.y,
                angle: b.angle
            };
        }

        io.emit('state', { players:slimPlayers, bots:slimBots, bullets:slimBullets, matchTimer });
        lastNetSend = Date.now();
    }
}, TICK_RATE);

server.listen(PORT, '0.0.0.0', () => { 
    console.log(`SpectreBolt Arena Server Active on Port ${PORT}`); 
    console.log(`Running on http://localhost:${PORT}`)
});