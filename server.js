const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// SQLite Datenbank initialisieren
const db = new sqlite3.Database('bank.db');

db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        pin TEXT NOT NULL,
        balance REAL DEFAULT 0,
        contract TEXT DEFAULT 'none',
        created_at TIMESTAMP
    )
`);

db.run(`
    CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY,
        pin TEXT NOT NULL,
        rate1 REAL DEFAULT 0.03,
        rate2 REAL DEFAULT 0.15
    )
`);

// Admin initialisieren
db.get('SELECT * FROM admin', (err, row) => {
    if (!row) {
        db.run('INSERT INTO admin (pin, rate1, rate2) VALUES (?, ?, ?)', 
            ['506715', 0.03, 0.15]);
    }
});

// REGISTRIERUNG
app.post('/api/register', (req, res) => {
    const { username, pin } = req.body;
    
    if (!username || !pin || pin.length < 4) {
        return res.status(400).json({ error: 'Ungültige Eingaben' });
    }
    
    db.run(
        'INSERT INTO users (username, pin, balance, created_at) VALUES (?, ?, ?, datetime("now"))',
        [username, pin, 10.0],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Nutzer existiert bereits!' });
            }
            res.json({ success: true, userId: this.lastID });
        }
    );
});

// LOGIN
app.post('/api/login', (req, res) => {
    const { username, pin } = req.body;
    
    // Admin-Login
    db.get('SELECT pin FROM admin LIMIT 1', (err, admin) => {
        if (admin && pin === admin.pin) {
            return res.json({ success: true, role: 'admin' });
        }
        
        // Nutzer-Login
        db.get(
            'SELECT id, username, balance, contract FROM users WHERE username = ? AND pin = ?',
            [username, pin],
            (err, user) => {
                if (user) {
                    res.json({ success: true, role: 'user', user });
                } else {
                    res.status(401).json({ error: 'Anmeldedaten falsch!' });
                }
            }
        );
    });
});

// KONTOSTAND ABRUFEN
app.get('/api/user/:id', (req, res) => {
    db.get(
        'SELECT id, username, balance, contract FROM users WHERE id = ?',
        [req.params.id],
        (err, user) => {
            if (user) res.json(user);
            else res.status(404).json({ error: 'Nutzer nicht gefunden' });
        }
    );
});

// EINZAHLUNG / KREDIT
app.post('/api/deposit', (req, res) => {
    const { userId, amount } = req.body;
    
    db.run(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [amount, userId],
        function(err) {
            if (err) return res.status(400).json({ error: 'Fehler' });
            res.json({ success: true });
        }
    );
});

// ÜBERWEISUNG
app.post('/api/transfer', (req, res) => {
    const { senderId, recipientUsername, amount } = req.body;
    
    db.get('SELECT id, balance FROM users WHERE id = ?', [senderId], (err, sender) => {
        if (!sender || sender.balance < amount) {
            return res.status(400).json({ error: 'Unzureichende Deckung!' });
        }
        
        db.get('SELECT id FROM users WHERE username = ?', [recipientUsername], (err, recipient) => {
            if (!recipient) {
                return res.status(404).json({ error: 'Empfänger nicht gefunden!' });
            }
            
            db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, senderId], () => {
                db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, recipient.id], () => {
                    res.json({ success: true });
                });
            });
        });
    });
});

// ZINSEN GUTSCHREIBEN
app.post('/api/interest', (req, res) => {
    const { userId } = req.body;
    
    db.get('SELECT balance, contract FROM users WHERE id = ?', [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
        
        db.get('SELECT rate1, rate2 FROM admin LIMIT 1', (err, rates) => {
            let interest = 0;
            
            if (user.balance > 0 && user.balance <= 5) interest = rates.rate1;
            else if (user.balance > 5 && user.balance <= 100) interest = rates.rate2;
            else if (user.balance > 100 && user.contract === 'approved') interest = 0.50;
            else if (user.balance > 100) {
                return res.status(400).json({ error: 'Kein Sondervertrag vorhanden!' });
            }
            
            db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [interest, userId], () => {
                res.json({ success: true, interest: interest.toFixed(2) });
            });
        });
    });
});

// ADMIN: ZINSEN ÄNDERN
app.post('/api/admin/rates', (req, res) => {
    const { adminPin, rate1, rate2 } = req.body;
    
    db.get('SELECT pin FROM admin LIMIT 1', (err, admin) => {
        if (adminPin !== admin.pin) {
            return res.status(401).json({ error: 'Admin-PIN falsch!' });
        }
        
        db.run('UPDATE admin SET rate1 = ?, rate2 = ? WHERE id = 1', [rate1, rate2], () => {
            res.json({ success: true });
        });
    });
});

// ADMIN: SONDERVERTRÄGE ANZEIGEN
app.get('/api/admin/contracts', (req, res) => {
    db.all(
        'SELECT id, username, balance FROM users WHERE balance > 100 AND contract = "none"',
        (err, users) => {
            res.json(users || []);
        }
    );
});

// ADMIN: VERTRAG GENEHMIGEN
app.post('/api/admin/approve', (req, res) => {
    const { userId } = req.body;
    
    db.run('UPDATE users SET contract = "approved" WHERE id = ?', [userId], () => {
        res.json({ success: true });
    });
});

app.listen(3000, () => console.log('Server läuft auf http://localhost:3000'));
