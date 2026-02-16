const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- НАСТРОЙКИ ---
let GAME_SPEED_SCALE = 1.0;
const ROAD_WIDTH = 400;
const CAR_SIZE = { width: 40, height: 70 };
const ZOMBIE_SIZE = { width: 30, height: 30 };
const ITEM_SIZE = { width: 25, height: 25 };

// Состояние игры
let score = 0;
let gameOver = false;
let frames = 0;

// Управление
const keys = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
const touch = { active: false, x: 0 };

// --- ФИЗИКА МАШИНЫ ---
const car = {
    x: 0,
    y: 0,
    width: CAR_SIZE.width,
    height: CAR_SIZE.height,
    speed: 0,
    maxSpeed: 12,
    angle: 0,
    friction: 0.95,
    acceleration: 0.5,
    turnSpeed: 0.08,
    driftFactor: 0.9, // 1 = нет дрифта, меньше = занос
    velocity: { x: 0, y: 0 },

    // Способность
    ability: null,
    abilityTimer: 0,

    update: function () {
        if (gameOver) return;

        // 1. Управление и ускорение
        // На мобильном авто-газ, если касаемся экрана - поворот
        let gas = keys.ArrowUp || touch.active;

        // Поворот
        let turning = 0;
        if (keys.ArrowLeft) turning = -1;
        if (keys.ArrowRight) turning = 1;

        if (touch.active) {
            // Если тач слева от машины - влево, справа - вправо
            if (touch.x < window.innerWidth / 2) turning = -1;
            else turning = 1;
            gas = true; // Автогаз при таче
        } else if (!keys.ArrowUp && !keys.ArrowDown) {
            // На ПК если кнопок нет, газ падает
            // Но для жанра "раннер" сделаем авто-газ слабым? 
            // Нет, пусть будет физика: надо жать газ или тапать
            gas = false;
            // АВТО-ГАЗ (опционально для раннера)
            gas = true;
        }

        if (gas) {
            this.speed += this.acceleration;
        } else {
            this.speed *= 0.98; // Затухание без газа
        }

        // Ограничение скорости (с учетом способностей)
        let currentMax = this.maxSpeed;
        if (this.ability === 'nitro') currentMax *= 1.8;
        if (this.ability === 'giant') currentMax *= 0.8;

        if (this.speed > currentMax) this.speed = currentMax;

        // 2. Вектор движения
        // Машина едет туда, куда повернута (angle), но с инерцией (velocity)

        if (turning && this.speed > 0.5) {
            this.angle += turning * this.turnSpeed * (this.speed / this.maxSpeed);
        }

        // Вектор направления колес
        const inputX = Math.sin(this.angle) * this.speed;
        const inputY = -Math.cos(this.angle) * this.speed; // Вверх по экрану это минус Y

        // Интерполяция вектора скорости к вектору колес (Drift)
        this.velocity.x = this.velocity.x * this.driftFactor + inputX * (1 - this.driftFactor);
        this.velocity.y = this.velocity.y * this.driftFactor + inputY * (1 - this.driftFactor);

        // Обновление позиции
        // Мы не двигаем машину вверх по экрану бесконечно, мы "движем мир" вниз.
        // Но x меняем реально.
        this.x += this.velocity.x;

        // Ограничение дорогой
        const roadHalf = ROAD_WIDTH / 2;
        if (this.x < -roadHalf + 30) { this.x = -roadHalf + 30; this.velocity.x *= -0.5; }
        if (this.x > roadHalf - 30) { this.x = roadHalf - 30; this.velocity.x *= -0.5; }

        // Возврат угла к центру если не рулим (стабилизация)
        if (turning === 0) {
            this.angle *= 0.9;
        }

        // Таймер способности
        if (this.ability) {
            this.abilityTimer--;
            if (this.abilityTimer <= 0) {
                deactivateAbility();
            }
        }
    },

    draw: function (ctx) {
        ctx.save();
        ctx.translate(windowsWidth / 2 + this.x, windowsHeight - 150);
        ctx.rotate(this.angle);

        // Тень
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(-this.width / 2 + 5, -this.height / 2 + 5, this.width, this.height);

        // Корпус
        ctx.fillStyle = this.ability === 'nitro' ? '#ffaa00' : '#d22';
        if (this.ability === 'giant') ctx.scale(2, 2);

        // Эффекты способностей
        if (this.ability === 'shield') {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, this.height / 1.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (this.ability === 'saw_blades') {
            ctx.fillStyle = '#ccc';
            // Пилы крутятся
            let sawAnim = (Date.now() / 50) % Math.PI;
            ctx.save(); ctx.translate(-this.width / 2, 0); ctx.rotate(sawAnim); ctx.fillRect(-10, -10, 20, 20); ctx.restore();
            ctx.save(); ctx.translate(this.width / 2, 0); ctx.rotate(-sawAnim); ctx.fillRect(-10, -10, 20, 20); ctx.restore();
            ctx.fillStyle = '#d22'; // Возврат цвета
        }

        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);

        // Фары/Стекло
        ctx.fillStyle = '#444';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 4, this.width - 4, 15); // Стекло
        ctx.fillStyle = '#ff0';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 2, 8, 5); // Фары
        ctx.fillRect(this.width / 2 - 10, -this.height / 2, 8, 5);

        ctx.restore();
    }
};

// --- МИР И ОБЪЕКТЫ ---
const zombies = [];
const items = [];
const particles = [];
const bullets = [];

let worldSpeed = 0; // Скорость движения мира вниз

function spawnZombie() {
    const x = (Math.random() - 0.5) * (ROAD_WIDTH - 60);
    zombies.push({
        x: x,
        y: -100, // Спавн сверху за экраном
        speed: 1 + Math.random() * 2,
        w: ZOMBIE_SIZE.width,
        h: ZOMBIE_SIZE.height,
        color: '#4a4',
        hp: 1,
        isFrozen: false // Добавлено для способности "Заморозка"
    });
}

const ABILITIES_LIST = [
    { id: 'nitro', name: 'NITRO', duration: 180, color: '#f80' },
    { id: 'shield', name: 'SHIELD', duration: 300, color: '#0ff' },
    { id: 'freeze', name: 'FREEZE', duration: 400, color: '#0bf' }, // Replaced Magnet
    { id: 'gun', name: 'M.GUN', duration: 250, color: '#666' },
    { id: 'giant', name: 'GIANT', duration: 300, color: '#a00' },
    { id: 'saws', name: 'SAWS', duration: 400, color: '#ccc' },
    { id: 'time', name: 'SLOW MO', duration: 200, color: '#00f' },
    { id: 'hover', name: 'HOVER', duration: 300, color: '#ff0' },
    { id: 'shock', name: 'SHOCKWAVE', duration: 10, color: '#fff' },
    { id: 'money', name: 'x3 POINTS', duration: 500, color: '#fd0' }
];

function spawnItem() {
    const x = (Math.random() - 0.5) * (ROAD_WIDTH - 80);
    const type = ABILITIES_LIST[Math.floor(Math.random() * ABILITIES_LIST.length)];
    items.push({
        x: x,
        y: -100,
        type: type,
        w: 30, h: 30
    });
}

function activateAbility(type) {
    // Сброс старой
    deactivateAbility();
    
    car.ability = type.id;
    car.abilityTimer = type.duration;
    
    document.getElementById('ability-indicator').innerText = "Способность: " + type.name;
    document.getElementById('ability-indicator').style.color = type.color;
    
    if (type.id === 'shock') {
        // Мгновенный эффект: всех зомби вокруг откинуть/убить
        zombies.forEach(z => {
            if (z.y > -200 && z.y < windowsHeight) {
                z.dead = true;
                createExplosion(z.x, z.y, '#0a0');
                score += 10;
            }
        });
        car.ability = null; // мгновенно заканчивается
    }
}

function deactivateAbility() {
    car.ability = null;
    document.getElementById('ability-indicator').innerText = "Способность: НЕТ";
    document.getElementById('ability-indicator').style.color = 'white';
}

function createExplosion(x, y, color) {
    for (let i = 0; i < 10; i++) {
        particles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 30,
            color: color
        });
    }
}

// --- ГЛАВНЫЙ ЦИКЛ ---

let windowsWidth = window.innerWidth;
let windowsHeight = window.innerHeight;

function resize() {
    windowsWidth = window.innerWidth;
    windowsHeight = window.innerHeight;
    canvas.width = windowsWidth;
    canvas.height = windowsHeight;
}
window.addEventListener('resize', resize);
resize();

function update() {
    if (gameOver) return;

    car.update();

    // Скорость мира зависит от вертикальной проекции скорости машины
    // velocity.y отрицательная когда едем вверх (вперед)
    let forwardSpeed = -car.velocity.y;
    if (car.ability === 'time') forwardSpeed *= 0.5; // Замедление мира

    // Двигаем "мир" навстречу машине
    // Генерация объектов
    if (Math.random() < 0.03) spawnZombie();
    if (Math.random() < 0.005) spawnItem();

    // Стрельба
    if (car.ability === 'gun' && frames % 10 === 0) {
        bullets.push({ x: car.x, y: windowsHeight - 150 - 40, vy: -15 });
    }

    // Обновление зомби
    for (let i = zombies.length - 1; i >= 0; i--) {
        let z = zombies[i];

        // Заморозка зомби
        if (car.ability === 'freeze') {
            z.isFrozen = true;
            z.color = '#0bf'; // Голубой цвет
        } else {
            z.isFrozen = false;
            z.color = '#4a4'; // Обычный цвет
        }

        // Если заморожен - не двигается сам, только вместе с миром
        let moveSpeed = z.isFrozen ? 0 : z.speed;
        z.y += forwardSpeed + (moveSpeed * (car.ability === 'time' ? 0.2 : 1));

        if (!z.isFrozen) z.x += (Math.random() - 0.5) * 2;

        // Коллизия с пулями
        bullets.forEach((b, bIdx) => {
            if (Math.abs(b.x - car.x - z.x) < 20 && Math.abs(b.y - z.y) < 20) { // упрощенная x (bullet x is relative to screen center? no, need world coords)
                // FIX: пули летят в координатах экрана по X? 
                // Давайте считать все объекты в "мировых X" (относительно центра дороги)
                // и "экранных Y".
            }
        });

        // Проверка столкновения с машиной
        // Машина всегда в центре по X (визуально камера следит), но физически x меняется.
        // Отрисовка: translate(center + car.x).
        // Значит зомби тоже должны быть в этой системе? 
        // Нет, делаем проще: x - это смещение от центра дороги.

        let hitboxScale = (car.ability === 'giant') ? 2 : 1;
        let killDist = 40 * hitboxScale;
        
        // Расстояние до машины (машина фиксирована по Y = windowsHeight - 150)
        let distY = Math.abs(z.y - (windowsHeight - 150));
        let distX = Math.abs(z.x - car.x);

        if (distY < 40 && distX < 30 * hitboxScale) {
            // УДАР
            let canKill = (car.speed > 3) ||
                car.ability === 'shield' ||
                car.ability === 'giant' ||
                car.ability === 'saws' ||
                z.isFrozen; // Замороженных можно бить всегда

            if (canKill) {
                z.dead = true;
                let splatColor = z.isFrozen ? '#cef' : '#a00'; // Лед или кровь
                createExplosion(car.x, windowsHeight - 150, splatColor);
                let points = 1;
                if (car.ability === 'money') points = 3;
                score += points;
            } else {
                // Если скорость маленькая или нет защиты - ДТП
                // GameOver
                gameOver = true;
                const goScreen = document.getElementById('game-over-screen');
                document.getElementById('final-score').innerText = "Score: " + score;
                goScreen.classList.remove('hidden');
                createExplosion(car.x, windowsHeight - 150, '#fff');
            }
        }

        if (z.y > windowsHeight + 50 || z.dead) {
            zombies.splice(i, 1);
        }
    }

    // Обновление предметов
    for (let i = items.length - 1; i >= 0; i--) {
        let item = items[i];
        item.y += forwardSpeed;

        // Магнитная логика удалена, так как способность заменена на "Заморозка"

        let distY = Math.abs(item.y - (windowsHeight - 150));
        let distX = Math.abs(item.x - car.x);

        if (distY < 40 && distX < 40) {
            activateAbility(item.type);
            items.splice(i, 1);
            continue;
        }

        if (item.y > windowsHeight + 50) {
            items.splice(i, 1);
        }
    }

    // Пули (от способностей)
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.y += b.vy;

        // Проверка попаданий
        for (let z of zombies) {
            if (Math.abs(b.x - z.x) < 20 && Math.abs(b.y - z.y) < 20) {
                z.dead = true;
                bullets.splice(i, 1);
                createExplosion(z.x, z.y, '#0f0');
                score += 1;
                break;
            }
        }
        if (b.y < -50) bullets.splice(i, 1);
    }

    // Частицы
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }

    frames++;
    document.getElementById('score').innerText = "Очки: " + score;
}

function draw() {
    // Фон (асфальт)
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, windowsWidth, windowsHeight);

    // Дорога
    ctx.save();
    ctx.translate(windowsWidth / 2, 0);

    ctx.fillStyle = '#444';
    ctx.fillRect(-ROAD_WIDTH / 2, 0, ROAD_WIDTH, windowsHeight);

    // Разметка (движется)
    // forwardSpeed simulation via offset
    // Просто используем frames для анимации полос
    let offset = (frames * (car.speed)) % 100;
    ctx.fillStyle = '#fff';
    for (let y = -100; y < windowsHeight + 100; y += 100) {
        ctx.fillRect(-5, y + offset, 10, 40);
    }

    // Отрисовка Z-buffer (простая сортировка не нужна, если зомби всегда ПОД машиной, а машина НАД пулями?)
    // Сначала items, потом zombies, потом car, потом bullets

    // Предметы
    items.forEach(item => {
        ctx.fillStyle = item.type.color;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '10px Arial';
        ctx.fillText("?", item.x - 3, item.y + 3);
    });

    // Зомби
    zombies.forEach(z => {
        ctx.fillStyle = z.color;
        ctx.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
        // Глаза
        ctx.fillStyle = '#f00';
        ctx.fillRect(z.x - 5, z.y - 10, 3, 3);
        ctx.fillRect(z.x + 2, z.y - 10, 3, 3);
    });

    // Пули
    ctx.fillStyle = '#ff0';
    bullets.forEach(b => {
        ctx.fillRect(b.x - 2, b.y - 5, 4, 10);
    });

    ctx.restore(); // Возвращаемся из координат дороги

    // Машина рисуется в своем контексте (у нее свой translate)
    car.draw(ctx);

    // Частицы (поверх всего в экранных координатах?? нет, они рождались в координатах дороги)
    // FIX: Particles need road transform too.
    ctx.save();
    ctx.translate(windowsWidth / 2, 0); // Road transform again
    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 30;
        ctx.fillRect(p.x, p.y, 4, 4);
    });
    ctx.restore();
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

// Event Listeners
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

window.addEventListener('touchstart', e => {
    touch.active = true;
    touch.x = e.touches[0].clientX;
});
window.addEventListener('touchmove', e => {
    touch.x = e.touches[0].clientX;
});
window.addEventListener('touchend', () => {
    touch.active = false;
});
// Mouse fallback for testing on PC
window.addEventListener('mousedown', e => {
    touch.active = true;
    touch.x = e.clientX;
});
window.addEventListener('mousemove', e => {
    if (touch.active) touch.x = e.clientX;
});
window.addEventListener('mouseup', () => {
    touch.active = false;
});

// Start
loop();
