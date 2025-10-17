// =================================================================
// === NOTICIAS.JS - Lógica de CRUD de Noticias y Generación IA
// =================================================================

// --- Imports de Firebase ---
import { ref, set, remove, get } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

// --- Imports desde main.js ---
import { 
    db, newsRef, slugify, callGeminiAPI, parseJsonResponse,
    openNewsModal, closeNewsModal, 
    GEMINI_API_KEY, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX, UNSPLASH_API_KEY 
} from './main.js';

// --- Estado local del módulo ---
let currentEditingId = null;

// --- DOM Elements locales ---
const form = document.getElementById('news-form');
const aiTopicInput = document.getElementById('ai-topic');
const generateAiBtn = document.getElementById('generate-ai-btn');
const aiBtnText = document.getElementById('ai-btn-text');
const aiLoader = document.getElementById('ai-loader');

// =================================================================
// === FUNCIONES EXPORTADAS (Usadas por main.js)
// =================================================================

// --- Prepara el modal para una nueva noticia ---
export function prepareNewNews() {
    form.reset();
    currentEditingId = null;
}

// --- Maneja la edición de una noticia ---
export function handleEdit(noticia) {
    currentEditingId = noticia.id;
    document.getElementById('modal-title').innerText = 'Editar Noticia';
    document.getElementById('titulo').value = noticia.titulo;
    document.getElementById('categoria').value = noticia.categoria;
    document.getElementById('autor').value = noticia.autor;
    document.getElementById('fecha').value = noticia.fecha;
    document.getElementById('imagen').value = noticia.imagen;
    document.getElementById('estado').value = noticia.estado;
    document.getElementById('resumen').value = noticia.resumen;
    document.getElementById('contenido').value = noticia.contenido;
    openNewsModal();
}

// --- Maneja la eliminación de una noticia ---
export function handleDelete(id, titulo) {
    if (confirm(`¿Estás seguro de que quieres eliminar "${titulo}"?`)) {
        remove(ref(db, `noticias/${id}`)).then(() => alert('Noticia eliminada.'));
    }
}

// =================================================================
// === LÓGICA INTERNA DEL MÓDULO
// =================================================================

// --- Guardar o Actualizar Noticia (Submit del Formulario) ---
async function handleFormSubmit(e) {
    e.preventDefault();
    const titulo = document.getElementById('titulo').value.trim();
    if (!titulo) {
        alert('El título es obligatorio.');
        return;
    }
    const newId = slugify(titulo); 
    const noticiaData = {
        id: newId,
        titulo: document.getElementById('titulo').value,
        categoria: document.getElementById('categoria').value,
        autor: document.getElementById('autor').value,
        fecha: document.getElementById('fecha').value,
        imagen: document.getElementById('imagen').value,
        estado: document.getElementById('estado').value,
        resumen: document.getElementById('resumen').value,
        contenido: document.getElementById('contenido').value,
    };
    const processSave = () => {
        set(ref(db, `noticias/${newId}`), noticiaData).then(() => {
            if (currentEditingId && currentEditingId !== newId) {
                remove(ref(db, `noticias/${currentEditingId}`));
            }
            closeNewsModal();
        }).catch(err => alert('Error al guardar: ' + err.message));
    };
    if (newId !== currentEditingId) {
         get(ref(db, `noticias/${newId}`)).then(snapshot => {
            if (snapshot.exists()) {
                alert('Error: Ya existe una noticia con un título similar. Por favor, elige un título único.');
            } else {
                processSave();
            }
        });
    } else {
        processSave();
    }
}

// --- Carga Inicial de Datos (Botón Oculto) ---
async function handleInitialLoad() {
    if (!confirm('¿Seguro? Esto borrará las noticias actuales y las reemplazará con el contenido del JSON inicial.')) return;
    try {
        await set(ref(db, 'noticias'), null);
        const noticiasJSON = [{"id":1,"categoria":"ECONOMÍA","titulo":"El Puerto de Motril cierra el trimestre con un récord en el tráfico de mercancías","resumen":"La actividad portuaria se dispara gracias a la exportación de productos hortofrutícolas y la importación de graneles, consolidando su posición estratégica.","imagen":"https://placehold.co/800x600/3498db/ffffff?text=Puerto+de+Motril","fecha":"2025-09-27","autor":"Redacción","estado":"publicado","contenido":"<p><strong>La Autoridad Portuaria de Motril ha presentado hoy los datos correspondientes al último trimestre, revelando cifras históricas que consolidan a la dársena granadina como un punto neurálgico en el comercio del Mediterráneo.</strong></p>"},{"id":2,"categoria":"AGRICULTURA","titulo":"La campaña del pepino holandés arranca con optimismo en la Costa Tropical","resumen":"Los agricultores esperan una temporada de precios estables y alta demanda europea.","imagen":"https://placehold.co/600x400/2ecc71/ffffff?text=Agricultura","fecha":"2025-09-26","autor":"Ana López","estado":"publicado","contenido":"<p><strong>Los agricultores de la Costa Tropical han comenzado la siembra de pepino tipo holandés con perspectivas muy positivas.</strong></p>"}];
        const updates = {};
        noticiasJSON.forEach(noticia => {
            const slug = slugify(noticia.titulo);
            noticia.id = slug;
            updates[slug] = noticia;
        });
        await set(ref(db, 'noticias'), updates);
        alert('¡Datos iniciales cargados con éxito usando slugs como IDs!');
    } catch (error) {
        console.error('Error al cargar datos iniciales:', error);
        alert('Hubo un error al cargar los datos.');
    }
}

// --- Lógica de Generación de Contenido con IA ---
const updateAiButtonState = (text, isLoading) => {
    aiBtnText.textContent = text;
    aiBtnText.classList.toggle('hidden', isLoading);
    aiLoader.classList.toggle('hidden', !isLoading);
    generateAiBtn.disabled = isLoading;
};

async function handleAiGeneration() {
     const topic = aiTopicInput.value.trim();
    if (!topic) {
        alert('Por favor, introduce un tema para la noticia.');
        return;
    }

    if (!GEMINI_API_KEY.startsWith("AIza") || !GOOGLE_SEARCH_API_KEY.startsWith("AIza") || UNSPLASH_API_KEY === "YOUR_UNSPLASH_API_KEY") {
        alert('Error: Debes configurar tus API Keys de Gemini, Google Search y Unsplash en el script.');
        return;
    }

    const isNewsMode = document.getElementById('mode-news').checked;

    try {
        let searchQueries;
        let fullArticleHtml;

        if (isNewsMode) {
            updateAiButtonState('Pensando (N)...', true);
            const searchGenPrompt = `Actúa como un periodista de agencia de noticias. Para el tema "${topic}", genera las 5 mejores consultas de búsqueda para Google. Deben estar enfocadas en encontrar hechos, datos recientes y declaraciones oficiales (qué, quién, cuándo, dónde, por qué). Devuelve únicamente un objeto JSON con la estructura {"queries": ["query1", "query2", "query3", "query4", "query5"]}.`;
            const searchGenResponseText = await callGeminiAPI(searchGenPrompt);
            searchQueries = parseJsonResponse(searchGenResponseText, 'search-queries-news').queries;

            updateAiButtonState('Buscando (N)...', true);
            const searchPromises = searchQueries.map(q => fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(q)}`).then(res => res.json()));
            const searchResults = await Promise.all(searchPromises);
            const searchSnippets = searchResults.flatMap(r => r.items || []).slice(0, 15).map(item => item.snippet).join('\n---\n');
            if (searchSnippets.length === 0) throw new Error("No se encontraron resultados de búsqueda recientes.");

            updateAiButtonState('Planificando (N)...', true);
            const planPrompt = `Actúa como editor jefe de una sección de noticias. Basado en esta información sobre "${topic}", crea un plan para una noticia siguiendo la estructura de pirámide invertida. La parte 1 debe ser el titular y el párrafo de entrada (lead), resumiendo lo más importante. La parte 2 debe desarrollar el cuerpo de la noticia con más detalles y contexto. La parte 3 debe aportar datos secundarios o declaraciones. Devuelve solo un JSON con la estructura {"part1_instruction": "...", "part2_instruction": "...", "part3_instruction": "..."}. Información de búsqueda: ${searchSnippets}`;
            const planResponseText = await callGeminiAPI(planPrompt);
            const articlePlan = parseJsonResponse(planResponseText, 'plan-news');

            let articlePartsHtml = "";
            for (let i = 1; i <= 3; i++) {
                updateAiButtonState(`Redactando ${i}/3`, true);
                const writePrompt = `Actúa como un periodista escribiendo una noticia de última hora sobre "${topic}". Sé factual, directo y conciso. Escribe la PARTE ${i} de la noticia, siguiendo esta instrucción: "${articlePlan[`part${i}_instruction`]}". Usa el contexto de las partes ya escritas si existen. No inventes datos, cíñete a la información de búsqueda. Devuelve solo el HTML. Partes ya escritas: ${articlePartsHtml}. Información de búsqueda de referencia: ${searchSnippets}`;
                const partHtml = await callGeminiAPI(writePrompt);
                articlePartsHtml += partHtml + "\n";
            }
            fullArticleHtml = articlePartsHtml;
        } else {
            // ... (Lógica para modo Artículo, copiada del original)
            updateAiButtonState('Pensando (A)...', true);
            const searchGenPrompt = `Actúa como un documentalista experto. Para el tema "${topic}", genera las 5 mejores y más distintas consultas de búsqueda para Google con el fin de recopilar información completa para un artículo periodístico en profundidad. Devuelve únicamente un objeto JSON con la estructura {"queries": ["query1", "query2", "query3", "query4", "query5"]}.`;
            const searchGenResponseText = await callGeminiAPI(searchGenPrompt);
            searchQueries = parseJsonResponse(searchGenResponseText, 'search-queries-article').queries;

            updateAiButtonState('Buscando (A)...', true);
            const searchPromises = searchQueries.map(q => fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(q)}`).then(res => res.json()));
            const searchResults = await Promise.all(searchPromises);
            const searchSnippets = searchResults.flatMap(r => r.items || []).slice(0, 15).map(item => item.snippet).join('\n---\n');
            if (searchSnippets.length === 0) throw new Error("No se encontraron resultados de búsqueda relevantes.");
            
            updateAiButtonState('Planificando (A)...', true);
            const planPrompt = `Basado en la información de búsqueda sobre "${topic}", crea un plan para un artículo en 3 partes. Devuelve solo un JSON {"part1_instruction": "...", "part2_instruction": "...", "part3_instruction": "..."}. Información: ${searchSnippets}`;
            const planResponseText = await callGeminiAPI(planPrompt);
            const articlePlan = parseJsonResponse(planResponseText, 'plan');

            let articlePartsHtml = "";
            for (let i = 1; i <= 3; i++) {
                updateAiButtonState(`Redactando ${i}/3`, true);
                const writePrompt = `Escribe la PARTE ${i} de un artículo sobre "${topic}", siguiendo la instrucción: "${articlePlan[`part${i}_instruction`]}". Contexto de partes anteriores: ${articlePartsHtml}. Información de búsqueda: ${searchSnippets}. Devuelve solo el HTML.`;
                const partHtml = await callGeminiAPI(writePrompt);
                articlePartsHtml += partHtml + "\n";
            }
            fullArticleHtml = articlePartsHtml;
        }
        
        updateAiButtonState('Creando detalles...', true);
        const metadataPrompt = `Actúa como un editor. Basado en el siguiente texto, genera metadatos. El tono del título y resumen debe ser ${isNewsMode ? "'directo e informativo de última hora'" : "'atractivo y profundo'"}. Devuelve únicamente un objeto JSON con la siguiente estructura: {"titulo": "...", "resumen": "...", "categoria": "...", "keywords": "3 o 4 palabras clave para buscar una imagen"}. Texto completo: ${fullArticleHtml}`;
        const metadataResponseText = await callGeminiAPI(metadataPrompt);
        const articleMetadata = parseJsonResponse(metadataResponseText, 'metadata');

        updateAiButtonState('Buscando imagen...', true);
        let imageUrl = `https://placehold.co/600x400/cccccc/ffffff?text=${encodeURIComponent(articleMetadata.categoria)}`;
        const unsplashResponse = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(articleMetadata.keywords)}&per_page=1&orientation=landscape`, {
            headers: { 'Authorization': `Client-ID ${UNSPLASH_API_KEY}` }
        });
        if (unsplashResponse.ok) {
            const unsplashData = await unsplashResponse.json();
            if (unsplashData.results && unsplashData.results.length > 0) {
                imageUrl = unsplashData.results[0].urls.regular;
            }
        }
        
        document.getElementById('titulo').value = articleMetadata.titulo;
        document.getElementById('resumen').value = articleMetadata.resumen;
        document.getElementById('categoria').value = articleMetadata.categoria.toUpperCase();
        document.getElementById('contenido').value = fullArticleHtml;
        document.getElementById('imagen').value = imageUrl;
        document.getElementById('autor').value = 'Redacción IA';

        updateAiButtonState('¡Listo!', false);
        aiBtnText.textContent = 'Generar';

    } catch (error) {
        console.error('Error generando con IA:', error);
        alert('Ocurrió un error al generar: ' + error.message);
        updateAiButtonState('Reintentar', false);
    }
}


// =================================================================
// === INICIALIZACIÓN DE LISTENERS (Exportada)
// =================================================================

export function initializeNoticiasListeners() {
    // Listener para el formulario de guardar/editar
    form.addEventListener('submit', handleFormSubmit);
    
    // Listener para el botón de generar con IA
    generateAiBtn.addEventListener('click', handleAiGeneration);
    
    // Listener para el botón de carga inicial
    document.getElementById('initial-load-btn').addEventListener('click', handleInitialLoad);
}