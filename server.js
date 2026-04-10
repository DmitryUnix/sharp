const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const db = new sqlite3.Database('./database.db');

// Настройка приложения
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // Чтобы видел main.css и index.html
app.use(session({
    secret: 'swimtrack_secret_2026',
    resave: false,
    saveUninitialized: true
}));

// База данных
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE, password TEXT, role TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, style TEXT, distance INTEGER, pool_type TEXT, time TEXT)`);
    // Создаем админа по умолчанию
    db.get("SELECT * FROM users WHERE login = 'admin'", (err, row) => {
        if (!row) db.run("INSERT INTO users (login, password, role) VALUES ('admin', 'admin', 'admin')");
    });
});

// Вспомогательная функция парсинга времени (из "01:05.50" в секунды)
function parseTimeToSeconds(t) {
    if (!t.includes(':')) return parseFloat(t.replace(',', '.'));
    const parts = t.split(':');
    return parseInt(parts[0]) * 60 + parseFloat(parts[1].replace(',', '.'));
}

// Рендер страницы личного кабинета (Dashboard)
function renderDashboard(user, records, error = null) {
    const tableRows = records.map(r => `<tr><td>${r.style}</td><td>${r.distance}м</td><td>${r.pool_type}м</td><td><b>${r.time}</b></td></tr>`).join('');
    
    return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="main.css">
        <title>Кабинет SwimTrack</title>
        <script>
            const distData = {
                "Кроль": [50, 100, 200, 400, 800, 1500],
                "Брасс": [50, 100, 200],
                "На спине": [50, 100, 200],
                "Баттерфляй": [50, 100, 200]
            };

            function updateDists(sId, dId) {
                const s = document.getElementById(sId).value;
                const d = document.getElementById(dId);
                d.innerHTML = distData[s].map(n => '<option value="'+n+'">'+n+' м</option>').join('');
            }

            function calcRank() {
                const timeStr = document.getElementById('c-time').value;
                const dist = parseInt(document.getElementById('c-dist').value);
                const resDiv = document.getElementById('r-res');
                const bar = document.getElementById('p-bar');
                
                if (!timeStr || !timeStr.includes('.')) {
                    resDiv.innerHTML = "Введите время (напр. 27.50 или 01:05.00)";
                    return;
                }

                // Логика нормативов (Пример для 50м вольный стиль)
                let sec = 0;
                if(timeStr.includes(':')) {
                    let p = timeStr.split(':');
                    sec = parseInt(p[0])*60 + parseFloat(p[1]);
                } else { sec = parseFloat(timeStr); }

                let rank = "Любитель"; let pct = 15; let clr = "#dc3545";
                
                // Упрощенная таблица для примера (КМС/МС)
                if (dist === 50) {
                    if (sec <= 24.0) { rank="МС"; pct=100; clr="#28a745"; }
                    else if (sec <= 25.5) { rank="КМС"; pct=80; clr="#007bff"; }
                    else if (sec <= 27.5) { rank="1 разряд"; pct=60; clr="#17a2b8"; }
                    else if (sec <= 30.5) { rank="2 разряд"; pct=40; clr="#ffc107"; }
                } else {
                    rank = "Результат принят"; pct = 50; clr = "#6c757d";
                }

                document.getElementById('p-cont').style.display = 'block';
                bar.style.width = pct + '%';
                bar.style.backgroundColor = clr;
                resDiv.innerHTML = "Ваш уровень: <b>" + rank + "</b>";
            }

            window.onload = () => { 
                updateDists('s-sel', 'd-sel'); 
                updateDists('c-style', 'c-dist');
            };
        </script>
    </head>
    <body>
        <nav class="navbar">
            <a href="/" class="nav-logo">SwimTrack</a>
            <div class="nav-links"><span style="color:white">Пловец: ${user.login}</span></div>
            <a href="/logout" class="logout-btn">Выйти</a>
        </nav>
        <div class="container" style="max-width:1100px;">
            <div class="box">
                <h2>Новый рекорд</h2>
                <form action="/add-record" method="POST">
                    <label>Стиль:</label>
                    <select name="style" id="s-sel" class="form-select" onchange="updateDists('s-sel', 'd-sel')">
                        <option>Кроль</option><option>Брасс</option><option>На спине</option><option>Баттерфляй</option>
                    </select>
                    <label>Дистанция:</label>
                    <select name="distance" id="d-sel" class="form-select"></select>
                    <label>Бассейн:</label>
                    <select name="pool_type" class="form-select">
                        <option value="25">Короткая вода (25м)</option>
                        <option value="50">Длинная вода (50м)</option>
                    </select>
                    <label>Время:</label>
                    <input type="text" name="time" placeholder="00:00.00" maxlength="8" required>
                    <button type="submit">Сохранить</button>
                </form>
            </div>

            <div style="flex:2;">
                <div class="box" style="width:auto; margin-bottom:20px;">
                    <h2>Мои рекорды</h2>
                    <table class="records-table">
                        <tr><th>Стиль</th><th>Дистанция</th><th>Вода</th><th>Время</th></tr>
                        ${tableRows}
                    </table>
                </div>
                <div class="box" style="width:auto; background:#eef7ff;">
                    <h2>Калькулятор разрядов (Вольный)</h2>
                    <select id="c-style" class="form-select" style="display:none;"><option>Кроль</option></select>
                    <label>Дистанция:</label>
                    <select id="c-dist" class="form-select"></select>
                    <label>Время:</label>
                    <input type="text" id="c-time" placeholder="00:25.50" maxlength="8">
                    <button onclick="calcRank()">Рассчитать</button>
                    <div id="p-cont" style="display:none; background:#ddd; height:20px; border-radius:10px; margin-top:15px; overflow:hidden;">
                        <div id="p-bar" style="width:0%; height:100%; transition:0.5s;"></div>
                    </div>
                    <p id="r-res" style="text-align:center; margin-top:10px;"></p>
                </div>
            </div>
        </div>
    </body></html>`;
}

// Маршруты
app.post('/register', (req, res) => {
    const { login, password } = req.body;
    db.run("INSERT INTO users (login, password, role) VALUES (?, ?, 'user')", [login, password], (err) => {
        if (err) return res.send("Ошибка: логин занят. <a href='/'>Назад</a>");
        res.send("Регистрация успешна! <a href='/'>Войти</a>");
    });
});

app.post('/login', (req, res) => {
    const { login, password } = req.body;
    db.get("SELECT * FROM users WHERE login = ? AND password = ?", [login, password], (err, user) => {
        if (!user) return res.send("Неверный вход. <a href='/'>Назад</a>");
        req.session.userId = user.id;
        db.all("SELECT * FROM records WHERE user_id = ?", [user.id], (err, records) => {
            res.send(renderDashboard(user, records));
        });
    });
});

app.post('/add-record', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const { style, distance, pool_type, time } = req.body;
    db.run("INSERT INTO records (user_id, style, distance, pool_type, time) VALUES (?, ?, ?, ?, ?)", 
        [req.session.userId, style, distance, pool_type, time], () => {
        res.redirect(307, '/login-auto'); // Технический редирект для обновления данных
    });
});

// Авто-логин после добавления записи
app.post('/login-auto', (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err, user) => {
        db.all("SELECT * FROM records WHERE user_id = ?", [user.id], (err, records) => {
            res.send(renderDashboard(user, records));
        });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(3000, () => console.log('Jarvis Online: http://localhost:3000'));