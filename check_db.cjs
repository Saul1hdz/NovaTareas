const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'novatareas.db'));

const users = db.prepare('SELECT id, username, telefono, telegram_chat_id FROM users').all();
console.log('Usuarios registrados:');
console.log(users);

db.close();