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
                            const time = parseFloat(timeInput.replace(',', '.'));
                            const result = document.getElementById('rank-result');
                            const bar = document.getElementById('progress-bar');
                            const cont = document.getElementById('progress-container');

                            if (isNaN(time) || time <= 0) {
                                result.innerHTML = "Введите время";
                                return;
                            }

                            let rank = "Любитель";
                            let percent = 20;
                            let color = "#dc3545";

                            if (time <= 24.0) { rank = "МС"; percent = 100; color = "#28a745"; }
                            else if (time <= 25.5) { rank = "КМС"; percent = 85; color = "#007bff"; }
                            else if (time <= 27.5) { rank = "1 разряд"; percent = 65; color = "#17a2b8"; }
                            else if (time <= 30.5) { rank = "2 разряд"; percent = 45; color = "#ffc107"; }

                            cont.style.display = 'block';
                            bar.style.width = percent + '%';
                            bar.style.backgroundColor = color;
                            result.innerHTML = "Ваш разряд: <b>" + rank + "</b>";
                        }
                    </script></head>
                    <body>${navHTML}
                        <div class="container" style="max-width: 1100px;">
                            <div class="box">
                                <h2>Новый рекорд</h2>
                                <form action="/add-record" method="POST">
                                    <input type="hidden" name="user_id" value="${user.id}">
                                    <select name="style" class="form-select"><option>Кроль</option><option>Брасс</option></select>
                                    <input type="text" name="time" placeholder="26.50">
                                    <button type="submit">Добавить</button>
                                </form>
                            </div>
                            <div style="flex:2;">
                                <div class="box" style="width:auto; margin-bottom:20px;">
                                    <h2>Мои рекорды</h2>
                                    <table class="records-table"><tr><th>Стиль</th><th>Дистанция</th><th>Бассейн</th><th>Время</th></tr>${recordsHTML}</table>
                                </div>
                                <div class="box" style="width:auto; background:#eef7ff;">
                                    <h2>Калькулятор</h2>
                                    <input type="text" id="calc-time" placeholder="Время на 50м">
                                    <button onclick="calcRank()">Узнать разряд</button>
                                    <div id="progress-container" style="background:#ddd; height:20px; border-radius:10px; margin-top:15px; display:none; overflow:hidden;">
                                        <div id="progress-bar" style="width:0%; height:100%; transition:width 0.5s; background:#007bff;"></div>
                                    </div>
                                    <p id="rank-result" style="margin-top:10px;"></p>
                                </div>
                            </div>
                        </div>
                    </body></html>`);
            });
        }
    });
});

app.listen(3000, () => console.log('OK: http://localhost:3000'));