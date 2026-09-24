GROK LAND
=========
A bright, chunky low-poly 3D platformer with puzzles, enemies, coins and
hidden stars. It runs from pure static files and needs no build step and no CDN.

HOW TO RUN
----------
  cd grok-platformer
  python3 -m http.server 8000
  then open http://localhost:8000/ in a browser

All paths are relative, so the folder works as-is on GitHub Pages or any
static host. Opening index.html directly from disk also usually works.

FILES
-----
  index.html     page, HUD, menus, touch controls
  style.css      UI styling (safe-area aware, mobile layouts)
  game.js        the whole game (levels, physics, enemies, puzzles, audio)
  three.min.js   vendored three.js r128
  README.txt     this file

CONTROLS - DESKTOP
------------------
  Move ............... WASD / Arrow keys
  Jump ............... Space (also J or Z). Hold for a higher jump;
                       press again in mid-air to DOUBLE JUMP
  Action ............. Shift (also X, F or K)
                         - standing still : SPIN ATTACK (defeats walkers/bees)
                         - while running  : LONG JUMP
                         - in the air     : GROUND POUND
  Push blocks ........ just walk into a crate
  Camera ............. Q / E to rotate, or drag with the mouse; wheel zooms
  Pause .............. Esc or P
  Mute ............... M
  Menus .............. click, or press Enter

CONTROLS - MOBILE / TOUCH (auto-detected)
------------------------------------------
  Left side of screen .... virtual joystick (appears where you touch)
  JUMP button ............ jump / double jump (hold for a higher jump)
  ACTION button .......... spin / long jump / ground pound
  Drag on the right side . rotate the camera
  Pause button ........... top of the screen

RULES
-----
  - 3 hearts, 5 lives. Touching an enemy or hazard costs a heart.
  - Stomp walkers and bees by landing on them. Spiky enemies can't be stomped,
    so avoid them.
  - Falling in water or off the world costs a heart and returns you to the
    last checkpoint. Lava costs a heart and bounces you back to safe ground.
  - Checkpoint flags save your spot and refill your hearts.
  - Every 10 coins in a level heals a heart, and every 50 coins total gives an extra
    life. Green 1-UP mushrooms and ? blocks also hold goodies.
  - Each level hides 3 BIG STARS. Your best star count and cleared levels are
    saved in the browser (localStorage).
  - Out of lives means GAME OVER, and you can retry the world.
  - Reach the flag or goal star at the end of each level to clear it.

LEVELS
------
1. GROK MEADOWS (grassy hills)
   Puzzle A: push two crates onto two pressure switches to open the gate.
             A hedge forces a detour, and the blue pad resets the crates.
   Puzzle B: climb the floating block tower to get the KEY, which opens the
             cage holding a star.
   Enemies:  walkers (chase you), a spiky, a cannon turret.
   Also:     moving platform over the river, falling platforms, a spring to
             a sky island, a spinning log, ? blocks, checkpoints, goal flag.

2. SKY ISLANDS (floating islands)
   Puzzle A: red/blue switches toggle which colored blocks are solid. Swap
             them to build your path, and take a side trip for a star.
   Puzzle B: SIMON crystal. Step on the white pad, watch the color sequence,
             then step on the colored pads in the same order to raise a
             rainbow bridge. Get it wrong and it resets.
   Enemies:  walkers, spikies, bees (flying chasers), turret.
   Also:     firebar, moving platform, springs, falling clouds, a secret ledge,
             goal star.

3. LAVA CASTLE (lava and castle)
   Puzzle A: push a crate onto the switch to raise a bridge out of the lava.
   Puzzle B: grab the KEY from atop a firebar island to unlock the castle door.
   Enemies:  walkers, bees, turret, a crusher (thwomp) on a narrow bridge.
   Also:     firebars, falling platforms, moving platform, a long-jump star,
             a spring up the tower to the goal star.
   Tip: ride the crusher up for a secret star.

Everything in the game is procedural: models are built from three.js
primitives and all sound and music is synthesized with WebAudio, so there
are no external assets.
