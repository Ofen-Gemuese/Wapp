import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, updateDoc, doc, query, orderBy, writeBatch, getDocs, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

console.log("Script wird geladen..."); // Prüfung 1

// CONFIG
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

// Globals für HTML Zugriff
window.currentSubtasks = [];
window.selectedRecurDays = [];
const daysDisplay = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
let currentTheme = localStorage.getItem('plannerTheme') || 'cosmic';

try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    colRef = collection(db, 'tasks');
    catRef = collection(db, 'categories');
    arcRef = collection(db, 'week_archives');
    metaDocRef = doc(db, 'settings', 'weekInfo');
    console.log("Firebase erfolgreich verbunden!"); // Prüfung 2
    initApp();
} catch(e) { 
    console.error("Firebase Fehler:", e); 
    alert("Datenbank Fehler: " + e.message);
}

function initApp() {
    applyTheme(currentTheme);
    setupRealtimeListeners();
    fetchWeather();
    checkWeekStatus();
    
    // Notification Button Check
    if ("Notification" in window && Notification.permission === "granted") {
        const btn = document.getElementById('notify-btn');
        if(btn) btn.style.display = 'none';
    }
}

// THEME LOGIC
function applyTheme(themeName) {
    console.log("Wende Theme an:", themeName);
    const linkTag = document.getElementById('theme-stylesheet');
    if(linkTag) {
        // Pfad sicherstellen
        linkTag.href = `./css/${themeName}.css`;
    } else {
        console.error("Theme Stylesheet Link nicht gefunden! ID 'theme-stylesheet' fehlt in index.html");
    }
}

window.toggleTheme = () => {
    if(currentTheme === 'cosmic') currentTheme = 'aurora';
    else if(currentTheme === 'aurora') currentTheme = 'midnight';
    else currentTheme = 'cosmic';
    
    localStorage.setItem('plannerTheme', currentTheme);
    applyTheme(currentTheme);
    
    if(!document.getElementById('dashboardModal').classList.contains('hidden')) {
         window.openLiveDashboard(); 
    }
};

// ... RESTLICHER CODE (Exakt wie zuvor, hier verkürzt für Übersichtlichkeit) ...
// Füge hier den gesamten Rest des vorherigen script.js Codes ein (SetupListeners, CRUD, etc.)

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

// RESTLICHE FUNKTIONEN (kopieren vom vorherigen script.js, keine Änderungen nötig)
// ... (getCurrentMondayDate, checkWeekStatus, generateStatsObject, fetchWeather, UI Functions, CRUD) ...
// Hier der Einfachheit halber der wichtigste Teil für den Kalender Render:

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
        
        // Sortierung
        dayTasks.sort((a, b) => { 
            const timeA = a.timeFrom || a.time || "23:59"; 
            const timeB = b.timeFrom || b.time || "23:59"; 
            return timeA.localeCompare(timeB); 
        });
        
        // Drag Events
        col.ondragover = (e) => { e.preventDefault(); col.classList.add('drag-over'); }; 
        col.ondragleave = (e) => { col.classList.remove('drag-over'); }; 
        col.ondrop = (e) => handleDrop(e, day);
        
        list.innerHTML = dayTasks.map(t => {
            const cat = allCategories[t.categoryId] || { color: 'transparent', name: '' }; 
            const displayTime = t.time || ""; 
            
            // Subtask Info
            let subInfo = ''; 
            if(t.subtasks && t.subtasks.length > 0) { 
                const d = t.subtasks.filter(s => s.done).length; 
                const p = Math.round((d/t.subtasks.length)*100); 
                subInfo = `<div class="mt-2 h-1 bg-white/10 rounded-full overflow-hidden"><div class="h-full bg-green-500" style="width:${p}%"></div></div>`; 
            }
            
            const prioStyle = t.isPriority ? 'border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'border-white/10'; 
            const prioIcon = t.isPriority ? '🔥 ' : '';
            
            return `<div draggable="true" ondragstart="handleDragStart(event, '${t.id}', '${day}')" class="task-card ${t.completed ? 'completed opacity-50' : ''} p-4 mb-3 rounded-2xl bg-white/5 border ${prioStyle} relative group cursor-pointer hover:bg-white/10 transition-all" onclick="toggleTaskDetails(this)">
                <div class="flex items-start gap-3 mb-1">
                    <button onclick="event.stopPropagation(); toggleStatus('${t.id}', ${t.completed})" class="mt-0.5 text-green-400 hover:scale-110 transition-transform flex-shrink-0"><i data-lucide="${t.completed ? 'check-circle' : 'circle'}" class="w-5 h-5"></i></button>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-2">
                            <span class="text-xs font-mono text-green-400 font-bold shrink-0">${displayTime}</span>
                            <h3 class="text-sm font-semibold text-white leading-tight break-words">${prioIcon}${t.text || "Ohne Titel"}</h3>
                        </div>
                        ${t.categoryId ? `<div class="inline-flex items-center gap-1.5 mt-2 px-2 py-1 rounded-md border border-white/10 bg-white/5 w-auto self-start"><div class="w-2 h-2 rounded-full flex-shrink-0" style="background: ${cat.color}"></div><span class="text-[10px] font-bold text-gray-300 uppercase tracking-wider truncate max-w-[120px]">${cat.name}</span></div>` : ''}
                        ${subInfo}
                    </div>
                    <div class="flex flex-col gap-2">
                        <button onclick="event.stopPropagation(); editTask('${t.id}')" class="text-blue-400/30 hover:text-blue-400 transition-colors flex-shrink-0"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                        <button onclick="event.stopPropagation(); deleteTask('${t.id}')" class="text-red-400/30 hover:text-red-400 transition-colors flex-shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </div>
                <div class="task-details-wrapper"><div class="task-details-inner pl-8 pr-2 pb-2">
                    ${t.subtasks && t.subtasks.length ? `<div class="space-y-1 mt-2">${t.subtasks.map((s, index) => `<div class="flex gap-2 items-center p-1 rounded cursor-pointer hover:bg-white/5 transition-colors" onclick="event.stopPropagation(); toggleCardSubtask('${t.id}', ${index})"><i class="w-4 h-4 text-white/70" data-lucide="${s.done ? 'check-square' : 'square'}"></i><span class="text-xs text-white/80 ${s.done ? 'line-through opacity-50' : 'font-medium'}">${s.text}</span></div>`).join('')}</div>` : ''}
                </div></div>
            </div>`;
        }).join('');
    });
    if (window.lucide) lucide.createIcons();
}

// ==========================================
// FEHLENDE HELFER-FUNKTIONEN
// (Bitte ans Ende der script.js kopieren)
// ==========================================

// 1. WETTER API
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
        
        // Kalender neu zeichnen, um Wetter anzuzeigen
        renderCalendar(currentTasks);
        console.log("Wetter geladen");
    } catch(e) { 
        console.warn("Wetter Fehler (nicht kritisch):", e); 
    }
}

// 2. WOCHEN-CHECK & ARCHIVIERUNG
function getCurrentMondayDate() {
    const d = new Date(); 
    const day = d.getDay(); 
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
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
                console.log("Neue Woche erkannt!");
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
                alert("Neue Woche hat begonnen! Deine alte Woche wurde archiviert.");
            }
        }
    } catch(e) { console.error("Auto-Archive Error", e); }
}

// 3. STATISTIK BERECHNUNG
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
