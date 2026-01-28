import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, updateDoc, doc, query, orderBy, writeBatch, getDocs, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

console.log("Script gestartet...");

// ==========================================
// 1. KONFIGURATION & VARIABLEN
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

// Globale Variablen für UI Status
window.currentSubtasks = [];
window.selectedRecurDays = [];
const daysDisplay = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
let currentTheme = localStorage.getItem('plannerTheme') || 'cosmic';

// ==========================================
// 2. INITIALISIERUNG
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
} catch(e) { 
    console.error("Firebase Init Fehler:", e);
    alert("Fehler beim Starten: " + e.message);
}

function initApp() {
    // Theme laden
    applyTheme(currentTheme);

    // Listener starten
    setupRealtimeListeners();
    
    // Daten laden
    fetchWeather();
    checkWeekStatus();
    
    // Notification Button prüfen
    if ("Notification" in window && Notification.permission === "granted") {
        const btn = document.getElementById('notify-btn');
        if(btn) btn.style.display = 'none';
    }
}

// ==========================================
// 3. THEME LOGIK
// ==========================================
function applyTheme(themeName) {
    const linkTag = document.getElementById('theme-stylesheet');
    if(linkTag) {
        // Pfad: ./css/themename.css
        linkTag.href = `./css/${themeName}.css`;
    }
}

window.toggleTheme = () => {
    if(currentTheme === 'cosmic') currentTheme = 'aurora';
    else if(currentTheme === 'aurora') currentTheme = 'midnight';
    else currentTheme = 'cosmic';
    
    localStorage.setItem('plannerTheme', currentTheme);
    applyTheme(currentTheme);
    
    // Charts neu zeichnen (wegen Farben)
    if(!document.getElementById('dashboardModal').classList.contains('hidden')) {
         window.openLiveDashboard(); 
    }
};

// ==========================================
// 4. FIREBASE LISTENER
// ==========================================
function setupRealtimeListeners() {
    // Kategorien
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

    // Aufgaben
    onSnapshot(colRef, snap => {
        currentTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderCalendar(currentTasks);
    });

    // Archiv
    onSnapshot(query(arcRef, orderBy('archivedAt', 'desc')), snap => {
        allArchives = snap.docs.map(d => ({id: d.id, ...d.data()}));
    });
}

// ==========================================
// 5. HELFER FUNKTIONEN (Wetter, Archiv, Stats)
// ==========================================

// Wetter API
async function fetchWeather() {
    try {
        const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
        const monday = new Date(d.setDate(diff)); const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
        const startStr = monday.toISOString().split('T')[0]; const endStr = sunday.toISOString().split('T')[0];
        const url = `https://api.open-meteo.com/v1/forecast?latitude=51.16&longitude=10.45&daily=weathercode,temperature_2m_max&timezone=auto&start_date=${startStr}&end_date=${endStr}`;
        
        const res = await fetch(url); 
        const data = await res.json();
        
        const getWeatherIcon = (c) => c<=3?'sun':c<=48?'cloud':c<=67?'cloud-rain':c<=77?'snowflake':'cloud-lightning';
        
        daysDisplay.forEach((dayName, i) => {
            if(data.daily && data.daily.weathercode && data.daily.weathercode[i] !== undefined) {
                weatherData[dayName] = { 
                    temp: Math.round(data.daily.temperature_2m_max[i]), 
                    icon: getWeatherIcon(data.daily.weathercode[i]) 
                };
            }
        });
        renderCalendar(currentTasks);
    } catch(e) { console.warn("Wetter Fehler (nicht kritisch):", e); }
}

// Auto-Archive Logic
function getCurrentMondayDate() {
    const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

async function checkWeekStatus() {
    try {
        const snap = await getDoc(metaDocRef);
        const realMonday = getCurrentMondayDate();

        if (!snap.exists()) {
            await setDoc(metaDocRef, { currentMonday: realMonday });
        } else {
            const storedMonday = snap.data().currentMonday;
            if (storedMonday !== realMonday) {
                const taskSnap = await getDocs(colRef);
                const tasksToArchive = taskSnap.docs.map(d => ({...d.data(), id: d.id}));
                
                if(tasksToArchive.length > 0) {
                    const archiveData = generateArchiveStats(tasksToArchive, storedMonday);
                    await addDoc(arcRef, archiveData);
                    const batch = writeBatch(db);
                    taskSnap.docs.forEach(d => batch.delete(d.ref));
                    await batch.commit();
                }
                await setDoc(metaDocRef, { currentMonday: realMonday });
                alert("Neue Woche! Alte Aufgaben wurden archiviert.");
            }
        }
    } catch(e) { console.error("Auto-Archive Error", e); }
}

// Statistik Rechner
function generateStatsObject(tasks) {
    const total = tasks.length;
    const done = tasks.filter(t => t.completed).length;
    const percent = total > 0 ? Math.round((done/total)*100) : 0;
    
    const prioTotal = tasks.filter(t => t.isPriority).length;
    const prioDone = tasks.filter(t => t.isPriority && t.completed).length;
    const prioScore = prioTotal > 0 ? Math.round((prioDone/prioTotal)*100) : 0;
    
    let totalMinutes = 0;
    tasks.forEach(t => {
        if(t.completed && t.timeFrom && t.timeTo) {
            const [h1, m1] = t.timeFrom.split(':').map(Number);
            const [h2, m2] = t.timeTo.split(':').map(Number);
            let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
            if(mins > 0) totalMinutes += mins;
        }
    });
    const hours = (totalMinutes / 60).toFixed(1);
    
    const weekData = daysDisplay.map(day => {
        const dayTasks = tasks.filter(t => t.day === day);
        return { total: dayTasks.length, completed: dayTasks.filter(t => t.completed).length };
    });
    
    const catStats = {};
    tasks.forEach(t => {
        const catId = t.categoryId;
        if(!catId || catId === 'none' || catId === '') return;
        if(!catStats[catId]) {
            const catData = allCategories[catId] || { name: 'Unbekannt', color: '#666' };
            catStats[catId] = { name: catData.name, color: catData.color, total: 0, done: 0 };
        }
        catStats[catId].total++;
        if(t.completed) catStats[catId].done++;
    });
    return { total, done, percent, prioScore, hours, weekData, catStats };
}

function generateArchiveStats(tasks, weekLabelDate) {
    const stats = generateStatsObject(tasks);
    const d = new Date(weekLabelDate);
    const label = `Woche vom ${d.toLocaleDateString()}`;
    return { weekRange: label, archivedAt: Date.now(), ...stats };
}

// ==========================================
// 6. UI & DASHBOARD
// ==========================================

window.openLiveDashboard = () => {
    const stats = generateStatsObject(currentTasks);
    renderDashboardModal(stats, "Aktuelle Woche", "Live Übersicht");
}

window.showArchiveStats = (archiveId) => {
    const archiveData = allArchives.find(a => a.id === archiveId);
    if(archiveData) {
        renderDashboardModal(archiveData, archiveData.weekRange, "Archivierte Statistik");
        document.getElementById('archiveModal').classList.add('hidden');
    }
}

function renderDashboardModal(stats, title, subtitle) {
    document.getElementById('dashboard-title').innerText = title;
    document.getElementById('dashboard-subtitle').innerText = subtitle;
    
    if(document.getElementById('stat-total-tasks')) document.getElementById('stat-total-tasks').innerText = `${stats.done}/${stats.total}`;
    if(document.getElementById('stat-hours')) document.getElementById('stat-hours').innerText = `${stats.hours}h`;
    if(document.getElementById('stat-prio')) document.getElementById('stat-prio').innerText = `${stats.prioScore}%`;
    if(document.getElementById('stat-percent')) document.getElementById('stat-percent').innerText = `${stats.percent}%`;
    
    const ctxWeek = document.getElementById('weekChart');
    const ctxCat = document.getElementById('catChart');
    
    // Farben je nach Theme
    let tickColor = '#94a3b8';
    let gridColor = 'rgba(255,255,255,0.05)';
    let openBarColor = 'rgba(255,255,255,0.1)';

    if (currentTheme === 'aurora') {
        tickColor = '#475569'; gridColor = 'rgba(0,0,0,0.05)'; openBarColor = 'rgba(0,0,0,0.05)';
    } else if (currentTheme === 'midnight') {
        tickColor = '#525252'; gridColor = '#262626'; openBarColor = '#262626';
    }

    Chart.defaults.color = tickColor;
    Chart.defaults.borderColor = gridColor;

    if(weekChartInstance) weekChartInstance.destroy();
    weekChartInstance = new Chart(ctxWeek, {
        type: 'bar',
        data: {
            labels: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
            datasets: [{ label: 'Erledigt', data: stats.weekData.map(d => d.completed), backgroundColor: '#4ade80', borderRadius: 4 }, { label: 'Offen', data: stats.weekData.map(d => d.total - d.completed), backgroundColor: openBarColor, borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } } }
    });
    
    const catValues = Object.values(stats.catStats || {});
    const catLabels = catValues.map(c => c.name);
    const catData = catValues.map(c => c.total);
    const catColors = catValues.map(c => c.color || '#666');
    
    if(catChartInstance) catChartInstance.destroy();
    if(catLabels.length > 0) {
        catChartInstance = new Chart(ctxCat, {
            type: 'doughnut',
            data: { labels: catLabels, datasets: [{ data: catData, backgroundColor: catColors, borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, usePointStyle: true } } }, cutout: '70%' }
        });
    } else { catChartInstance = new Chart(ctxCat, {type:'doughnut', data: {labels:[], datasets:[]}}); }
    
    const container = document.getElementById('cat-stats-list');
    const sortedStats = catValues.sort((a,b) => b.total - a.total);
    if (sortedStats.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-sm">Keine Daten vorhanden</div>';
    } else {
        const maxVal = Math.max(...sortedStats.map(s => s.total));
        container.innerHTML = sortedStats.map(stat => {
            const widthTotal = (stat.total / maxVal) * 100;
            return `<div><div class="flex justify-between text-xs mb-1"><span class="font-bold text-gray-300 flex items-center gap-2"><span class="w-2 h-2 rounded-full" style="background:${stat.color}"></span>${stat.name}</span><span class="text-gray-500">${stat.done} / ${stat.total}</span></div><div class="h-3 bg-white/5 rounded-full overflow-hidden relative"><div class="absolute top-0 left-0 h-full opacity-20" style="width: ${widthTotal}%; background-color: ${stat.color};"></div><div class="absolute top-0 left-0 h-full shadow-[0_0_10px_rgba(0,0,0,0.5)]" style="width: ${(stat.done/maxVal)*100}%; background-color: ${stat.color};"></div></div></div>`;
        }).join('');
    }
    document.getElementById('dashboardModal').classList.remove('hidden');
}
window.closeDashboard = () => document.getElementById('dashboardModal').classList.add('hidden');

// Archiv
window.openArchive = () => {
    document.getElementById('archive-list').innerHTML = allArchives.map(data => {
        const date = new Date(data.archivedAt).toLocaleDateString();
        return `
        <div class="p-5 bg-white/5 rounded-2xl flex justify-between items-center border border-white/5 cursor-pointer hover:bg-white/10 transition-colors" onclick="showArchiveStats('${data.id}')">
            <div><div class="text-green-400 font-bold mb-1">${data.weekRange}</div><div class="text-xs text-gray-400">Archiviert am ${date}</div></div>
            <div class="flex items-center gap-4"><div class="text-right"><div class="font-black text-xl text-white">${data.percent}%</div><div class="text-[10px] text-gray-500">Erfolg</div></div><button onclick="event.stopPropagation(); deleteArchiveEntry('${data.id}')" class="text-red-400 p-2 hover:bg-red-500/10 rounded-lg"><i data-lucide="trash-2" class="w-5 h-5"></i></button></div>
        </div>`;
    }).join('') || "<div class='text-center text-gray-500 py-10'>Archiv ist leer</div>";
    document.getElementById('archiveModal').classList.remove('hidden');
    lucide.createIcons();
};

window.deleteArchiveEntry = (id) => { window.openConfirm(async () => { await deleteDoc(doc(db, 'week_archives', id)); window.openArchive(); }); };
window.clearAllArchives = () => { window.openConfirm(async () => { const snap = await getDocs(arcRef); const batch = writeBatch(db); snap.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); window.openArchive(); }); };
window.closeArchive = () => document.getElementById('archiveModal').classList.add('hidden');

// ==========================================
// 7. CALENDAR RENDER & TASKS
// ==========================================

window.renderCalendar = (tasks) => {
    const grid = document.getElementById('calendar-grid');
    if(!grid) return;
    if(grid.children.length === 0 || grid.innerText.includes("Lade")) initGridStructure();
    
    daysDisplay.forEach(day => {
        const col = document.getElementById(day); if (!col) return;
        
        // Wetter
        const weatherContainer = document.getElementById(`weather-${day}`);
        if(weatherContainer && weatherData[day]) { 
            weatherContainer.innerHTML = `<i data-lucide="${weatherData[day].icon}" class="w-4 h-4"></i> <span class="text-xs">${weatherData[day].temp}°</span>`; 
        }
        
        const list = col.querySelector('.task-list'); if(!list) return;
        let dayTasks = tasks.filter(t => t.day === day);
        
        // Sortierung: NUR nach Zeit
        dayTasks.sort((a, b) => {
            const timeA = a.timeFrom || a.time || "23:59"; const timeB = b.timeFrom || b.time || "23:59"; 
            return timeA.localeCompare(timeB);
        });
        
        col.ondragover = (e) => { e.preventDefault(); col.classList.add('drag-over'); };
        col.ondragleave = (e) => { col.classList.remove('drag-over'); };
        col.ondrop = (e) => handleDrop(e, day);
        
        list.innerHTML = dayTasks.map(t => {
            const cat = allCategories[t.categoryId] || { color: 'transparent', name: '' };
            const displayTime = t.time || ""; 
            let subInfo = '';
            if(t.subtasks && t.subtasks.length > 0) {
                const d = t.subtasks.filter(s => s.done).length; const p = Math.round((d/t.subtasks.length)*100);
                subInfo = `<div class="mt-2 h-1 bg-white/10 rounded-full overflow-hidden"><div class="h-full bg-green-500" style="width:${p}%"></div></div>`;
            }
            const prioStyle = t.isPriority ? 'border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'border-white/10';
            const prioIcon = t.isPriority ? '🔥 ' : '';
            return `<div draggable="true" ondragstart="handleDragStart(event, '${t.id}', '${day}')" class="task-card ${t.completed ? 'completed opacity-50' : ''} p-4 mb-3 rounded-2xl bg-white/5 border ${prioStyle} relative group cursor-pointer hover:bg-white/10 transition-all" onclick="toggleTaskDetails(this)"><div class="flex items-start gap-3 mb-1"><button onclick="event.stopPropagation(); toggleStatus('${t.id}', ${t.completed})" class="mt-0.5 text-green-400 hover:scale-110 transition-transform flex-shrink-0"><i data-lucide="${t.completed ? 'check-circle' : 'circle'}" class="w-5 h-5"></i></button><div class="flex-1 min-w-0"><div class="flex items-baseline gap-2"><span class="text-xs font-mono text-green-400 font-bold shrink-0">${displayTime}</span><h3 class="text-sm font-semibold text-white leading-tight break-words">${prioIcon}${t.text || "Ohne Titel"}</h3></div>${t.categoryId ? `<div class="inline-flex items-center gap-1.5 mt-2 px-2 py-1 rounded-md border border-white/10 bg-white/5 w-auto self-start"><div class="w-2 h-2 rounded-full flex-shrink-0" style="background: ${cat.color}"></div><span class="text-[10px] font-bold text-gray-300 uppercase tracking-wider truncate max-w-[120px]">${cat.name}</span></div>` : ''}${subInfo}</div><div class="flex flex-col gap-2"><button onclick="event.stopPropagation(); editTask('${t.id}')" class="text-blue-400/30 hover:text-blue-400 transition-colors flex-shrink-0"><i data-lucide="pencil" class="w-4 h-4"></i></button><button onclick="event.stopPropagation(); deleteTask('${t.id}')" class="text-red-400/30 hover:text-red-400 transition-colors flex-shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div><div class="task-details-wrapper"><div class="task-details-inner pl-8 pr-2 pb-2">${t.subtasks && t.subtasks.length ? `<div class="space-y-1 mt-2">${t.subtasks.map((s, index) => `<div class="flex gap-2 items-center p-1 rounded cursor-pointer hover:bg-white/5 transition-colors" onclick="event.stopPropagation(); toggleCardSubtask('${t.id}', ${index})"><i class="w-4 h-4 text-white/70" data-lucide="${s.done ? 'check-square' : 'square'}"></i><span class="text-xs text-white/80 ${s.done ? 'line-through opacity-50' : 'font-medium'}">${s.text}</span></div>`).join('')}</div>` : ''}</div></div></div>`;
        }).join('');
    });
    if (window.lucide) lucide.createIcons();
}

// Drag & Drop
window.handleDragStart = (e, taskId, sourceDay) => { e.dataTransfer.setData("text/plain", JSON.stringify({ taskId, sourceDay })); e.target.classList.add('dragging'); }
window.handleDrop = async (e, targetDay) => {
    e.preventDefault(); document.querySelectorAll('.day-column').forEach(c => c.classList.remove('drag-over'));
    const raw = e.dataTransfer.getData("text/plain"); if(!raw) return; const { taskId, sourceDay } = JSON.parse(raw);
    if(sourceDay === targetDay) return; await updateDoc(doc(db, 'tasks', taskId), { day: targetDay });
}
window.toggleColumn = (day) => { const el = document.getElementById(day); if(el) el.classList.toggle('collapsed'); };
window.toggleTaskDetails = (el) => el.classList.toggle('expanded');

// Task Subtasks
window.toggleCardSubtask = async (taskId, index) => {
    const task = currentTasks.find(t => t.id === taskId); if (!task || !task.subtasks) return;
    const newSubtasks = [...task.subtasks]; newSubtasks[index].done = !newSubtasks[index].done;
    await updateDoc(doc(db, 'tasks', taskId), { subtasks: newSubtasks });
}
window.renderModalSubtasks = () => {
    const list = document.getElementById('subtaskList');
    list.innerHTML = window.currentSubtasks.map((st, i) => `
        <div class="flex items-center gap-2 border-b border-white/5 p-2 last:border-0">
            <input type="checkbox" ${st.done ? 'checked' : ''} onchange="toggleModalSubtask(${i})" class="accent-green-500 w-4 h-4 cursor-pointer"><span class="text-sm flex-1 text-gray-200 ${st.done ? 'line-through text-gray-500' : ''}">${st.text}</span><button onclick="removeSubtask(${i})" class="text-red-400 hover:text-red-300 rounded p-1">✕</button></div>`).join('');
}
window.addSubtask = () => { const inp = document.getElementById('newSubtaskInput'); if(inp.value.trim()) { window.currentSubtasks.push({ text: inp.value.trim(), done: false }); inp.value = ''; renderModalSubtasks(); } }
window.removeSubtask = (i) => { window.currentSubtasks.splice(i, 1); renderModalSubtasks(); }
window.toggleModalSubtask = (i) => { window.currentSubtasks[i].done = !window.currentSubtasks[i].done; renderModalSubtasks(); }
window.toggleDayRecur = (btn, day) => { if(window.selectedRecurDays.includes(day)) { window.selectedRecurDays = window.selectedRecurDays.filter(d => d !== day); btn.classList.remove('active'); } else { window.selectedRecurDays.push(day); btn.classList.add('active'); } }

// CRUD Operations
window.openModal = (d) => { 
    document.getElementById('modalTitle').innerText = "Neue Aufgabe"; document.getElementById('taskId').value = ""; document.getElementById('taskDay').value = d; document.getElementById('taskText').value=""; document.getElementById('newCatName').value=""; document.getElementById('taskTimeFrom').value=""; document.getElementById('taskTimeTo').value=""; document.getElementById('taskPriority').checked = false; window.currentSubtasks = []; window.renderModalSubtasks(); window.selectedRecurDays = []; document.querySelectorAll('.recur-btn').forEach(b => b.classList.remove('active')); 
    document.getElementById('btnDuplicate').classList.add('hidden'); 
    document.getElementById('btnDelete').classList.add('hidden'); 
    document.getElementById('taskCatSelect').value=""; document.getElementById('taskModal').classList.remove('hidden'); 
};
window.editTask = (id) => {
    const task = currentTasks.find(t => t.id === id); if (!task) return; document.getElementById('modalTitle').innerText = "Bearbeiten"; document.getElementById('taskId').value = id; document.getElementById('taskDay').value = task.day; document.getElementById('taskText').value = task.text; document.getElementById('taskPriority').checked = task.isPriority || false; document.getElementById('taskTimeFrom').value = task.timeFrom || (task.time ? task.time.split(' - ')[0] : "") || ""; document.getElementById('taskTimeTo').value = task.timeTo || (task.time ? task.time.split(' - ')[1] : "") || ""; window.currentSubtasks = task.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : []; window.renderModalSubtasks(); window.selectedRecurDays = []; document.querySelectorAll('.recur-btn').forEach(b => b.classList.remove('active')); document.getElementById('taskCatSelect').value = task.categoryId || ""; 
    document.getElementById('btnDuplicate').classList.remove('hidden'); 
    document.getElementById('btnDelete').classList.remove('hidden'); 
    document.getElementById('taskModal').classList.remove('hidden');
};
window.duplicateTask = () => { document.getElementById('taskId').value = ""; saveTask(); }

window.saveTask = async () => {
    const taskId = document.getElementById('taskId').value; const text = document.getElementById('taskText').value; const timeFrom = document.getElementById('taskTimeFrom').value; const timeTo = document.getElementById('taskTimeTo').value; const time = (timeFrom && timeTo) ? `${timeFrom} - ${timeTo}` : (timeFrom || ""); const isPriority = document.getElementById('taskPriority').checked; let catId = document.getElementById('taskCatSelect').value; const newName = document.getElementById('newCatName').value; const newColor = document.getElementById('newCatColor').value;
    if(!text) return alert("Bitte Text eingeben");
    try {
        if(newName.trim() !== "") { const cDoc = await addDoc(catRef, { name: newName, color: newColor }); catId = cDoc.id; }
        const baseData = { text, notes:"", time, timeFrom, timeTo, categoryId: catId, isPriority, subtasks: window.currentSubtasks, completed: false };
        if (window.selectedRecurDays.length > 0) { const batch = writeBatch(db); window.selectedRecurDays.forEach(dayName => { const newRef = doc(collection(db, 'tasks')); batch.set(newRef, { ...baseData, day: dayName }); }); await batch.commit(); } 
        else { if (taskId) await updateDoc(doc(db, 'tasks', taskId), baseData); else await addDoc(colRef, { ...baseData, day: document.getElementById('taskDay').value }); }
        window.closeModal(); 
    } catch(err) { alert("Fehler: " + err.message); }
};

window.deleteCategory = (id) => { window.openConfirm(async () => { await deleteDoc(doc(db, 'categories', id)); window.openCatManage(); }); };
window.openCatManage = () => { const list = document.getElementById('cat-manage-list'); list.innerHTML = Object.entries(allCategories).map(([id, cat]) => `<div class="flex justify-between p-4 bg-white/5 rounded-2xl mb-2"><div class="flex gap-2"><div class="w-4 h-4 rounded-full" style="background:${cat.color}"></div>${cat.name}</div><button onclick="deleteCategory('${id}')" class="text-red-400"><i data-lucide="trash-2"></i></button></div>`).join(''); document.getElementById('catManageModal').classList.remove('hidden'); lucide.createIcons(); };
window.closeCatManage = () => document.getElementById('catManageModal').classList.add('hidden');
window.toggleStatus = (id, s) => updateDoc(doc(db, 'tasks', id), { completed: !s });
window.deleteTask = (id) => { const targetId = id || document.getElementById('taskId').value; if(!targetId) return; window.openConfirm(async () => { await deleteDoc(doc(db, 'tasks', targetId)); closeModal(); }); };
window.closeModal = () => document.getElementById('taskModal').classList.add('hidden');

// Helper
function initGridStructure() {
    const now = new Date(); const monday = new Date(now.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1))); const weekDates = daysDisplay.map((name, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return { name, date: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) }; });
    document.getElementById('week-display').innerText = `${weekDates[0].date} - ${weekDates[6].date}`;
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = weekDates.map(d => `
        <div class="day-column flex-shrink-0 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col h-full backdrop-blur-sm relative" id="${d.name}">
            <div class="day-header-collapsed hidden flex-col items-center pt-8 h-full w-full" onclick="toggleColumn('${d.name}')"><span class="text-2xl font-black text-white/50 hover:text-white">${d.name.charAt(0)}</span><div class="mt-4 w-1 h-full bg-white/5 rounded-full"></div></div>
            <div class="day-header-expanded p-6 text-white cursor-pointer" onclick="toggleColumn('${d.name}')"><div class="flex justify-between items-start"><div><span class="text-xs font-bold text-gray-400">${d.date}</span><h2 class="text-2xl font-black hover:text-green-400 transition-colors">${d.name}</h2></div><div id="weather-${d.name}" class="flex flex-col items-end text-gray-400"></div></div><div class="h-1 bg-white/10 rounded-full mt-3 overflow-hidden"><div class="h-full bg-green-500 rounded-full w-0 transition-all duration-500" id="progress-${d.name}"></div></div></div>
            <div class="day-content flex-1 flex flex-col overflow-hidden"><div class="flex-1 p-4 overflow-y-auto no-scrollbar task-list space-y-3"></div><div class="p-4"><button onclick="openModal('${d.name}')" class="w-full py-4 bg-white/5 text-white rounded-2xl font-bold hover:bg-green-500 hover:text-black shadow-lg transition-all">+ NEU</button></div></div>
        </div>`).join('');
}

window.requestNotificationPermission = () => {
    if (!("Notification" in window)) { alert("Nicht unterstützt"); return; }
    if (Notification.permission === "granted") { alert("Bereits aktiv!"); document.getElementById('notify-btn').style.display = 'none'; return; }
    if (Notification.permission === "denied") { alert("Blockiert."); return; }
    Notification.requestPermission().then((p) => { if (p === "granted") { new Notification("Planner Pro", { body: "Aktiviert!" }); document.getElementById('notify-btn').style.display = 'none'; } });
};

window.openConfirm = (action) => { pendingConfirmAction = action; document.getElementById('confirmModal').classList.remove('hidden'); }
window.closeConfirm = () => { pendingConfirmAction = null; document.getElementById('confirmModal').classList.add('hidden'); }
document.getElementById('btnConfirmAction').onclick = () => { if(pendingConfirmAction) pendingConfirmAction(); closeConfirm(); }

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGridStructure); else initGridStructure();
