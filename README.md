# SpectreBolt Arena 
### PSA Not Ever Making Another Game (Traumatized by this game)
A real-time multiplayer 2D sniper game built with **Node.js**, **Socket.io** and **HTML5 Canvas**.

## Technical Features
* **Real-Time Networking:** Uses WebSockets (Socket.io) for low-latency player synchronization and bullet tracking.
* **Custom Game Engine:** Built from scratch without external game frameworks to maximize performance and control.
* **Physics & Math:** * Directional aiming using `Math.atan2`.
    * Projectile motion using Trigonometric functions (`cos`, `sin`).
    * Circle-based collision detection using the Distance Formula.
* **Smart AI Bots:** Integrated server-side bots with autonomous targeting and movement logic.
* **Camera System:** Dynamic world-to-screen transformation allowing the camera to follow the local player.

## Controls
* **WASD / Arrow Keys:** Movement
* **Mouse:** Aiming
* **Left Click:** Shoot

## How to Run Locally:

## Prerequisites: 
* Node.js (v14 or higher recommended)

* npm (comes bundled with Node.js)

### Step 1: Clone the repo:
```bash
git clone https://github.com/saifkayyali3/SpectreBolt-Arena.git
cd SpectreBolt-Arena
```
### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Run:

#### If you want to play:
```bash
node start
#Open localhost:8080
```

#### If your a dev:
```bash
npm run dev
```

## License
This project is licensed under the **GNU GPLv3** - see the [License](LICENSE) file for details.