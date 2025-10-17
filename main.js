// =================================================================
// === MAIN.JS - Orquestador Principal
// =================================================================

// --- Imports de Firebase ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

// --- Imports de Módulos Locales ---
import { initializeNoticiasListeners, handleEdit, handleDelete, prepareNewNews } from './noticias.js';
// AÑADIDO: Importar la nueva función de recuperación
import { initializeShortsListeners, handleCreateShort, handleRecoverShort } from './shorts.js';

// =================================================================
// === CONFIGURACIÓN Y EXPORTACIONES GLOBALES
// =================================================================

// --- Configuración de Firebase ---
export const firebaseConfig = {
    apiKey: "AIzaSyAfK_AOq-Pc2bzgXEzIEZ1ESWvnhMJUvwI",
    authDomain: "enraya-51670.firebaseapp.com",
    databaseURL: "https://enraya-51670-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "enraya-51670",
    storageBucket: "enraya-51670.firebasestorage.app",
    messagingSenderId: "103343380727",
    appId: "1:103343380727:web:b2fa02aee03c9506915bf2",
    measurementId: "G-2G31LLJY1T"
};

// --- API Keys (Exportadas para otros módulos) ---
export const GEMINI_API_KEY = "AIzaSyAsNaND7sFvxAFyAKASUdXhkH6goiJOZ7s";
export const GOOGLE_SEARCH_API_KEY = "AIzaSyBppsbpyFv647_fnFOmlw9RgwROwz-aVlY";
export const GOOGLE_SEARCH_CX = "6778d5bd655094965";
export const UNSPLASH_API_KEY = "VbJ9cEbyofis4p1aNQE4ADO2KyZqA8gQGVtOKRe6nbs";
export const ELEVENLABS_API_KEY = "45cb9876345659b3baf2c201b8e4e00b";
export const GOOGLE_OAUTH_CLIENT_ID = "568351512590-jmpnp09acha4h12g55fk9c3e06djephj.apps.googleusercontent.com";

// --- Inicialización de Firebase (Exportada) ---
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const newsRef = ref(db, 'noticias');

// --- Cliente de Google (Exportado para shorts.js) ---
export let googleTokenClient = null;

// --- DOM Elements (Locales a main.js) ---
const newsList = document.getElementById('news-list');
const loading = document.getElementById('loading');
const newsModal = document.getElementById('news-modal');
const shortModal = document.getElementById('short-modal');

// =================================================================
// === FUNCIONES UTILITARIAS COMPARTIDAS (Exportadas)
// =================================================================

export function slugify(text) {
    const a = 'àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõőṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;'
    const b = 'aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrsssssttuuuuuuuuuwxyyzzz------'
    const p = new RegExp(a.split('').join('|'), 'g')
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-').replace(p, c => b.charAt(a.indexOf(c)))
        .replace(/&/g, '-and-').replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
}

export const callGeminiAPI = async (prompt) => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Error en la API de Gemini: ${response.statusText} - ${errorBody}`);
    }
    const data = await response.json();
    if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content || !data.candidates[0].content.parts || data.candidates[0].content.parts.length === 0) {
        console.error("Respuesta inesperada de la API de Gemini:", data);
        throw new Error("La IA no devolvió contenido válido. Revisa la consola para más detalles.");
    }
    const text = data.candidates[0].content.parts[0].text;
    return text;
};

export const parseJsonResponse = (text, type) => {
    const jsonMatch = text.match(/{[\s\S]*}/);
    if (!jsonMatch) {
         console.error(`Respuesta sin JSON para '${type}':`, text);
        throw new Error(`La IA no devolvió un JSON válido para '${type}'.`);
    }
    try {
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
         console.error(`Error al parsear JSON para '${type}':`, jsonMatch[0]);
         throw new Error(`Error al procesar la respuesta de la IA para '${type}': ${e.message}`);
    }
};

// =================================================================
// === LÓGICA DE MODALES (Exportada)
// =================================================================

export const openNewsModal = () => newsModal.classList.remove('hidden');
export const closeNewsModal = () => newsModal.classList.add('hidden');
export const openShortModal = () => shortModal.classList.remove('hidden');
export const closeShortModal = () => shortModal.classList.add('hidden');

// =================================================================
// === LÓGICA CENTRAL DE LA APLICACIÓN
// =================================================================

onValue(newsRef, (snapshot) => {
    loading.style.display = 'none';
    newsList.innerHTML = '';
    const data = snapshot.val();
    if (data) {
        Object.values(data)
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
            .forEach(noticia => newsList.appendChild(createNewsCard(noticia)));
    } else {
        newsList.innerHTML = '<p class="col-span-full text-center text-gray-500">No hay noticias.</p>';
    }
});

function createNewsCard(noticia) {
    const card = document.createElement('div');
    card.className = "bg-white rounded-lg shadow-lg overflow-hidden flex flex-col";
    card.innerHTML = `
        <img class="h-48 w-full object-cover" src="${noticia.imagen}" alt="${noticia.titulo}" crossorigin="anonymous">
        <div class="p-6 flex flex-col flex-grow">
            <div class="flex-grow">
                <span class="text-xs font-semibold ${noticia.estado === 'publicado' ? 'text-green-600 bg-green-100' : 'text-yellow-600 bg-yellow-100'} py-1 px-2 rounded-full">${noticia.estado}</span>
                <h3 class="font-bold text-xl my-2">${noticia.titulo}</h3>
                <p class="text-gray-600 text-sm">${noticia.resumen}</p>
            </div>
            <div class="mt-4 pt-4 border-t border-gray-200 flex justify-end space-x-2">
                <button class="short-btn bg-purple-500 hover:bg-purple-600 text-white font-bold py-1 px-3 rounded-lg text-sm">Crear Short</button>
                <button class="edit-btn bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-1 px-3 rounded-lg text-sm">Editar</button>
                <button class="delete-btn bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded-lg text-sm">Eliminar</button>
            </div>
        </div>`;
    
    card.querySelector('.edit-btn').addEventListener('click', () => handleEdit(noticia));
    card.querySelector('.delete-btn').addEventListener('click', () => handleDelete(noticia.id, noticia.titulo));
    card.querySelector('.short-btn').addEventListener('click', () => handleCreateShort(noticia));
    return card;
}

// =================================================================
// === INICIALIZACIÓN Y LÓGICA DE RECUPERACIÓN
// =================================================================

/**
 * Comprueba si hay datos de recuperación en sessionStorage y pregunta al usuario si quiere restaurar.
 */
function checkForRecovery() {
    const recoveryDataString = sessionStorage.getItem('videoRecoveryData');
    if (recoveryDataString) {
        try {
            const recoveryData = JSON.parse(recoveryDataString);
            if (confirm("Se ha detectado un vídeo que no se terminó de procesar debido a un reinicio. ¿Quieres intentar recuperarlo ahora?")) {
                handleRecoverShort(recoveryData);
            } else {
                // Si el usuario no quiere recuperar, se borran los datos para no volver a preguntar.
                sessionStorage.removeItem('videoRecoveryData');
            }
        } catch (e) {
            console.error("Error al parsear los datos de recuperación:", e);
            sessionStorage.removeItem('videoRecoveryData');
        }
    }
}

function initializeGoogleClients() {
    if (!GOOGLE_OAUTH_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID.startsWith("TU_ID")) {
        console.warn("ADVERTENCIA: GOOGLE_OAUTH_CLIENT_ID no está configurado. La subida a YouTube no funcionará.");
        return;
    }

    const checkGapi = setInterval(() => {
        if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
            clearInterval(checkGapi);
            
            gapi.load('client', async () => {
                try {
                    await gapi.client.init({
                        apiKey: GOOGLE_SEARCH_API_KEY,
                        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest'],
                    });
                    console.log('Cliente de GAPI (YouTube) inicializado.');
                } catch (error) {
                    console.error('Error inicializando gapi.client:', error);
                }
            });

            try {
                googleTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_OAUTH_CLIENT_ID,
                    scope: 'https://www.googleapis.com/auth/youtube.upload',
                    callback: () => {},
                });
                console.log('Cliente de Token de Google (GSI) inicializado.');
            } catch (error) {
                console.error('Error inicializando google.accounts.oauth2:', error);
            }
        }
    }, 100);
}

function initializeAppListeners() {
    document.getElementById('add-news-btn').addEventListener('click', () => {
        prepareNewNews();
        document.getElementById('modal-title').innerText = 'Añadir Nueva Noticia';
        document.getElementById('fecha').valueAsDate = new Date();
        openNewsModal();
    });
    
    document.getElementById('close-modal-btn').addEventListener('click', closeNewsModal);
    document.getElementById('cancel-btn').addEventListener('click', closeNewsModal);
    newsModal.querySelector('.modal-overlay').addEventListener('click', closeNewsModal);

    initializeNoticiasListeners();
    initializeShortsListeners();
    initializeGoogleClients();
    checkForRecovery(); // Comprobar si hay algo que recuperar al cargar la app
}

// --- NUEVO: Vigilantes de errores globales para facilitar la depuración ---
window.addEventListener('error', function(event) {
    console.error('ERROR GLOBAL NO CAPTURADO:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
    });
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('RECHAZO DE PROMESA NO MANEJADO:', event.reason);
});


// Iniciar la aplicación
initializeAppListeners();

