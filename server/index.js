const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Rotas da API para aceitar e recusar mensagens
app.post('/api/requests/accept', (req, res) => {
    db.acceptRequest(req.body.chatId);
    res.json({ success: true, message: 'Conversa aceita' });
});

app.post('/api/requests/reject', (req, res) => {
    db.rejectRequest(req.body.chatId);
    res.json({ success: true, message: 'Conversa recusada' });
});

// Lógica de tempo real
io.on('connection', (socket) => {
    console.log('Novo usuário conectado:', socket.id);
    
    // Registra o nome de usuário do cliente em uma "sala" própria
    socket.on('register', (username) => {
        socket.join(username);
        console.log(`Usuário registrado: ${username}`);
    });

    // Recebe mensagem do frontend
    socket.on('send_message', (data) => {
        const { sender, receiver, text } = data;
        
        // Salva no banco e verifica o status
        const chat = db.addMessage(sender, receiver, text);
        const chatId = db.getChatId(sender, receiver);

        if (chat.status === 'pending' && chat.initiator !== receiver) {
            // Se for pendente, emite para a aba de Solicitações do recebedor
            io.to(receiver).emit('new_request', { sender, text, chatId });
        } else {
            // Se já foi aceito, emite para a aba de Conversas normais
            io.to(receiver).emit('new_message', { sender, text, chatId });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
