# Spectrebolt Arena 
A real-time multiplayer 2D top-down shooter game built using **Node.js**, **Socket.io** and **HTML5 Canvas**.

---

## Technical Features
* **Real-Time Networking:** Uses WebSockets (Socket.io) for low-latency player synchronization and bullet tracking.
* **Custom Game Engine:** Built from scratch without external game frameworks to maximize performance and control.
* **Physics & Math:** * Directional aiming using `Math.atan2`.
    * Projectile motion using Trigonometric functions (`cos`, `sin`).
    * Circle-based collision detection using the Distance Formula.
* **Smart AI Bots:** Integrated server-side bots with autonomous targeting and movement logic.
* **Camera System:** Dynamic world-to-screen transformation allowing the camera to follow the local player.

---

## Live Demo:
Check out the game at **[Spectrebolt Arena](https://spectrebolt-arena-9xk4.onrender.com/)**

---

## Controls:

### - Controls On Desktop/Laptop:
* **WASD / Arrow Keys:** Moving
* **Shift button:** Sprinting
* **Cursor Movement:** Aiming
* **Space:** Shooting

### - Controls on Mobile/Tablet/Phablet:
* **Left Joystick (gray one):** Moving
*  **Right Joystick (red one):** Shooting and Aiming
* **Run button:** Sprinting 

---

## How to Run Locally:

## Prerequisites: 
* Node.js (v14 or higher recommended)

* npm (comes bundled with Node.js)

### Step 1: Clone the repo:
```bash
git clone https://github.com/Sunbul-K/Spectrebolt-Arena.git
cd Spectrebolt-Arena
```
### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Run:

#### If you want to play:
```bash
node start
# Open localhost:10000
```

#### If your a dev:
```bash
npm run dev
```

## License
This project is licensed under the **GNU GPLv3** - see the **[LICENSE](LICENSE)** file for details.

## Author
**- Saif Kayyali**