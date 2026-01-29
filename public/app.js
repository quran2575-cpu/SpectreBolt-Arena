/*
 * Spectrebolt Arena - 2D Multiplayer Shooter Game Client-Side
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
const BASE_VIEW_SIZE = 900;
const leaderboardScroll= document.getElementById('leaderboardScroll');
const IDLE_TIMEOUT = 60_000;

let idleDisconnectTimer = null;
let isRematching = false;
let pbSavedThisMatch = false;
let rematchCountdownInterval = null;
let gameOverSince = null;
let lastMiniUpdate = 0;
let myId=null;
let mapSize=[];
let walls = [];
let players = {};
let bots = {};
let bullets = {};
let matchTimer = 1200;
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
let rematchRequested = false;
let isGameOverLocked = false;
let cachedStandalone = null;
let cachedHandheld = null;
        
function isHandheldLike() {
    const mq = window.matchMedia;

    const coarsePointer = mq('(pointer: coarse)').matches;
    const finePointer = mq('(pointer: fine)').matches;
    const hoverNone = mq('(hover: none)').matches;

    const smallScreen = Math.min(window.screen.width, window.screen.height) < 900;
    const hasKeyboard = navigator.keyboard !== undefined || matchMedia('(any-pointer: fine)').matches;

    return (coarsePointer &&!finePointer &&hoverNone &&(smallScreen || !hasKeyboard));
}


function isHandheldLikeCached() {
    if (cachedHandheld !== null) return cachedHandheld;
    cachedHandheld = isHandheldLike();
    return cachedHandheld;
}

function isStandaloneModeCached() {
    if (cachedStandalone !== null) return cachedStandalone;

    cachedStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    return cachedStandalone;
}

function isPortrait() {
    return window.innerHeight > window.innerWidth;
}

function updateUXWarnings() {
    const homepageWarning = document.getElementById('homepage-warning');
    const portraitWarning = document.getElementById('portrait-warning');
    const inGame = !!players?.[myId];

    if (!homepageWarning || !portraitWarning) return;

    homepageWarning.style.display = 'none';
    portraitWarning.style.display = 'none';

    if (inGame) return;

    const handheld = isHandheldLikeCached();
    const standalone = isStandaloneModeCached();
    const portrait = isPortrait();

    if (handheld && !standalone) {
        homepageWarning.style.display = 'block';
        return;
    }

    if (handheld && standalone && portrait) {
        portraitWarning.style.display = 'block';
    }
}


window.addEventListener('DOMContentLoaded', updateUXWarnings);
window.addEventListener('resize', updateUXWarnings);
window.addEventListener('orientationchange', updateUXWarnings);

window.addEventListener('resize', () => cachedHandheld = null);

const standaloneMQ = window.matchMedia('(display-mode: standalone)');
standaloneMQ.addEventListener('change', () => {
    cachedStandalone = null;
    updateUXWarnings();
});

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

    const cssWidth = window.visualViewport?.width || window.innerWidth;
    const cssHeight = window.visualViewport?.height || window.innerHeight;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";

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
    resizeCanvas();
});

let isJoining = false;
        
window.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    if (!startBtn) return console.error("Start button not found!");

    startBtn.onclick = async () => {
        await requestFullScreen();
        const name = document.getElementById('nameInput').value;
        startBtn.disabled = true;
        let clientId = localStorage.getItem('clientId');
        if (!clientId) {
            clientId = 'c_' + Math.random().toString(36).slice(2,10);
            localStorage.setItem('clientId', clientId);
        }
        isJoining=true;
        socket.emit('joinGame', { name: name || "Sniper", clientId });
        document.getElementById('nameScreen').style.display = 'none';
    };
});

window.addEventListener('beforeunload', () => {
    trySavePersonalBest();
    myId = null;
    players = {};
    bots = {};
    bullets = {};
});

const tryReload = () => {
    if (!players[myId]) {
        location.reload();
    }
};

canvas.addEventListener('click', tryReload);
canvas.addEventListener('touchstart', tryReload, { passive: true });

function clampLeaderboardToTop5() {
    const scroll = document.getElementById('leaderboardScroll');
    if (!scroll) return;

    const rows = scroll.querySelectorAll('.leaderboard-row');
    if (rows.length === 0) return;

    const rowHeight = rows[0].offsetHeight;
    const maxVisible = 5;

    scroll.style.maxHeight = (rowHeight * maxVisible) + 'px';
    scroll.style.overflowY = rows.length > maxVisible ? 'auto' : 'hidden';
}

window.addEventListener('resize', clampLeaderboardToTop5);

window.addEventListener('DOMContentLoaded', ()=>{
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

    window.addEventListener('keydown', e => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight","Space"].includes(e.key)) {
            e.preventDefault();
        }

        keys[e.code] = true;

        if (e.code === 'Space') {
            spaceHeld = true;
        }
    });

    window.addEventListener('keyup', e => {
        keys[e.code] = false;
        if (e.code === 'Space') spaceHeld = false;
    });

    window.addEventListener('mousemove', e => {
        if (joy.active) return;

        const rect = canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;

        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        mouseAngle = Math.atan2(my - cy, mx - cx);
    });
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (socket.connected) {
            idleDisconnectTimer = setTimeout(() => {
                socket.disconnect();
            }, IDLE_TIMEOUT);
        }
    } else {
        if (idleDisconnectTimer) {
            clearTimeout(idleDisconnectTimer);
            idleDisconnectTimer = null;
        }
    }
});

socket.on('init', d => {
    if (!d || !d.id) return;
    if (isGameOverLocked && !isRematching) return;
    isJoining=false;
    pbSavedThisMatch = false;

    myId = d.id;
    mapSize = d.mapSize;
    walls = d.walls;
    const isForcedSpectator = !!d.forcedSpectator;

    players[d.id] = {id: d.id,x: d.spawnX ?? mapSize / 2,y: d.spawnY ?? mapSize / 2,angle: 0,hp: isForcedSpectator ? 0 : 100,stamina: 100,lives: isForcedSpectator ? 0 : 3,score: 0,name: d.name || "Sniper",color: d.color || null,isSpectating: isForcedSpectator,forcedSpectator: isForcedSpectator,spawnProtected: true};

    camX = players[d.id].x;
    camY = players[d.id].y;
});
socket.on('rematchDenied', (msg) => {
    alert(msg || "Cannot rematch yet or game is already resetting. Please wait a bit then try again");
    isRematching=false;
    document.getElementById('rematchBtn').disabled=false;
});
socket.on('rematchAccepted', (data) => {
    if (data.id !== myId) return;

    isGameOverLocked = false;
    rematchRequested = false;
    pbSavedThisMatch = false;
    gameOverSince = null;
    
    lastInput = null;
    spaceHeld = false;
    lastShootTime = 0;
    lastSpaceShot = 0;


    matchTimer = data.matchTimer;

    const me = players[myId] || {};
    players[myId] = {
        ...me,
        x: data.x ?? mapSize / 2,
        y: data.y ?? mapSize / 2,
        hp: 100,
        lives: 3,
        score: 0,
        isSpectating: false,
        forcedSpectator: false,
        spawnProtected: true,
        name: me.name || "Sniper",
        color: data.color || me.color || null
    };

    camX = players[myId].x;
    camY = players[myId].y;

    document.getElementById('rematchBtn').disabled=false;
    document.getElementById('gameOver').style.display = 'none';
    document.getElementById('gameOverNotice').style.display = 'none';
});
socket.on('killEvent', (data) => {
    const feed = document.getElementById('killFeed');
    if (!feed) return;
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
    bots = s.bots;
    leaderboardEntities = {};

    Object.values(s.players).forEach(p => {
        if (p.forcedSpectator) return;
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
            color: p.color,
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

    let lastScore = null;
    let rank = 0;

    const ranked = all.map((p, index) => {
        if (p.score !== lastScore) {
            rank = index + 1;
            lastScore = p.score;
        }
        return { ...p, rank };
    });

    const html = ranked.map((p, index) => {
        const isMe = p.id === myId;
        const top5Highlight = index < 5; 
        return `
        <div class="leaderboard-row" 
            data-id="${p.id}" 
            style="${isMe ? 'outline: 1px solid #0f4;' : ''}${top5Highlight ? ' background: rgba(0,255,68,0.05); font-weight: bold;' : ''}">
            <span class="lb-rank">${p.rank}.</span>
            <span class="lb-name">${p.name}</span>
            <span class="lb-score">${p.score} ${isMe ? '<span style="color:#0f4">[YOU]</span>' : ''}</span>
        </div>`;
    }).join('');
    
    const leaderboardScroll = document.getElementById('leaderboardScroll');
    leaderboardScroll.innerHTML = html;

    clampLeaderboardToTop5();

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
    msg.className = 'elim-msg';
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
    msg.className = 'elim-msg';
    msg.textContent = 'The Eliminator has fallen.. with no return.';
    box.appendChild(msg);
    setTimeout(() => msg.remove(), 4000);
});
socket.on('mapUpdate', d => {    mapSize = d.mapSize;    walls = d.walls;});
socket.on('errorMsg', (msg) => { alert(msg); document.getElementById('nameScreen').style.display = 'flex'; document.getElementById('startBtn').disabled=false;});
socket.on('disconnect', (reason) => {
    trySavePersonalBest();
    console.warn('Socket disconnected:', reason);
    isJoining = false;

    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.disabled = false;

    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) rematchBtn.disabled = false;

    isRematching = false;

    if (!players[myId]) {
        const nameScreen = document.getElementById('nameScreen');
        if (nameScreen) nameScreen.style.display = 'flex';
    }
});


document.getElementById('rematchBtn').onclick = () => {
    if (isRematching) return;
    isRematching = true;

    socket.emit('rematch');
    document.getElementById('rematchBtn').disabled=true;
};


setInterval(() => {
    if (isGameOverLocked) return;

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
    if (isGameOverLocked) return;

    if (!spaceHeld) return;
    const me = players[myId];
    if (!me || me.isSpectating) return;

    const now = performance.now();
    if (now - lastSpaceShot < SHOOT_INTERVAL) return;

    lastSpaceShot = now;
    socket.emit('fire', { angle: mouseAngle });
}, 1000 / 60);
setInterval(() => {
    if (isGameOverLocked) return;

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
    if (!mapSize || !Number.isFinite(mapSize) || mapSize <= 0) return;
    if (!miniCanvas.width || !miniCanvas.height) return;

    const scale = miniCanvas.width / mapSize;
    if (!Number.isFinite(scale) || scale <= 0) return;

    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
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

    const all = Object.values(leaderboardEntities).sort((a, b) => b.score - a.score);

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

function trySavePersonalBest() {
    if (pbSavedThisMatch) return;

    const me = players[myId];
    if (!me) return;

    pbSavedThisMatch = true;

    if (me.score > personalBest) {
        personalBest = me.score;
        localStorage.setItem("personalBest", personalBest);
    }
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
    if (isJoining || !players[myId]) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = "#f44";
        ctx.font = "20px monospace";
        drawCenteredText(ctx, isJoining ? "Joining game...\nTaking a while? Tap here to refresh. " : "Black screen?\nTap here to refresh. ", 20);
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

    const rawZoom = Math.min(canvas.width, canvas.height) / BASE_VIEW_SIZE;
    const zoom = Math.max(0.8, Math.min(1.4, rawZoom));

    if (!Number.isFinite(zoom) || zoom <= 0) return;

    ctx.scale(zoom, zoom);
    ctx.translate(canvas.width / (2 * zoom) - camX,canvas.height / (2 * zoom) - camY);

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

    const activePlayers = Object.values(players).filter(p => !p.isSpectating && !p.forcedSpectator);

    if (activePlayers.length === 0 && !isRematching && matchTimer > 0) {
        if (!isGameOverLocked) {
            isGameOverLocked = true;
            gameOverSince = Date.now();
            trySavePersonalBest();
        }

        document.getElementById('gameOver').style.display = 'flex';
        renderWinners();
        if (mapSize > 0) drawMinimap();

        const me = players[myId];
        if (me) {
            if (me.score === personalBest) {
                document.getElementById('score').innerHTML =`NEW PERSONAL BEST: ${me.score}`;
            } else {
                document.getElementById('score').innerHTML =`SCORE: ${me.score}<br>PERSONAL BEST: ${personalBest}`;
            }
        }

        return; 
    }

    if (matchTimer <= 0 && !isRematching) {
        if (!isGameOverLocked) {
            isGameOverLocked = true;
            gameOverSince = Date.now();
            trySavePersonalBest();
        }

        document.getElementById('gameOver').style.display = 'flex';

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderWinners();
        if (mapSize > 0) drawMinimap();

        const me = players[myId];
        if (me) {
            if (me.score === personalBest) {
                document.getElementById('score').innerHTML =`NEW PERSONAL BEST: ${me.score}`;
            } else {
                document.getElementById('score').innerHTML =`SCORE: ${me.score}<br>PERSONAL BEST: ${personalBest}`;
            }
        }

        if (gameOverSince && Date.now() - gameOverSince > 15000) {
            const notice = document.getElementById('gameOverNotice');
            if (notice) {
                notice.innerText = "Connection stalled. You may safely press REMATCH.";
                notice.style.display = 'block';
            }
        }
        return;
    }

    if (Date.now() - lastMiniUpdate > 200) {
        if (mapSize > 0) drawMinimap();
        lastMiniUpdate = Date.now();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

let howToMode = 'mobile';

function openHowTo() {
    document.getElementById('howToPlay').style.display = 'flex';
    setHowToMode((isIOS || ('ontouchstart' in window)) ? 'mobile' : 'desktop');
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
    try {
        draw();
    } catch (e) {
        console.error("Rendering crash:", e);
    }
    requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);