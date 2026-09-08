const socket = io();
let currentUser = '';

const app = {
    login: () => {
        currentUser = document.getElementById('myUsername').value;
        if (!currentUser) return alert('Digite um nome!');
        
        socket.emit('register', currentUser);
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('chat-app').style.display = 'block';
    },
    sendMessage: () => {
        const receiver = document.getElementById('receiver').value;
        const text = document.getElementById('msgText').value;
        
        if (!receiver || !text) return;
        
        socket.emit('send_message', { sender: currentUser, receiver, text });
        ui.addMessage('Você', text);
        document.getElementById('msgText').value = '';
    },
    accept: async (chatId, sender, text) => {
        await api.acceptRequest(chatId);
        ui.removeRequest(chatId);
        ui.addMessage(sender, text);
        ui.showTab('conversas');
        alert('Conversa aceita! Você já pode responder.');
    },
    reject: async (chatId) => {
        await api.rejectRequest(chatId);
        ui.removeRequest(chatId);
    }
};

// Listeners do Socket.io
socket.on('new_request', (data) => {
    ui.addRequest(data);
});

socket.on('new_message', (data) => {
    ui.addMessage(data.sender, data.text);
});
