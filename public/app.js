/*
 * SpectreBolt Arena - Multiplayer 2D Shooter Game Client-Side
 * Copyright (C) 2026 Saif Kayyali
 * GNU GPLv3
 */

const socket = io({ transports: ['websocket'], upgrade: false });
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const lerp = (a, b, t) => a + (b - a) * t;
const SHOOT_INTERVAL=100;
const isIOS = navigator.userAgentData? navigator.userAgentData.platform === 'iOS': /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

const MAX_DIST = 50;
const DEADZONE = 6;
        
let leaderboardUserScrolled = false;
let leaderboardScrollTimeout = null;
let lastMiniUpdate = 0;
let myId, mapSize, walls = [];
let players = {}, bots = {}, bullets = {}, matchTimer = 1200;
let keys = {};
let mouseAngle = 0;
let isMobileSprinting = false;
let joy = { active: false, startX: 0, startY: 0, id: null, x:0, y:0 };
let shootJoy = {active:false, x:0, y:0, id:null}
let camX=0; let camY=0;
let moveTouchId = null;
let personalBest = Number(localStorage.getItem("personalBest") || 0);
let lastInput = null;
let lastShootTime=0;
let spaceHeld = false;
let lastSpaceShot = 0;
let leaderboardEntities = {}; 
        

        
window.addEventListener('load', () => {
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
        document.getElementById('ios-prompt').style.display = 'block';
    }
});
if ('ontouchstart' in window) {
    document.getElementById('shootJoystick').style.display = 'block';
}



async function requestFullScreen() {
    const el = document.documentElement;
    try {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(()=>{});
        }
    } catch (err) { console.log(err); }
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;

    const width = window.visualViewport?.width || window.innerWidth;
    const height = window.visualViewport?.height || window.innerHeight;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 300);
});

if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resizeCanvas);
}

window.addEventListener('load', () => {
    const isStandalone =
        window.navigator.standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;

    if (isStandalone) {
        const footer = document.getElementById('footer');
        if (footer) footer.style.display = 'none';
    }
    resizeCanvas();
});

        
document.getElementById('startBtn').onclick = () => {
    requestFullScreen();
    const name = document.getElementById('nameInput').value;
    socket.emit('joinGame', { name: name || "Sniper" });
    document.getElementById('nameScreen').style.display = 'none';
};

document.getElementById('supportBtn').onclick = () => {
    window.open(
        'https://github.com/spectres-k/SpectreBolt-Arena/issues/new',
        '_blank'
    );
};

canvas.addEventListener('click', () => {
    if (!players[myId]) {
        window.open(
            'https://github.com/spectres-k/SpectreBolt-Arena/issues/new',
            '_blank'
        );
    }
});

        
const joyBase = document.getElementById('moveJoystick');
const joyKnob = document.getElementById('moveKnob');

joyBase.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    joy.active = true;
    joy.id = t.identifier;

    joy.startX = t.clientX;
    joy.startY = t.clientY;

    joyKnob.style.transform = "translate(0,0)";
    e.preventDefault();
}, { passive: false });


joyBase.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
        if (t.identifier !== joy.id) continue;

        let dx = t.clientX - joy.startX;
        let dy = t.clientY - joy.startY;

        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, MAX_DIST);
        const angle = Math.atan2(dy, dx);

        if (dist < DEADZONE) {
            joy.x = 0;
            joy.y = 0;
            joyKnob.style.transform = "translate(0,0)";
            return;
        }
        joy.x = Math.cos(angle) * (clamped / MAX_DIST);
        joy.y = Math.sin(angle) * Math.min(1, clamped / MAX_DIST);

        joyKnob.style.transform =`translate(${joy.x * MAX_DIST}px, ${joy.y * MAX_DIST}px)`;

        e.preventDefault();
    }
}, { passive: false });


joyBase.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
        if (t.identifier !== joy.id) continue;

        joy.active = false;
        joy.id = null;
        joy.x = 0;
        joy.y = 0;

        joyKnob.style.transform = "translate(0,0)";
    }
}, { passive: false });

const shootBase = document.getElementById('shootJoystick');
const shootKnob = document.getElementById('shootKnob');

shootBase.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    shootJoy.active = true;
    shootJoy.id = t.identifier;
    shootKnob.style.transform = "translate(0,0)";
    e.preventDefault();
}, { passive: false });

shootBase.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
        if (t.identifier !== shootJoy.id) continue;

        const rect = shootBase.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const dx = t.clientX - cx;
        const dy = t.clientY - cy;

        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, MAX_DIST);

        if (dist < DEADZONE) {
            shootJoy.x = 0;
            shootJoy.y = 0;
            shootKnob.style.transform = "translate(0,0)";
            return;
        }

        shootJoy.x = dx / dist;
        shootJoy.y = dy / dist;

        mouseAngle = Math.atan2(shootJoy.y, shootJoy.x);

        shootKnob.style.transform =`translate(${shootJoy.x * clamped}px, ${shootJoy.y * clamped}px)`;

        e.preventDefault();
    }
}, { passive: false });


shootBase.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
        if (t.identifier !== shootJoy.id) continue;

        shootJoy.active = false;
        shootJoy.id = null;
        shootJoy.x = 0;
        shootJoy.y = 0;
        shootKnob.style.transform = "translate(0,0)";
    }
}, { passive: false });

document.getElementById('sprintBtn').addEventListener('touchstart', (e) => { e.preventDefault(); isMobileSprinting = true; });
document.getElementById('sprintBtn').addEventListener('touchend', (e) => { e.preventDefault(); isMobileSprinting = false; });            

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);
window.addEventListener('mousemove', e => {
    if (joy.active) return;

    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    mouseAngle = Math.atan2(my - cy, mx - cx);
});
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') spaceHeld = true;
});
window.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'Space') spaceHeld = false;
});

const leaderboardEl = document.getElementById('leaderboard');

leaderboardEl.addEventListener('scroll', () => {
    leaderboardUserScrolled = true;
    clearTimeout(leaderboardScrollTimeout);
    leaderboardScrollTimeout = setTimeout(() => {
        leaderboardUserScrolled = false;
    }, 3000);
});

socket.on('init', d => {
    if (!d || !d.id) return;
    myId = d.id;
    mapSize = d.mapSize;
    walls = d.walls;
    const isForcedSpectator = !!d.forcedSpectator;

    players[d.id] = {id: d.id,x: d.spawnX ?? mapSize / 2,y: d.spawnY ?? mapSize / 2,angle: 0,hp: isForcedSpectator ? 0 : 100,stamina: 100,lives: isForcedSpectator ? 0 : 3,score: 0,name: d.name || "Sniper",color: d.color || null,isSpectating: isForcedSpectator,forcedSpectator: isForcedSpectator,spawnProtected: true};

    camX = players[d.id].x;
    camY = players[d.id].y;
});

socket.on('killEvent', (data) => {
    const feed = document.getElementById('killFeed');
    const msg = document.createElement('div');
    msg.className='kill-msg';
    msg.innerHTML = `<span style="color:var(--accent)">${data.shooter}</span> killed ${data.victim}`;
    feed.appendChild(msg);
    if (feed.children.length > 5) {
        feed.removeChild(feed.firstChild);
    }

    setTimeout(() => msg.remove(), 4000);
});
socket.on('state', s => {
    matchTimer = s.matchTimer;
    bullets = s.bullets;
    // Update active bots visually
    bots = s.bots;
    leaderboardEntities = {};

    // Leaderboard update
    Object.values(s.players).forEach(p => {
        if (p.forcedSpectator && p.score === 0) return;

        leaderboardEntities[p.id] = {
            id: p.id,
            name: p.name,
            score: p.score,
            isBot: false
        };
    });
    Object.values(s.bots).forEach(b => {
        leaderboardEntities[b.id] = {
            id: b.id,
            name: b.name,
            score: b.score,
            isBot: true
        };
    });



    
    Object.entries(s.players).forEach(([id, p]) => {
        const prev = players[id] || {};

        players[id] = {
            ...prev,
            ...p,
            color: prev.color ?? p.color,
            name: prev.name ?? p.name
        };
    });

    
    Object.keys(players).forEach(id => {
        if (!s.players[id]) delete players[id];
    });

    
    if (players[myId] && s.players[myId]) {
        players[myId].hp = s.players[myId].hp;
        players[myId].lives = s.players[myId].lives;
        players[myId].score = s.players[myId].score;
        players[myId].isSpectating = s.players[myId].isSpectating;
        players[myId].spawnProtected = s.players[myId].spawnProtected;
        players[myId].stamina = s.players[myId].stamina;
        players[myId].forcedSpectator = s.players[myId].forcedSpectator;
    }

    const all = Object.values(leaderboardEntities).sort((a, b) => b.score - a.score);

    const scoreList = document.getElementById('scoreList');

    let lastScore = null;
    let lastRank = 0;
    let topScore = all.length ? all[0].score : null;

    scoreList.innerHTML = all.map((p, index) => {
        if (p.score !== lastScore) {
            lastRank = index + 1;
            lastScore = p.score;
        }

        const isMe = p.id === myId;
        return `
            <div class="leaderboard-row"
                data-id="${p.id}"
                style="
                    ${isMe ? 'outline: 1px solid #0f4;' : ''}
                ">
                <span class="lb-rank">${lastRank}.</span>
                <span class="lb-name">${p.name}</span>
                <span class="lb-score">
                    ${p.score} ${isMe ? '<span style="color:#0f4">[YOU]</span>' : ''}
                </span>
            </div>
        `;}).join('');




    if (!leaderboardUserScrolled && myId) {
        const meRow = scoreList.querySelector(`[data-id="${myId}"]`);
        if (meRow && !meRow.isScrollingIntoView) {
            meRow.isScrollingIntoView = true;
            meRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
            setTimeout(() => { meRow.isScrollingIntoView = false; }, 400);
        }
    }
   
});
socket.on('respawned', (data)=>{ camX = data.x; camY = data.y; });
socket.on('RobSpawned', () => {
    const box = document.getElementById('robNotice');
    const msg = document.createElement('div');

    msg.className = 'rob-msg';
    msg.textContent = 'Rob has joined the arena';

    box.appendChild(msg);
    setTimeout(() => msg.remove(), 4000);
});
socket.on('EliminatorSpawned', () => {
    const box = document.getElementById('eliminatorNotice');
    const msg = document.createElement('div');
    msg.className = 'eliminator-msg';
    msg.textContent = 'THE ELIMINATOR HAS ENTERED THE ARENA';

    box.appendChild(msg);
    setTimeout(() => msg.remove(), 4000);
});
socket.on('RobRetired', () => {
    const box = document.getElementById('robNotice');
    const msg = document.createElement('div');
    msg.className = 'rob-msg';
    msg.textContent = 'Rob has left the arena.';

    box.appendChild(msg);
    setTimeout(() => msg.remove(), 4000);
});
socket.on('EliminatorRetired', () => {
    const box = document.getElementById('eliminatorNotice');
    const msg = document.createElement('div');
    msg.className = 'eliminator-msg';
    msg.textContent = 'The Eliminator has fallen.. with no return.';
    box.appendChild(msg);
    setTimeout(() => msg.remove(), 4000);
});
socket.on('mapUpdate', d => {    mapSize = d.mapSize;    walls = d.walls;});
socket.on('errorMsg', (msg) => { alert(msg); document.getElementById('nameScreen').style.display = 'flex'; });
socket.on('matchReset', ()=>{ document.getElementById('gameOver').style.display='none'; leaderboardEntities = {}; });

setInterval(() => {
    if (!shootJoy.active) return;

    const me = players[myId];
    if (!me || me.isSpectating) return;

    const now = performance.now();
    if (now - lastShootTime < SHOOT_INTERVAL) return;

    if (shootJoy.x === 0 && shootJoy.y === 0) return;

    lastShootTime = now;

    const angle = Math.atan2(shootJoy.y, shootJoy.x);
    mouseAngle = angle;

    socket.emit('fire', { angle });
}, 1000 / 60);
setInterval(() => {
    if (!spaceHeld) return;
    const me = players[myId];
    if (!me || me.isSpectating) return;

    const now = performance.now();
    if (now - lastSpaceShot < SHOOT_INTERVAL) return;

    lastSpaceShot = now;
    socket.emit('fire', { angle: mouseAngle });
}, 1000 / 60);


setInterval(() => {
    const me = players[myId];
    if (!me || matchTimer <= 0) return;

    const isSprinting = keys['ShiftLeft'] || keys['ShiftRight'] || isMobileSprinting;
    let dx = 0, dy = 0;

    if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

    if (joy.active) {
        dx = joy.x;
        dy = joy.y;
    }
    if (me.isSpectating) {
        dx = joy.x || dx;
        dy = joy.y || dy;
    }

    let aimingAngle = mouseAngle;

        if (shootJoy.active && (shootJoy.x !== 0 || shootJoy.y !== 0)) {
            aimingAngle = Math.atan2(shootJoy.y, shootJoy.x);
        }

    const quantAngle = Math.round(aimingAngle * 1000) / 1000;

    const input = { moveX:dx, moveY:dy, sprint:isSprinting, angle: quantAngle };
    if (me.isSpectating ||!lastInput ||input.moveX !== lastInput.moveX ||input.moveY !== lastInput.moveY ||input.sprint !== lastInput.sprint ||input.angle !== lastInput.angle) {
        socket.emit('input', input);
        lastInput = input;
    }

}, 1000/60);

function drawEntity(p, color, label, isMe) {
    ctx.save();
    if (p.isSpectating) ctx.globalAlpha = 0.5;
    ctx.translate(p.x, p.y);
    if (p.spawnProtected && !p.isSpectating) {
        ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2);
        ctx.strokeStyle = "#0cf"; ctx.lineWidth = 3; ctx.setLineDash([5, 5]); ctx.stroke();
        ctx.setLineDash([]);
    }
    if (!p.isSpectating) {
        ctx.fillStyle = "#333"; ctx.fillRect(-20, -45, 40, 6);
        ctx.fillStyle = p.hp > 30 ? "#0f4" : "#f22"; ctx.fillRect(-20, -45, (p.hp/100) * 40, 6);
    }
    ctx.save(); ctx.rotate(p.angle);
    ctx.fillStyle = color; ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
    ctx.fillRect(0, -6, 32, 12); ctx.strokeRect(0, -6, 32, 12);
    ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = isMe ? "#fff" : "#000"; ctx.lineWidth = isMe ? 4 : 3; ctx.stroke();
    ctx.fillStyle = "white"; ctx.globalAlpha = 1; ctx.font = "bold 14px Arial"; ctx.textAlign = "center";
    ctx.fillText((p.isSpectating ? "[GHOST] " : "") + label, 0, -55);
    ctx.restore();
}

const miniCanvas = document.getElementById('minimap-canvas');
const miniCtx = miniCanvas.getContext('2d');
const mapToggle = document.getElementById('mapToggle');
const miniContainer = document.getElementById('minimap-container');

mapToggle.onclick = () => {
    const hidden = miniContainer.style.display === 'none';
    miniContainer.style.display = hidden ? 'block' : 'none';
    mapToggle.innerText = hidden ? 'HIDE MAP' : 'SHOW MAP';
};

function drawMinimap() {
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    const scale = miniCanvas.width / mapSize;
    miniCtx.fillStyle = "#444";
    walls.forEach(w => miniCtx.fillRect(w.x * scale, w.y * scale, w.w * scale, w.h * scale));
    Object.values(bots).forEach(b => {
        if (b.retired) return;
        miniCtx.fillStyle = "red"; miniCtx.beginPath();
        miniCtx.arc(b.x * scale, b.y * scale, 3, 0, Math.PI * 2); miniCtx.fill();
    });
    Object.values(players).forEach(p => {
        if (p.id !== myId) {
            miniCtx.fillStyle = p.isSpectating ? "rgba(255,255,255,0.3)" : "white";
            miniCtx.beginPath(); miniCtx.arc(p.x * scale, p.y * scale, 2, 0, Math.PI * 2); miniCtx.fill();
        }
    });
    const me = players[myId];
    if (me) {
        miniCtx.fillStyle = "#0f4"; miniCtx.beginPath();
        miniCtx.arc(me.x * scale, me.y * scale, 4, 0, Math.PI * 2); miniCtx.fill();
    }
}

function renderWinners() {
    const winnerBox = document.getElementById('winnerList');
    if (!winnerBox) return;

    const all = Object.values(leaderboardEntities)
        .filter(e => e.score > 0)
        .sort((a, b) => b.score - a.score);

    if (!all.length) {
        winnerBox.innerHTML = `<div>No winners this round.</div>`;
        return;
    }

    const topScore = all[0].score;
    const winners = all.filter(p => p.score === topScore);

    winnerBox.innerHTML = `
        <div style="margin-bottom: 10px;">
            <b>${winners.length > 1 ? 'WINNERS' : 'WINNER'}</b>
        </div>
        ${winners.map(w => `
            <div>
                ${w.name}${w.isBot ? ' 🤖' : ''} — ${w.score}
            </div>
        `).join('')}
    `;
}


function drawCenteredText(ctx, text, yOffset = 0, lineHeight = 26) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = text.split('\n');
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, i) => {
        ctx.fillText(line, canvas.width / 2, startY + i * lineHeight + yOffset);
    });

    ctx.restore();
}


function draw(){
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!players || !players[myId]) {
        ctx.setTransform(1,0,0,1,0,0);
        ctx.fillStyle = "#111";
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = "#f44";
        ctx.font = "20px monospace";
        ctx.globalAlpha = 0.8 + Math.sin(Date.now() / 400) * 0.2;
        drawCenteredText(ctx,"Black screen?\nTap here to report a bug",20);

        ctx.globalAlpha = 1;
        return;
    }

    if (!mapSize || !walls) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = "#fa0";
        ctx.font = "20px monospace";
        ctx.globalAlpha = 0.8 + Math.sin(Date.now() / 400) * 0.2;
        drawCenteredText(ctx, "Waiting for map...");
        ctx.globalAlpha = 1;
        return;
    }       
            

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const banner = document.getElementById('lateSpectatorBanner');
    const me = players[myId];

    if (me?.forcedSpectator && matchTimer > 0) {
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }
    if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.y)) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (!Number.isFinite(camX) || !Number.isFinite(camY)) {
        camX = me.x;
        camY = me.y;
    }

    ctx.save();
    const CAM_LERP = 0.22;
    camX += (me.x - camX) * CAM_LERP;
    camY += (me.y - camY) * CAM_LERP;

    if (!Number.isFinite(camX) || !Number.isFinite(camY)) {
        camX = me.x;
        camY = me.y;
    }

    ctx.translate(canvas.width / 2 - camX, canvas.height / 2 - camY);

    ctx.fillStyle = "#006666";
    ctx.fillRect(0, 0, mapSize, mapSize);

    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    for (let i = 0; i <= mapSize; i += 100) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, mapSize); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(mapSize, i); ctx.stroke();
    }

    walls.forEach(w => {
        ctx.fillStyle = "#333";
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 4;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
    });
    Object.values(bullets).forEach(b => {
        if (Math.abs(b.x - camX) > canvas.width || Math.abs(b.y - camY) > canvas.height) return;

        ctx.beginPath();
        ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ff0";
        ctx.fill();
    });


    Object.values(bots).forEach(b => {
        if (b.retired) return;
        b.renderX = lerp(b.renderX || b.x, b.x, 0.15);
        b.renderY = lerp(b.renderY || b.y, b.y, 0.15);
        drawEntity({ ...b, x: b.renderX, y: b.renderY }, b.color, b.name, false);
    });

    Object.values(players).forEach(p => {
        if (p.id === myId) return;
        p.renderX = lerp(p.renderX || p.x, p.x, 0.15);
        p.renderY = lerp(p.renderY || p.y, p.y, 0.15);
        drawEntity({ ...p, x: p.renderX, y: p.renderY }, p.color, p.name, false);
    });

    drawEntity(me, me.color, me.name, true);
    ctx.restore();

    document.getElementById('hpText').innerText = Math.ceil(me.hp);
    document.getElementById('livesText').innerText = me.lives;
    document.getElementById('staminaBar').style.width = me.stamina + "%";

    const mins = Math.floor(matchTimer / 60);
    const secs = Math.floor(matchTimer % 60).toString().padStart(2, '0');
    document.getElementById('timer').innerText = `TIME: ${mins}:${secs}`;

    if (matchTimer <= 0) {
        document.getElementById('gameOver').style.display = 'flex';

        renderWinners();

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        drawMinimap();

        if (me.score > personalBest) {
            personalBest = me.score;
            localStorage.setItem("personalBest", personalBest);
            document.getElementById('score').innerHTML = `NEW PERSONAL BEST: ${me.score}`;
        } else {
            document.getElementById('score').innerHTML =`SCORE: ${me.score}<br>PERSONAL BEST: ${personalBest}`;
        }
        return;
    }

    if (Date.now() - lastMiniUpdate > 200) {
        drawMinimap();
        lastMiniUpdate = Date.now();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
}
let howToMode = 'mobile';

function openHowTo() {
    document.getElementById('howToPlay').style.display = 'flex';
    setHowToMode(isIOS || 'ontouchstart' in window ? 'mobile' : 'desktop');
}

function closeHowTo() {
    document.getElementById('howToPlay').style.display = 'none';
}
function setHowToMode(mode) {
    howToMode = mode;

    document.getElementById('howto-mobile').style.display = mode === 'mobile' ? 'block' : 'none';
    document.getElementById('howto-desktop').style.display = mode === 'desktop' ? 'block' : 'none';
    document.getElementById('howto-title').innerText = mode === 'mobile' ? 'HOW TO PLAY (MOBILE)' : 'HOW TO PLAY (DESKTOP)';
    document.getElementById('howto-switch').innerText = mode === 'mobile' ? 'DESKTOP' : 'MOBILE';
}

document.getElementById('howto-switch').onclick = () => {
    setHowToMode(howToMode === 'mobile' ? 'desktop' : 'mobile');
};

function renderLoop() {
    draw();
    requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);