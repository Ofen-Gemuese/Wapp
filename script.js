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

// (Hier fehlen noch die restlichen Helper Functions aus dem vorherigen Script.js wie toggleCardSubtask, CRUD, InitGridStructure - BITTE EINFÜGEN WIE IM VORHERIGEN SCHRITT)
// Damit das Script nicht zu lang wird, hier der Hinweis: 
// Kopiere ALLE Funktionen ab "window.toggleCardSubtask" bis zum Ende "initGridStructure()" vom vorherigen Antwort-Block hier rein.