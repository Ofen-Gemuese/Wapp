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
    initApp();
} catch(e) { console.error("Firebase Fehler:", e); }

function initApp() {
    applyTheme(currentTheme);
    setupRealtimeListeners();
    fetchWeather();
    checkWeekStatus();
}

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

// ==========================================
// 3. LISTENERS & HELPERS
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
    });
    onSnapshot(query(arcRef, orderBy('archivedAt', 'desc')), snap => {
        allArchives = snap.docs.map(d => ({id: d.id, ...d.data()}));
    });
}

async function fetchWeather() {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=51.16&longitude=10.45&daily=weathercode,temperature_2m_max&timezone=auto&past_days=0`;
        const res = await fetch(url);
        const data = await res.json();
        const iconMap = (c) => c<=3?'sun':c<=48?'cloud':c<=67?'cloud-rain':'snowflake';
        daysDisplay.forEach((day, i) => {
            if(data.daily) weatherData[day] = { temp: Math.round(data.daily.temperature_2m_max[i]), icon: iconMap(data.daily.weathercode[i]) };
        });
        renderCalendar(currentTasks);
    } catch(e) { console.warn("Wetter Fehler"); }
}

async function checkWeekStatus() {
    const realMonday = new Date();
    realMonday.setDate(realMonday.getDate() - realMonday.getDay() + (realMonday.getDay() === 0 ? -6 : 1));
    const mondayStr = realMonday.toISOString().split('T')[0];
    const snap = await getDoc(metaDocRef);
    if (!snap.exists() || snap.data().currentMonday !== mondayStr) {
        await setDoc(metaDocRef, { currentMonday: mondayStr });
    }
}

function generateStatsObject(tasks) {
    const total = tasks.length;
    const done = tasks.filter(t => t.completed).length;
    const percent = total > 0 ? Math.round((done/total)*100) : 0;
    const prioTotal = tasks.filter(t => t.isPriority).length;
    const prioDone = tasks.filter(t => t.isPriority && t.completed).length;
    const prioScore = prioTotal > 0 ? Math.round((prioDone/prioTotal)*100) : 0;
    
    let mins = 0;
    tasks.forEach(t => {
        if(t.completed && t.timeFrom && t.timeTo) {
            const [h1, m1] = t.timeFrom.split(':').map(Number);
            const [h2, m2] = t.timeTo.split(':').map(Number);
            mins += (h2*60+m2) - (h1*60+m1);
        }
    });
    
    const weekData = daysDisplay.map(day => {
        const dTasks = tasks.filter(t => t.day === day);
        return { total: dTasks.length, completed: dTasks.filter(t => t.completed).length };
    });

    const catStats = {};
    tasks.forEach(t => {
        if(!t.categoryId) return;
        if(!catStats[t.categoryId]) catStats[t.categoryId] = { total: 0, done: 0, ...allCategories[t.categoryId] };
        catStats[t.categoryId].total++; if(t.completed) catStats[t.categoryId].done++;
    });

    return { total, done, percent, prioScore, hours: (mins/60).toFixed(1), weekData, catStats };
}

// ==========================================
// 4. DASHBOARD RENDER (DER FIX!)
// ==========================================
window.openLiveDashboard = () => {
    const stats = generateStatsObject(currentTasks);
    renderDashboardModal(stats, "Aktuelle Woche", "Live Übersicht");
}

function renderDashboardModal(stats, title, subtitle) {
    // Sicherheitsabfragen für jedes Element
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
                { label: 'Done', data: stats.weekData.map(d => d.completed), backgroundColor: '#4ade80', borderRadius: 4 },
                { label: 'Open', data: stats.weekData.map(d => d.total - d.completed), backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
    });

    const catArr = Object.values(stats.catStats);
    if(catChartInstance) catChartInstance.destroy();
    catChartInstance = new Chart(ctxCat, {
        type: 'doughnut',
        data: { labels: catArr.map(c => c.name), datasets: [{ data: catArr.map(c => c.total), backgroundColor: catArr.map(c => c.color) }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
    });

    const list = document.getElementById('cat-stats-list');
    if(list) {
        list.innerHTML = catArr.map(c => `<div class="text-xs flex justify-between"><span>${c.name}</span><span>${c.done}/${c.total}</span></div>`).join('');
    }
    document.getElementById('dashboardModal').classList.remove('hidden');
}

window.closeDashboard = () => document.getElementById('dashboardModal').classList.add('hidden');

// ==========================================
// 5. CALENDAR & CRUD
// ==========================================
window.renderCalendar = (tasks) => {
    const grid = document.getElementById('calendar-grid');
    if(!grid || grid.children.length === 0) return;
    daysDisplay.forEach(day => {
        const list = document.getElementById(day).querySelector('.task-list');
        const dayTasks = tasks.filter(t => t.day === day).sort((a,b) => (a.timeFrom||"23:59").localeCompare(b.timeFrom||"23:59"));
        list.innerHTML = dayTasks.map(t => {
            const cat = allCategories[t.categoryId] || { color: 'transparent', name: '' };
            return `<div class="task-card p-4 mb-3 rounded-2xl bg-white/5 border border-white/10" onclick="editTask('${t.id}')">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <span class="text-[10px] font-bold text-green-400">${t.timeFrom || ''}</span>
                        <h3 class="text-sm font-bold text-white">${t.isPriority?'🔥 ':''}${t.text}</h3>
                        ${t.categoryId ? `<div class="mt-2 text-[10px] inline-block px-2 py-0.5 rounded border border-white/10" style="color:${cat.color}">${cat.name}</div>` : ''}
                    </div>
                    <button onclick="event.stopPropagation(); toggleStatus('${t.id}', ${t.completed})"><i data-lucide="${t.completed?'check-circle':'circle'}" class="w-5 h-5 text-green-400"></i></button>
                </div>
            </div>`;
        }).join('');
    });
    lucide.createIcons();
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
        <div class="day-column flex-shrink-0 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col h-full w-[85vw] md:w-[320px]" id="${d.name}">
            <div class="p-6">
                <span class="text-xs text-gray-500">${d.date}</span>
                <div class="flex justify-between items-center"><h2 class="text-2xl font-black">${d.name}</h2><div id="weather-${d.name}"></div></div>
            </div>
            <div class="flex-1 p-4 overflow-y-auto task-list no-scrollbar"></div>
            <div class="p-4"><button onclick="openModal('${d.name}')" class="w-full py-4 bg-white/5 rounded-2xl font-bold">+ NEU</button></div>
        </div>`).join('');

    const todayName = new Date().toLocaleDateString('de-DE', { weekday: 'long' });
    const todayCol = document.getElementById(todayName);
    if(todayCol) {
        todayCol.classList.add('current-day-highlight');
        setTimeout(() => todayCol.scrollIntoView({ behavior: 'smooth', inline: 'center' }), 500);
    }
}

// Standard CRUD (Gekürzt, Logik wie zuvor)
window.openModal = (d) => { document.getElementById('taskId').value=""; document.getElementById('taskDay').value=d; document.getElementById('taskText').value=""; document.getElementById('taskModal').classList.remove('hidden'); }
window.editTask = (id) => { const t = currentTasks.find(x => x.id === id); document.getElementById('taskId').value=id; document.getElementById('taskText').value=t.text; document.getElementById('taskTimeFrom').value=t.timeFrom||''; document.getElementById('taskModal').classList.remove('hidden'); }
window.saveTask = async () => {
    const id = document.getElementById('taskId').value;
    const data = { text: document.getElementById('taskText').value, day: document.getElementById('taskDay').value, timeFrom: document.getElementById('taskTimeFrom').value, completed: false };
    if(id) await updateDoc(doc(db, 'tasks', id), data); else await addDoc(colRef, data);
    closeModal();
};
window.toggleStatus = (id, s) => updateDoc(doc(db, 'tasks', id), { completed: !s });
window.closeModal = () => document.getElementById('taskModal').classList.remove('hidden').classList.add('hidden');

// Deletion & Confirm
window.openConfirm = (action) => { pendingConfirmAction = action; document.getElementById('confirmModal').classList.remove('hidden'); }
window.closeConfirm = () => document.getElementById('confirmModal').classList.add('hidden');
document.getElementById('btnConfirmAction').onclick = () => { if(pendingConfirmAction) pendingConfirmAction(); closeConfirm(); }

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGridStructure); else initGridStructure();
