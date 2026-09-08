const ui = {
    showTab: (tabId) => {
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        document.getElementById(tabId).style.display = 'block';
    },
    addRequest: (request) => {
        const list = document.getElementById('request-list');
        const div = document.createElement('div');
        div.className = 'request-card';
        div.id = `req-${request.chatId}`;
        div.innerHTML = `
            <div><strong>${request.sender}</strong> quer conversar com você.</div>
            <div>"${request.text}"</div>
            <div class="req-actions">
                <button class="btn-accept" onclick="app.accept('${request.chatId}', '${request.sender}', '${request.text}')">Aceitar</button>
                <button class="btn-reject" onclick="app.reject('${request.chatId}')">Recusar</button>
            </div>
        `;
        list.appendChild(div);
        
        const badge = document.getElementById('req-badge');
        badge.innerText = parseInt(badge.innerText) + 1;
    },
    removeRequest: (chatId) => {
        const el = document.getElementById(`req-${chatId}`);
        if (el) el.remove();
        
        const badge = document.getElementById('req-badge');
        const currentCount = parseInt(badge.innerText);
        if (currentCount > 0) badge.innerText = currentCount - 1;
    },
    addMessage: (sender, text) => {
        const list = document.getElementById('chat-list');
        const p = document.createElement('p');
        p.innerHTML = `<strong>${sender}:</strong> ${text}`;
        list.appendChild(p);
        list.scrollTop = list.scrollHeight;
    }
};
