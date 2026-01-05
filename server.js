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
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, 'public')));

const RELEASES = {
    ROB: false,
    ELIMINATOR: false
};

const MAP_SIZE = 2000;
const TICK_RATE = 1000 / 60;
const MAX_ATTEMPTS = 5;
const BASE_SPEED = 3.2;
const SPRINT_SPEED = 5.0;
const ENTITY_RADIUS = 18;


let players = {};
let nameAttempts = {};
let bots = {};
let bullets = {};
let bulletIdCounter = 0;
let matchTimer = 15 * 60;
let walls = generateWalls(12);
let resetScheduled = false;


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
function activateShield(player) {
    player.spawnProtected = true;
    setTimeout(() => {
        if (players[player.id]) {
            players[player.id].spawnProtected = false;
        }
    }, 3000); 
}

function handleSuccessfulJoin(socket, name) {
    if (matchTimer <= 0) resetMatch();
    const pos = getSafeSpawn();
    players[socket.id] = {
        id: socket.id,
        name: name,
        x: pos.x, y: pos.y, hp: 100, lives: 3, score: 0, stamina: 100,
        angle: 0, color: `hsl(${Math.random() * 360},70%,50%)`,
        isSpectating: false, 
        spawnProtected:true,
        lastRegenTime: Date.now(),
    };
    activateShield(players[socket.id]); 
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, walls });
}
function spawnSpecialBots() {
    delete bots['bot_rob'];
    delete bots['bot_eliminator'];

    if (RELEASES.ROB && Math.random() < 0.75) {
        const rob = new Bot('bot_rob', 'Rob', '#4A90E2', 3.2, 950);
        rob.damageTakenMultiplier = 1.0;
        bots['bot_rob'] = rob;
        console.log('Rob has entered the arena.');
    }

    if (RELEASES.ELIMINATOR && Math.random() < 0.25) {
        const elim = new Bot('bot_eliminator', 'Eliminator', '#E24A4A', 2.8, 1100);
        elim.isRetreating = false;
        elim.damageTakenMultiplier = 0.75;
        bots['bot_eliminator'] = elim;
        console.log('The Eliminator has entered the arena.');
    }
}

function resetMatch() {
    console.log("Match resetting...");
    matchTimer = 15 * 60;
    bullets = {};
    walls = generateWalls(12);
    Object.values(players).forEach(p => {
        const pos = getSafeSpawn();
        Object.assign(p, { x: pos.x, y: pos.y, hp: 100, lives: 3, score: 0, isSpectating: false });
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
    }

    fireAtPlayers(players) {
        
        if (Date.now() - this.spawnTime < 1200) return;

        const targets = Object.values(players).filter(p => !p.isSpectating);
        if (!targets.length) return;

        let nearest = targets.reduce((a, b) =>
            Math.hypot(a.x - this.x, a.y - this.y) <
            Math.hypot(b.x - this.x, b.y - this.y) ? a : b
        );

        const minDist = Math.hypot(nearest.x - this.x, nearest.y - this.y);
        this.angle = Math.atan2(nearest.y - this.y, nearest.x - this.x);

        const fireCooldown =
            this.id === 'bot_bobby' ? 1500 :
            this.id === 'bot_rob' ? 900 :
            400; // Eliminator

        const burstChance =
            this.id === 'bot_eliminator' && Date.now() - this.spawnTime > 2500
                ? 0.35
                : 0;

        if (minDist < 700 && Date.now() - this.lastFireTime > fireCooldown) {
            const shots = Math.random() < burstChance ? 3 : 1;

            for (let i = 0; i < shots; i++) {
                const bid = 'bot_b' + (++bulletIdCounter);
                bullets[bid] = {
                    id: bid,
                    x: this.x,
                    y: this.y,
                    angle: this.angle + (Math.random() - 0.5) * 0.15,
                    owner: this.id,
                    speed: this.bulletSpeed / 60
                };
            }

            this.lastFireTime = Date.now();
        }
    }

    update(players) {
        let moveSpeed=this.speed
        if (Date.now() - this.lastRegenTime > 3000) {
            this.hp = Math.min(100, this.hp + 5);
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

            this.x += (vx / len) * moveSpeed;
            this.y += (vy / len) * moveSpeed;

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



bots['bot_bobby'] = new Bot('bot_bobby', 'Bobby', '#8A9A5B', 2.4, 800);
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
        handleSuccessfulJoin(socket, cleanedName);
    });

    socket.on('input', input => {
        const p = players[socket.id];
        if (!p || p.isSpectating) return;

        p.input = input;
    });


    socket.on('fire', data => {
        const p = players[socket.id];
        if (!p || p.isSpectating) return;
        const id = 'b' + (++bulletIdCounter);
        bullets[id] = { id, x: p.x, y: p.y, angle: data.angle, owner: socket.id, speed: 900 / 60 };
    });

    socket.on('disconnect', () => { 
        delete players[socket.id]; 
        delete nameAttempts[socket.id]; 

        if (Object.keys(players).length === 0 && !resetScheduled) {
            resetMatch();
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

    if (matchTimer > 0) matchTimer = Math.max(0, matchTimer - (TICK_RATE / 1000));
    else if (matchTimer <= 0 && matchTimer !== -1 && !resetScheduled) {
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
        if (!p.input) return;


        let speed = p.isSpectating ? 15 : (
            p.input.sprint && p.stamina > 0
                ? SPRINT_SPEED
                : BASE_SPEED
        );


        let dx = p.input.moveX || 0;
        let dy = p.input.moveY || 0;

        if (!p.isSpectating){
            if (p.input.sprint && (dx || dy)) {
                p.stamina = Math.max(0, p.stamina - 1);
            } else {
                p.stamina = Math.min(100, p.stamina + 0.6);
            }
        }
        if (dx || dy) {
            const len = Math.hypot(dx, dy);

    
            if (len > 1) {
                dx /= len;
                dy /= len;
            }

            let nx = p.x + dx * speed;
            if (!collidesWithWall(nx, p.y, ENTITY_RADIUS)) {
                p.x = nx;
            }

            let ny = p.y + dy * speed;
            if (!collidesWithWall(p.x, ny, ENTITY_RADIUS)) {
                p.y = ny;
            }
        }

        p.angle = p.input.angle;
    });

    Object.values(bots).forEach(b => {if (b.retired) return;if (b.id === 'bot_eliminator') b.updateAdvanced(players); else b.update(players)});

    Object.values(bullets).forEach(b => {
        b.x += Math.cos(b.angle) * b.speed;
        b.y += Math.sin(b.angle) * b.speed;

        
        if (collidesWithWall(b.x, b.y, ENTITY_RADIUS) || b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE) { 
            delete bullets[b.id]; return; 
        }

        [...Object.values(players), ...Object.values(bots)].forEach(target => {
            if (target.id === b.owner || target.isSpectating || target.spawnProtected || target.retired) return;
            if (Math.hypot(b.x - target.x, b.y - target.y) < ENTITY_RADIUS) {
                const baseDamage = 10;
                const multiplier = target.damageTakenMultiplier ?? 1;
                target.hp -= baseDamage * multiplier;
                target.lastRegenTime = Date.now();

                if (target.hp <= 0) {
                    const shooter = players[b.owner] || bots[b.owner];
                    const victimName=target.name
                    const shooterName = shooter ? shooter.name : "The Void";
                    io.emit('killEvent', { shooter: shooterName, victim: victimName });
                    if (shooter) {
                        
                        if (b.owner.toString().includes('bot')) {
                            if (!target.id.toString().includes('bot')) shooter.score += (b.owner === 'bot_bobby' ? 6 : 3);
                        } else {
                            if (target.id === 'bot_bobby') shooter.score += 1;
                            else if (target.id === 'bot_rob') shooter.score += 3;
                            else if (target.id === 'bot_eliminator') shooter.score += 6;
                            else shooter.score += 3; 
                        }
                    }
                    
                    if (!target.id.toString().includes('bot')) {
                        target.lives--;
                        if (target.lives <= 0) { target.hp = 0; target.isSpectating = true;} 
                        else {
                            const respawnPos = getSafeSpawn();
                            Object.assign(target, { x: respawnPos.x, y: respawnPos.y, hp: 100, stamina: 100 , spawnProtected:true, lastRegenTime: Date.now()});
                            activateShield(target)
                            io.to(target.id).emit('respawned', { x: target.x, y: target.y });
                        }
                    } else {
                        if (target.retired) return;
                        
                        if (shouldRespawnBot(target.id)) {
                            const respawn = getBotSafeSpawn();
                            Object.assign(target, {
                                hp: 100,
                                x: respawn.x,
                                y: respawn.y,
                                spawnTime: Date.now(),
                                spawnProtected:false
                            });
                        } else {
                            target.retired=true;
                            if (target.id === 'bot_eliminator') {
                                console.log('The Eliminator has fallen… and does not return.');
                            } else if (target.id === 'bot_rob') {
                                console.log('Rob has left the arena.');
                            }
                        }
                        
                    }
                }
                delete bullets[b.id];
            }
        });
    });
    io.emit('state', { players, bots, bullets, matchTimer });
}, TICK_RATE);

server.listen(PORT, '0.0.0.0', () => { 
    console.log(`SpectreBolt Arena Server Active on Port ${PORT}`); 
    console.log(`Running on http://localhost:${PORT}`)
});