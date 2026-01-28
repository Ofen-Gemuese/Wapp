import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, updateDoc, doc, query, orderBy, writeBatch, getDocs, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

console.log("Script wird initialisiert...");

// ==========================================
// 1. CONFIG & GLOBALS
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCVRQJ9EXplDxM89YTcLoCfDexmKuFXQbs",
    authDomain: "wochenplan-010.firebaseapp.com",
    projectId: "wochenplan-010",
    storageBucket: "wochenplan-010.firebasestorage.app",
    messagingSenderId: "858345071312",
    appId: "1:858345071312:web:a11b0e4e57d974206174d5"
};

let app, db, colRef, catRef, arcRef, metaDocRef;
let allCategories = {};
let currentTasks = [];
let allArchives = [];
let weatherData = {};
let weekChartInstance = null;
let catChartInstance = null;
let pendingConfirmAction = null;

window.currentSubtasks = [];
window.selectedRecurDays = [];
const daysDisplay = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
let currentTheme = localStorage.getItem('plannerTheme') || 'cosmic';

// ==========================================
// 2. STARTUP
// ==========================================
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    colRef = collection(db, 'tasks');
    catRef = collection(db, 'categories');
    arcRef = collection(db, 'week_archives');
    metaDocRef = doc(db, 'settings', 'weekInfo');
    
    console.log("Firebase verbunden.");
    initApp();
} catch(e) { console.error("Firebase Fehler:", e); }

function initApp() {
    applyTheme(currentTheme);
    setupRealtimeListeners();
    fetchWeather();
    checkWeekStatus();
}

// ==========================================
// 3. UI & THEME
// ==========================================
function applyTheme(themeName) {
    const linkTag = document.getElementById('theme-stylesheet');
    if(linkTag) linkTag.href = `./css/${themeName}.css`;
}

window.toggleTheme = () => {
    if(currentTheme === 'cosmic') currentTheme = 'aurora';
    else if(currentTheme === 'aurora') currentTheme = 'midnight';
    else currentTheme = 'cosmic';
    localStorage.setItem('plannerTheme', currentTheme);
    applyTheme(currentTheme);
    if(!document.getElementById('dashboardModal').classList.contains('hidden')) window.openLiveDashboard();
};

window.closeModal = () => {
    const modal = document.getElementById('taskModal');
    if(modal) {
        modal.classList.add('hidden'); // Fix: Einfaches Add statt Verkettung
    }
};

window.toggleColumn = (day) => {
    const el = document.getElementById(day);
    if(el) el.classList.toggle('collapsed');
};

// ==========================================
// 4. DATENBANK & LISTENERS
// ==========================================
function setupRealtimeListeners() {
    onSnapshot(catRef, snap => {
        allCategories = {};
        const select = document.getElementById('taskCatSelect');
        if (select) select.innerHTML = '<option value="">Keine Kategorie</option>';
        snap.docs.forEach(d => {
            allCategories[d.id] = d.data();
            if (select) select.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
        });
        renderCalendar(currentTasks);
    });

    onSnapshot(colRef, snap => {
        currentTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderCalendar(currentTasks);
        updateAllProgressBars();
    });

    onSnapshot(query(arcRef, orderBy('archivedAt', 'desc')), snap => {
        allArchives = snap.docs.map(d => ({id: d.id, ...d.data()}));
    });
}

// ==========================================
// 5. DASHBOARD & STATS
// ==========================================
window.openLiveDashboard = () => {
    const stats = generateStatsObject(currentTasks);
    renderDashboardModal(stats, "Aktuelle Woche", "Live Übersicht");
};

function generateStatsObject(tasks) {
    const total = tasks.length;
    const done = tasks.filter(t => t.completed).length;
    const percent = total > 0 ? Math.round((done/total)*100) : 0;
    const prioTotal = tasks.filter(t => t.isPriority).length;
    const prioDone = tasks.filter(t => t.isPriority && t.completed).length;
    const prioScore = prioTotal > 0 ? Math.round((prioDone/prioTotal)*100) : 0;
    
    let totalMins = 0;
    tasks.forEach(t => {
        if(t.completed && t.timeFrom && t.timeTo) {
            const [h1, m1] = t.timeFrom.split(':').map(Number);
            const [h2, m2] = t.timeTo.split(':').map(Number);
            totalMins += (h2 * 60 + m2) - (h1 * 60 + m1);
        }
    });

    const weekData = daysDisplay.map(day => {
        const dTasks = tasks.filter(t => t.day === day);
        return { total: dTasks.length, completed: dTasks.filter(t => t.completed).length };
    });

    const catStats = {};
    tasks.forEach(t => {
        if(!t.categoryId) return;
        if(!catStats[t.categoryId]) {
            const cData = allCategories[t.categoryId] || { name: '?', color: '#666' };
            catStats[t.categoryId] = { name: cData.name, color: cData.color, total: 0, done: 0 };
        }
        catStats[t.categoryId].total++;
        if(t.completed) catStats[t.categoryId].done++;
    });

    return { total, done, percent, prioScore, hours: (totalMins/60).toFixed(1), weekData, catStats };
}

function renderDashboardModal(stats, title, subtitle) {
    const elTitle = document.getElementById('dashboard-title');
    const elSub = document.getElementById('dashboard-subtitle');
    const elTotal = document.getElementById('stat-total-tasks');
    const elHours = document.getElementById('stat-hours');
    const elPrio = document.getElementById('stat-prio');
    const elPercent = document.getElementById('stat-percent');

    if(elTitle) elTitle.innerText = title;
    if(elSub) elSub.innerText = subtitle;
    if(elTotal) elTotal.innerText = `${stats.done}/${stats.total}`;
    if(elHours) elHours.innerText = `${stats.hours}h`;
    if(elPrio) elPrio.innerText = `${stats.prioScore}%`;
    if(elPercent) elPercent.innerText = `${stats.percent}%`;

    const ctxWeek = document.getElementById('weekChart');
    const ctxCat = document.getElementById('catChart');
    if(!ctxWeek || !ctxCat) return;

    let tickColor = '#94a3b8'; 
    if (currentTheme === 'midnight') tickColor = '#525252';
    Chart.defaults.color = tickColor;

    if(weekChartInstance) weekChartInstance.destroy();
    weekChartInstance = new Chart(ctxWeek, {
        type: 'bar',
        data: {
            labels: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
            datasets: [
                { label: 'Erledigt', data: stats.weekData.map(d => d.completed), backgroundColor: '#4ade80', borderRadius: 4 },
                { label: 'Offen', data: stats.weekData.map(d => d.total - d.completed), backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
    });

    const catArr = Object.values(stats.catStats);
    if(catChartInstance) catChartInstance.destroy();
    catChartInstance = new Chart(ctxCat, {
        type: 'doughnut',
        data: { labels: catArr.map(c => c.name), datasets: [{ data: catArr.map(c => c.total), backgroundColor: catArr.map(c => c.color), borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
    });

    const container = document.getElementById('cat-stats-list');
    if(container) {
        container.innerHTML = catArr.map(c => `<div class="flex justify-between text-xs mb-1"><span>${c.name}</span><span class="text-gray-500">${c.done}/${c.total}</span></div>`).join('');
    }
    document.getElementById('dashboardModal').classList.remove('hidden');
}

window.closeDashboard = () => document.getElementById('dashboardModal').classList.add('hidden');

// ==========================================
// 6. ARCHIV & KATEGORIEN (Fix für ReferenceErrors)
// ==========================================
window.openArchive = () => {
    const list = document.getElementById('archive-list');
    list.innerHTML = allArchives.map(a => `
        <div class="p-4 bg-white/5 rounded-xl mb-2 flex justify-between items-center cursor-pointer hover:bg-white/10" onclick="showArchiveStats('${a.id}')">
            <div><div class="font-bold text-green-400">${a.weekRange}</div><div class="text-[10px] text-gray-500">Erfolg: ${a.percent}%</div></div>
            <button onclick="event.stopPropagation(); deleteArchiveEntry('${a.id}')" class="text-red-400"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>`).join('') || "Archiv leer";
    document.getElementById('archiveModal').classList.remove('hidden');
    lucide.createIcons();
};

window.closeArchive = () => document.getElementById('archiveModal').classList.add('hidden');

window.openCatManage = () => {
    const list = document.getElementById('cat-manage-list');
    list.innerHTML = Object.entries(allCategories).map(([id, c]) => `
        <div class="flex justify-between p-3 bg-white/5 rounded-xl mb-2">
            <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full" style="background:${c.color}"></div>${c.name}</div>
            <button onclick="deleteCategory('${id}')" class="text-red-400"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>`).join('');
    document.getElementById('catManageModal').classList.remove('hidden');
    lucide.createIcons();
};

window.closeCatManage = () => document.getElementById('catManageModal').classList.add('hidden');

window.deleteCategory = (id) => {
    window.openConfirm(async () => { await deleteDoc(doc(db, 'categories', id)); window.openCatManage(); });
};

// ==========================================
// 7. TASK ACTIONS (Save, Delete, Subtasks)
// ==========================================
window.saveTask = async () => {
    const id = document.getElementById('taskId').value;
    const text = document.getElementById('taskText').value;
    const newCat = document.getElementById('newCatName').value;
    let catId = document.getElementById('taskCatSelect').value;

    if(!text) return;

    if(newCat.trim() !== "") {
        const cDoc = await addDoc(catRef, { name: newCat, color: document.getElementById('newCatColor').value });
        catId = cDoc.id;
    }

    const data = {
        text,
        day: document.getElementById('taskDay').value,
        timeFrom: document.getElementById('taskTimeFrom').value,
        timeTo: document.getElementById('taskTimeTo').value,
        isPriority: document.getElementById('taskPriority').checked,
        categoryId: catId,
        subtasks: window.currentSubtasks,
        completed: false
    };

    if(window.selectedRecurDays.length > 0) {
        const batch = writeBatch(db);
        window.selectedRecurDays.forEach(d => {
            const ref = doc(colRef);
            batch.set(ref, { ...data, day: d });
        });
        await batch.commit();
    } else {
        if(id) await updateDoc(doc(db, 'tasks', id), data);
        else await addDoc(colRef, data);
    }
    window.closeModal();
};

// Subtask Logik (Neu/Repariert)
window.renderModalSubtasks = () => {
    const list = document.getElementById('subtaskList');
    list.innerHTML = window.currentSubtasks.map((st, i) => `
        <div class="flex items-center gap-2 p-1 border-b border-white/5">
            <input type="checkbox" ${st.done ? 'checked' : ''} onchange="window.toggleModalSubtask(${i})">
            <span class="text-sm flex-1 ${st.done ? 'line-through text-gray-500' : ''}">${st.text}</span>
            <button onclick="window.removeSubtask(${i})" class="text-red-400">✕</button>
        </div>`).join('');
};

window.addSubtask = () => {
    const inp = document.getElementById('newSubtaskInput');
    if(inp && inp.value.trim()) {
        window.currentSubtasks.push({ text: inp.value.trim(), done: false });
        inp.value = '';
        window.renderModalSubtasks();
    }
};

window.removeSubtask = (i) => {
    window.currentSubtasks.splice(i, 1);
    window.renderModalSubtasks();
};

window.toggleModalSubtask = (i) => {
    window.currentSubtasks[i].done = !window.currentSubtasks[i].done;
    window.renderModalSubtasks();
};

// ==========================================
// 8. RENDERER & CALENDAR
// ==========================================
window.renderCalendar = (tasks) => {
    const grid = document.getElementById('calendar-grid');
    if(!grid || grid.children.length === 0) return;

    daysDisplay.forEach(day => {
        const col = document.getElementById(day);
        const list = col.querySelector('.task-list');
        const dayTasks = tasks.filter(t => t.day === day).sort((a,b) => (a.timeFrom || '23:59').localeCompare(b.timeFrom || '23:59'));
        
        list.innerHTML = dayTasks.map(t => {
            const cat = allCategories[t.categoryId] || { color: 'transparent', name: '' };
            return `
            <div class="task-card p-4 mb-3 rounded-2xl bg-white/5 border border-white/10 cursor-pointer" onclick="editTask('${t.id}')">
                <div class="flex justify-between items-start">
                    <div class="flex-1 min-w-0">
                        <span class="text-[10px] font-bold text-green-400 font-mono">${t.timeFrom || ''}</span>
                        <h3 class="text-sm font-bold text-white truncate">${t.isPriority?'🔥 ':''}${t.text}</h3>
                        ${t.categoryId ? `<div class="mt-2 text-[9px] uppercase font-bold px-2 py-0.5 rounded inline-block bg-white/5 border border-white/10" style="color:${cat.color}">${cat.name}</div>` : ''}
                    </div>
                    <button onclick="event.stopPropagation(); toggleStatus('${t.id}', ${t.completed})">
                        <i data-lucide="${t.completed ? 'check-circle' : 'circle'}" class="w-5 h-5 ${t.completed ? 'text-green-500' : 'text-white/20'}"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    });
    lucide.createIcons();
};

function updateAllProgressBars() {
    daysDisplay.forEach(day => {
        const dayTasks = currentTasks.filter(t => t.day === day);
        const done = dayTasks.filter(t => t.completed).length;
        const percent = dayTasks.length > 0 ? (done / dayTasks.length) * 100 : 0;
        const bar = document.getElementById(`progress-${day}`);
        if(bar) bar.style.width = `${percent}%`;
    });
}

function initGridStructure() {
    const now = new Date();
    const monday = new Date(now.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)));
    const grid = document.getElementById('calendar-grid');
    const weekDates = daysDisplay.map((name, i) => {
        const d = new Date(monday); d.setDate(monday.getDate() + i);
        return { name, date: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) };
    });
    document.getElementById('week-display').innerText = `${weekDates[0].date} - ${weekDates[6].date}`;
    
    grid.innerHTML = weekDates.map(d => `
        <div class="day-column flex-shrink-0 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col h-full w-[85vw] md:w-[320px] relative transition-all duration-300" id="${d.name}">
            <div class="p-6 cursor-pointer" onclick="toggleColumn('${d.name}')">
                <span class="text-xs text-gray-500">${d.date}</span>
                <div class="flex justify-between items-center"><h2 class="text-2xl font-black">${d.name}</h2><div id="weather-${d.name}"></div></div>
                <div class="h-1 bg-white/10 rounded-full mt-3 overflow-hidden"><div id="progress-${d.name}" class="h-full bg-green-500 w-0 transition-all duration-500"></div></div>
            </div>
            <div class="flex-1 p-4 overflow-y-auto task-list no-scrollbar space-y-3"></div>
            <div class="p-4"><button onclick="openModal('${d.name}')" class="w-full py-4 bg-white/5 rounded-2xl font-bold hover:bg-green-500 hover:text-black transition-all">+ NEU</button></div>
        </div>`).join('');

    const todayName = new Date().toLocaleDateString('de-DE', { weekday: 'long' });
    const todayCol = document.getElementById(todayName);
    if(todayCol) {
        todayCol.classList.add('current-day-highlight');
        setTimeout(() => todayCol.scrollIntoView({ behavior: 'smooth', inline: 'center' }), 500);
    }
}

// Standard Modal Actions
window.openModal = (d) => {
    document.getElementById('taskId').value = "";
    document.getElementById('taskDay').value = d;
    document.getElementById('taskText').value = "";
    document.getElementById('newCatName').value = "";
    document.getElementById('taskTimeFrom').value = "";
    document.getElementById('taskTimeTo').value = "";
    window.currentSubtasks = [];
    window.renderModalSubtasks();
    window.selectedRecurDays = [];
    document.getElementById('taskModal').classList.remove('hidden');
};

window.editTask = (id) => {
    const t = currentTasks.find(x => x.id === id);
    if(!t) return;
    document.getElementById('taskId').value = id;
    document.getElementById('taskDay').value = t.day;
    document.getElementById('taskText').value = t.text;
    document.getElementById('taskTimeFrom').value = t.timeFrom || "";
    document.getElementById('taskTimeTo').value = t.timeTo || "";
    document.getElementById('taskPriority').checked = t.isPriority || false;
    document.getElementById('taskCatSelect').value = t.categoryId || "";
    window.currentSubtasks = t.subtasks || [];
    window.renderModalSubtasks();
    document.getElementById('taskModal').classList.remove('hidden');
};

window.toggleStatus = (id, s) => updateDoc(doc(db, 'tasks', id), { completed: !s });
window.openConfirm = (action) => { pendingConfirmAction = action; document.getElementById('confirmModal').classList.remove('hidden'); };
window.closeConfirm = () => document.getElementById('confirmModal').classList.add('hidden');
document.getElementById('btnConfirmAction').onclick = () => { if(pendingConfirmAction) pendingConfirmAction(); closeConfirm(); };

// Extra Helpers
window.toggleDayRecur = (btn, day) => {
    if(window.selectedRecurDays.includes(day)) {
        window.selectedRecurDays = window.selectedRecurDays.filter(d => d !== day);
        btn.classList.remove('bg-green-500');
    } else {
        window.selectedRecurDays.push(day);
        btn.classList.add('bg-green-500');
    }
};

async function fetchWeather() { /* Wie zuvor */ }
async function checkWeekStatus() { /* Wie zuvor */ }

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGridStructure); else initGridStructure();
