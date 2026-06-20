const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Track all rooms and their data
let rooms = {};
const questions = [
    { q: "What is the capital of France?", c: ["London", "Paris", "Rome", "Berlin"], a: "2" },
    { q: "Which planet is known as the Red Planet?", c: ["Earth", "Mars", "Jupiter", "Venus"], a: "2" },
    { q: "How many legs does a spider have?", c: ["6", "8", "10", "12"], a: "2" },
    { q: "What is the boiling point of water?", c: ["50°C", "100°C", "150°C", "200°C"], a: "2" },
    { q: "Which ocean is the largest on Earth?", c: ["Atlantic", "Indian", "Arctic", "Pacific"], a: "4" },
    { q: "What is the closest star to Earth?", c: ["The Sun", "Proxima Centauri", "Sirius", "North Star"], a: "1" },
    { q: "How many continents are there?", c: ["5", "6", "7", "8"], a: "3" },
    { q: "What is the hardest natural substance?", c: ["Gold", "Iron", "Diamond", "Ruby"], a: "3" },
    { q: "Who painted the Mona Lisa?", c: ["Van Gogh", "Da Vinci", "Picasso", "Monet"], a: "2" },
    { q: "What is the square root of 64?", c: ["6", "7", "8", "9"], a: "3" },
    { q: "What is the number of pi?", c: ["3", "1.96", "3.14", "6.357"], a: "3" },
    { q: "What is most practical for suvival?", c: ["Water", "Shelter", "Warmth", "Friends"], a: "1" }
];

io.on('connection', (socket) => {

    // 🔑 CREATE ROOM (Called by host.html)
    socket.on('createRoom', () => {
        let roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = {
            hostId: socket.id,
            players: {},
            roundActive: false,
            gameTimer: null,
            timeLeft: 300
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    // 🚪 JOIN ROOM (Called by index.html)
    socket.on('joinQuiz', (data) => {
        let roomCode = data.roomCode ? data.roomCode.toUpperCase() : '';
        let name = data.name;

        if (rooms[roomCode]) {
            socket.join(roomCode);
            // Save room code on this specific socket so we find it on disconnect
            socket.roomCode = roomCode; 
            
            rooms[roomCode].players[socket.id] = { id: socket.id, name: name, coins: 100 };
            
            socket.emit('joinSuccess', roomCode);
            io.to(roomCode).emit('updatePlayers', Object.values(rooms[roomCode].players));
        } else {
            socket.emit('joinError', 'Room not found! Check your code.');
        }
    });

    // ⏱️ START GAME (Called by host.html)
    socket.on('startRoundClock', () => {
        // Find which room this host owns
        let roomCode = Object.keys(rooms).find(code => rooms[code].hostId === socket.id);
        if (!roomCode) return;
        
        let room = rooms[roomCode];
        if (room.roundActive) return;
        
        room.roundActive = true;
        room.timeLeft = 300; 
        
        io.to(roomCode).emit('gameStarted');
        io.to(roomCode).emit('timerUpdate', room.timeLeft);
        
        Object.keys(room.players).forEach(id => {
            sendNewQuestionToPlayer(id, roomCode);
        });

        clearInterval(room.gameTimer);
        room.gameTimer = setInterval(() => {
            room.timeLeft--;
            io.to(roomCode).emit('timerUpdate', room.timeLeft);

            if (room.timeLeft <= 0) {
                clearInterval(room.gameTimer);
                triggerGameEnd(roomCode);
            }
        }, 1000);
    });

    socket.on('requestNextQuestion', () => {
        let roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode] && rooms[roomCode].roundActive) {
            sendNewQuestionToPlayer(socket.id, roomCode);
        }
    });

    socket.on('submitAnswer', (data) => {
        let roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode] || !rooms[roomCode].roundActive) return;
        
        let room = rooms[roomCode];
        let player = room.players[socket.id];
        if (!player) return;

        if (data.guess === data.correctIndex) {
            let roll = Math.floor(Math.random() * 4);
            let outcome = {};

            if (roll === 0) {
                let cash = Math.floor(Math.random() * 50) + 20;
                player.coins += cash;
                outcome = { type: "coins", display: `🪙 +${cash} Coins`, msg: `Plus +🪙 ${cash} Coins!` };
            } else if (roll === 1) {
                let leader = Object.values(room.players).reduce((max, p) => p.coins > max.coins ? p : max, {coins: 0});
                if (leader && leader.id !== socket.id && leader.coins > 20) {
                    let stolen = Math.floor(leader.coins * 0.25);
                    leader.coins -= stolen;
                    player.coins += stolen;
                    outcome = { type: "steal", display: "🚨 25% STEAL", msg: `🚨 25% STEAL! You took 🪙 ${stolen} from ${leader.name}!` };
                } else {
                    player.coins += 30;
                    outcome = { type: "coins", display: "🪙 +30 Coins", msg: `No one to steal from! Gained +🪙 30 Coins!` };
                }
            } else if (roll === 2) {
                let pool = Object.values(room.players).filter(p => p.id !== socket.id);
                if (pool.length > 0) {
                    let victim = pool[Math.floor(Math.random() * pool.length)];
                    let temp = player.coins;
                    player.coins = victim.coins;
                    victim.coins = temp;
                    outcome = { type: "swap", display: "🔄 COIN SWAP", msg: `🔄 SWAPPED! You traded banks with ${victim.name}!` };
                } else {
                    player.coins += 40;
                    outcome = { type: "coins", display: "🪙 +40 Coins", msg: `No one to swap with! Gained +🪙 40 Coins!` };
                }
            } else {
                player.coins *= 3;
                outcome = { type: "triple", display: "💥 TRIPLE!!!", msg: `💥 TRIPLE COINS JACKPOT!!!` };
            }

            socket.emit('coinResult', { success: true, reward: outcome });
            io.to(roomCode).emit('updatePlayers', Object.values(room.players));
        } else {
            socket.emit('coinResult', { success: false, msg: "❌ WRONG ANSWER!" });
        }
    });

    socket.on('endGame', () => {
        let roomCode = Object.keys(rooms).find(code => rooms[code].hostId === socket.id);
        if (roomCode) triggerGameEnd(roomCode);
    });

    socket.on('disconnect', () => {
        // If a host left, delete the room
        let hostedRoomCode = Object.keys(rooms).find(code => rooms[code].hostId === socket.id);
        if (hostedRoomCode) {
            clearInterval(rooms[hostedRoomCode].gameTimer);
            delete rooms[hostedRoomCode];
            return;
        }

        // If a player left, remove them from their room
        let roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            delete rooms[roomCode].players[socket.id];
            io.to(roomCode).emit('updatePlayers', Object.values(rooms[roomCode].players));
        }
    });
});

function sendNewQuestionToPlayer(socketId, roomCode) {
    let randIndex = Math.floor(Math.random() * questions.length);
    let qData = questions[randIndex];
    io.to(socketId).emit('nextQuestion', { q: qData.q, choices: qData.c, correct: qData.a });
}

function triggerGameEnd(roomCode) {
    let room = rooms[roomCode];
    if (!room) return;
    room.roundActive = false;
    clearInterval(room.gameTimer);
    let playerArray = Object.values(room.players).sort((a, b) => b.coins - a.coins);
    io.to(roomCode).emit('gameOver', playerArray);
}

// Port updated to 8000 for Koyeb compatibility
const PORT = process.env.PORT || 8000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Blooket Ultimate Server Active on port ${PORT}!`);
});
