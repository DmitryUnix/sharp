const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./database.db');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(__dirname));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE, password TEXT, role TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, style TEXT, distance INTEGER, pool_type INTEGER, time TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);
    db.get("SELECT * FROM users WHERE login = 'admin'", (err, row) => {
        if (!row) db.run("INSERT INTO users (login, password, role) VALUES ('admin', 'admin', 'admin')");
    });
});

app.post('/edit-user', (req, res) => {
    const { id, newLogin } = req.body;
    db.run(`UPDATE users SET login = ? WHERE id = ?`, [newLogin, id], (err) => {
        if (err) return res.status(500).send("Логин занят");
        res.send("OK");
    });
});

app.post('/delete-user', (req, res) => {
    const { id } = req.body;
    db.run(`DELETE FROM users WHERE id = ?`, [id], () => {
        db.run(`DELETE FROM records WHERE user_id = ?`, [id]);
        res.send("OK");
    });
});

app.post('/register', (req, res) => {
    const { login, password } = req.body;
    if (login.toLowerCase() === 'admin') return res.send("<h1>Ошибка</h1><a href='/'>Назад</a>");
    db.run(`INSERT INTO users (login, password, role) VALUES (?, ?, 'user')`, [login, password], (err) => {
        if (err) return res.send("<h1>Логин занят</h1><a href='/'>Назад</a>");
        res.send("<h1>Успех!</h1><a href='/'>Войти</a>");
    });
});

app.post('/add-record', (req, res) => {
    const { user_id, style, distance, pool_type, time } = req.body;
    db.run(`INSERT INTO records (user_id, style, distance, pool_type, time) VALUES (?, ?, ?, ?, ?)`, [user_id, style, distance, pool_type, time], () => {
        res.redirect(307, '/login');
    });
});

app.post('/login', (req, res) => {
    const { login, password } = req.body;
    db.get(`SELECT * FROM users WHERE login = ? AND password = ?`, [login, password], (err, user) => {
        if (err || !user) return res.send("<h1>Ошибка</h1><p>Неверные данные.</p><a href='/'>Назад</a>");

        const navHTML = `
            <nav class="navbar">
                <a href="/" class="nav-logo">SwimTrack</a>
                <div class="nav-links"><span style="color:white;">Привет, ${user.login}!</span></div>
                <a href="/" class="logout-btn">Выйти</a>
            </nav>`;

        if (user.role === 'admin') {
            db.all(`SELECT id, login, role FROM users`, [], (err, rows) => {
                let userListHTML = rows.map(u => `
                    <div class="user-card" id="user-row-${u.id}" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div id="display-${u.id}"><span>ID: ${u.id} | <b id="login-text-${u.id}">${u.login}</b></span></div>
                        <div>
                            ${u.role !== 'admin' ? `
                                <button onclick="editUser(${u.id})" style="background:#ffc107; color:black; width:auto; padding:5px 10px;">Изменить</button>
                                <button onclick="confirmDelete(${u.id}, '${u.login}')" class="btn-delete" style="width:auto; padding:5px 10px; background:#dc3545;">Удалить</button>
                            ` : '<i>Admin</i>'}
                        </div>
                    </div>`).join('');

                res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="main.css"><title>Админка</title>
                    <script>
                        async function confirmDelete(id, login) {
                            if (confirm("Удалить " + login + "?")) {
                                await fetch('/delete-user', { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'id='+id });
                                document.getElementById('user-row-'+id).remove();
                            }
                        }
                        function editUser(id) {
                            const current = document.getElementById('login-text-'+id).innerText;
                            document.getElementById('display-'+id).innerHTML = '<input type="text" id="input-'+id+'" value="'+current+'" style="width:150px; margin:0;"><button onclick="saveUser('+id+')" style="background:#28a745; width:auto; margin-left:5px;">OK</button>';
                        }
                        async function saveUser(id) {
                            const val = document.getElementById('input-'+id).value;
                            const res = await fetch('/edit-user', { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'id='+id+'&newLogin='+val });
                            if (res.ok) location.reload();
                        }
                    </script></head>
                    <body>${navHTML}<div class="container"><div class="admin-panel" style="width:700px;"><h2>Управление пловцами</h2>${userListHTML}</div></div></body></html>`);
            });
        } else {
            db.all(`SELECT * FROM records WHERE user_id = ?`, [user.id], (err, records) => {
                let recordsHTML = records.map(r => `<tr><td>${r.style}</td><td>${r.distance}м</td><td>${r.pool_type}м</td><td><b>${r.time}</b></td></tr>`).join('');
                res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="main.css"><title>Кабинет</title>
                    <script>
                        function calcRank() {
                            const timeInput = document.getElementById('calc-time').value;
                            const distance = document.getElementById('calc-distance').value;
                            const style = document.getElementById('calc-style').value;
                            const result = document.getElementById('rank-result');
                            const bar = document.getElementById('progress-bar');
                            const cont = document.getElementById('progress-container');

                            // Проверка формата времени
                            const timePattern = /^\\d{1,2}:\\d{2}\\.\\d{2}$/;
                            if (!timePattern.test(timeInput)) {
                                result.innerHTML = "Введите время в формате ММ:СС.сс (например 00:26.50)";
                                return;
                            }

                            const timeParts = timeInput.split(':');
                            const minutes = parseInt(timeParts[0]);
                            const secParts = timeParts[1].split('.');
                            const seconds = parseInt(secParts[0]);
                            const centiseconds = parseInt(secParts[1]);
                            
                            const totalTime = minutes * 60 + seconds + centiseconds / 100;

                            if (isNaN(totalTime) || totalTime <= 0) {
                                result.innerHTML = "Введите корректное время";
                                return;
                            }

                            // Нормативы для 50м кроль (бассейн 50м)
                            let rank = "Любитель";
                            let percent = 20;
                            let color = "#dc3545";

                            if (distance == 50) {
                                if (totalTime <= 24.0) { rank = "МС"; percent = 100; color = "#28a745"; }
                                else if (totalTime <= 25.5) { rank = "КМС"; percent = 85; color = "#007bff"; }
                                else if (totalTime <= 27.5) { rank = "I разряд"; percent = 65; color = "#17a2b8"; }
                                else if (totalTime <= 30.5) { rank = "II разряд"; percent = 45; color = "#ffc107"; }
                            } else if (distance == 100) {
                                if (totalTime <= 52.0) { rank = "МС"; percent = 100; color = "#28a745"; }
                                else if (totalTime <= 56.0) { rank = "КМС"; percent = 85; color = "#007bff"; }
                                else if (totalTime <= 62.0) { rank = "I разряд"; percent = 65; color = "#17a2b8"; }
                                else if (totalTime <= 68.0) { rank = "II разряд"; percent = 45; color = "#ffc107"; }
                            } else if (distance == 200) {
                                if (totalTime <= 110.0) { rank = "МС"; percent = 100; color = "#28a745"; }
                                else if (totalTime <= 120.0) { rank = "КМС"; percent = 85; color = "#007bff"; }
                                else if (totalTime <= 135.0) { rank = "I разряд"; percent = 65; color = "#17a2b8"; }
                                else if (totalTime <= 150.0) { rank = "II разряд"; percent = 45; color = "#ffc107"; }
                            } else if (distance == 400) {
                                if (totalTime <= 235.0) { rank = "МС"; percent = 100; color = "#28a745"; }
                                else if (totalTime <= 260.0) { rank = "КМС"; percent = 85; color = "#007bff"; }
                                else if (totalTime <= 290.0) { rank = "I разряд"; percent = 65; color = "#17a2b8"; }
                                else if (totalTime <= 320.0) { rank = "II разряд"; percent = 45; color = "#ffc107"; }
                            } else if (distance == 800) {
                                if (totalTime <= 490.0) { rank = "МС"; percent = 100; color = "#28a745"; }
                                else if (totalTime <= 540.0) { rank = "КМС"; percent = 85; color = "#007bff"; }
                                else if (totalTime <= 600.0) { rank = "I разряд"; percent = 65; color = "#17a2b8"; }
                                else if (totalTime <= 660.0) { rank = "II разряд"; percent = 45; color = "#ffc107"; }
                            } else if (distance == 1500) {
                                if (totalTime <= 940.0) { rank = "МС"; percent = 100; color = "#28a745"; }
                                else if (totalTime <= 1020.0) { rank = "КМС"; percent = 85; color = "#007bff"; }
                                else if (totalTime <= 1140.0) { rank = "I разряд"; percent = 65; color = "#17a2b8"; }
                                else if (totalTime <= 1260.0) { rank = "II разряд"; percent = 45; color = "#ffc107"; }
                            }

                            cont.style.display = 'block';
                            bar.style.width = percent + '%';
                            bar.style.backgroundColor = color;
                            result.innerHTML = "Ваш разряд: <b>" + rank + "</b>";
                        }

                        function updateTimePlaceholder() {
                            const input = document.getElementById('calc-time');
                            input.value = '';
                        }
                    </script></head>
                    <body>${navHTML}
                        <div class="container" style="max-width: 1100px;">
                            <div class="box">
                                <h2>Новый рекорд</h2>
                                <form action="/add-record" method="POST">
                                    <input type="hidden" name="user_id" value="${user.id}">
                                    <label for="style"><b>Стиль:</b></label>
                                    <select name="style" id="style" class="form-select" onchange="updateDistanceOptions()">
                                        <option value="Кроль">Кроль (Вольный стиль)</option>
                                        <option value="На спине">На спине</option>
                                        <option value="Брасс">Брасс</option>
                                        <option value="Баттерфляй">Баттерфляй (Дельфин)</option>
                                    </select>
                                    
                                    <label for="distance"><b>Дистанция (м):</b></label>
                                    <select name="distance" id="distance" class="form-select">
                                        <option value="50">50 м</option>
                                        <option value="100">100 м</option>
                                        <option value="200">200 м</option>
                                        <option value="400">400 м</option>
                                        <option value="800">800 м</option>
                                        <option value="1500">1500 м</option>
                                    </select>
                                    
                                    <label for="pool_type"><b>Тип бассейна:</b></label>
                                    <select name="pool_type" id="pool_type" class="form-select">
                                        <option value="25">Короткая вода (25 м)</option>
                                        <option value="50">Длинная вода (50 м)</option>
                                    </select>
                                    
                                    <label for="time"><b>Время (формат ММ:СС.сс):</b></label>
                                    <input type="text" name="time" id="time" placeholder="00:00.00" maxlength="8" required pattern="\\d{1,2}:\\d{2}\\.\\d{2}" title="Формат: ММ:СС.сс (например 00:26.50)">
                                    <button type="submit">Добавить</button>
                                </form>
                            </div>
                            <div style="flex:2;">
                                <div class="box" style="width:auto; margin-bottom:20px;">
                                    <h2>Мои рекорды</h2>
                                    <table class="records-table"><tr><th>Стиль</th><th>Дистанция</th><th>Бассейн</th><th>Время</th></tr>${recordsHTML}</table>
                                </div>
                                <div class="box" style="width:auto; background:#eef7ff;">
                                    <h2>Калькулятор разряда</h2>
                                    <p style="font-size:13px; color:#666; margin-top:0;">Выберите дистанцию и стиль, затем введите ваше время в формате ММ:СС.сс</p>
                                    
                                    <label for="calc-distance"><b>Дистанция (м):</b></label>
                                    <select id="calc-distance" class="form-select">
                                        <option value="50">50 м</option>
                                        <option value="100">100 м</option>
                                        <option value="200">200 м</option>
                                        <option value="400">400 м</option>
                                        <option value="800">800 м</option>
                                        <option value="1500">1500 м</option>
                                    </select>
                                    
                                    <label for="calc-style"><b>Стиль:</b></label>
                                    <select id="calc-style" class="form-select">
                                        <option value="Кроль">Кроль (Вольный стиль)</option>
                                    </select>
                                    
                                    <label for="calc-time"><b>Время (ММ:СС.сс):</b></label>
                                    <input type="text" id="calc-time" placeholder="00:00.00" maxlength="8" onfocus="this.setAttribute('placeholder', '')" onblur="this.setAttribute('placeholder', '00:00.00')">
                                    <button onclick="calcRank()">Узнать разряд</button>
                                    <div id="progress-container" style="background:#ddd; height:20px; border-radius:10px; margin-top:15px; display:none; overflow:hidden;">
                                        <div id="progress-bar" style="width:0%; height:100%; transition:width 0.5s; background:#007bff;"></div>
                                    </div>
                                    <p id="rank-result" style="margin-top:10px;"></p>
                                </div>
                            </div>
                        </div>
                        <script>
                            function updateDistanceOptions() {
                                const style = document.getElementById('style').value;
                                const distanceSelect = document.getElementById('distance');
                                const currentDistance = distanceSelect.value;
                                
                                let options = [];
                                if (style === 'Кроль') {
                                    options = [50, 100, 200, 400, 800, 1500];
                                } else if (style === 'На спине' || style === 'Брасс' || style === 'Баттерфляй') {
                                    options = [50, 100, 200];
                                }
                                
                                distanceSelect.innerHTML = '';
                                options.forEach(d => {
                                    const opt = document.createElement('option');
                                    opt.value = d;
                                    opt.textContent = d + ' м';
                                    if (d == currentDistance) opt.selected = true;
                                    distanceSelect.appendChild(opt);
                                });
                            }
                        </script>
                    </body></html>`);
            });
        }
    });
});

app.listen(3000, () => console.log('OK: http://localhost:3000'));