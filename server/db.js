// Simulador de Banco de Dados (Adapte para o seu SQLite/MongoDB)
const users = new Set();
const conversations = {}; // armazena o status da conversa entre 2 usuários

function getChatId(u1, u2) {
    return [u1, u2].sort().join('-');
}

module.exports = {
    addMessage: (sender, receiver, text) => {
        const chatId = getChatId(sender, receiver);
        
        // Se a conversa não existe, cria com status PENDENTE
        if (!conversations[chatId]) {
            conversations[chatId] = { 
                status: 'pending', 
                initiator: sender, 
                messages: [] 
            };
        }
        
        conversations[chatId].messages.push({ sender, text, timestamp: new Date() });
        return conversations[chatId];
    },
    acceptRequest: (chatId) => {
        if (conversations[chatId]) conversations[chatId].status = 'accepted';
    },
    rejectRequest: (chatId) => {
        if (conversations[chatId]) delete conversations[chatId]; // ou status 'rejected'
    },
    getChatId
};
