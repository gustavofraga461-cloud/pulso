const api = {
    acceptRequest: async (chatId) => {
        return fetch('/api/requests/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId })
        }).then(res => res.json());
    },
    rejectRequest: async (chatId) => {
        return fetch('/api/requests/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId })
        }).then(res => res.json());
    }
};
