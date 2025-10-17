// =================================================================
// === SHORTS.JS - Lógica de Generación de Vídeos y Subida a YouTube
// =================================================================

// --- Imports desde main.js ---
import {
    slugify, callGeminiAPI, parseJsonResponse,
    openShortModal, closeShortModal,
    UNSPLASH_API_KEY, ELEVENLABS_API_KEY,
    googleTokenClient // Importa el cliente de token de Google
} from './main.js';

// --- DOM Elements locales ---
const shortModal = document.getElementById('short-modal');
const shortStatus = document.getElementById('short-status');
const shortResult = document.getElementById('short-result');
const shortCanvas = document.getElementById('short-canvas');


// =================================================================
// === FUNCIÓN PRINCIPAL Y DE RECUPERACIÓN (Exportadas)
// =================================================================

/**
 * Inicia el proceso de recuperación de un vídeo interrumpido.
 * @param {object} recoveryData - Los datos guardados en sessionStorage.
 */
export function handleRecoverShort(recoveryData) {
    if (recoveryData && recoveryData.script && recoveryData.youtubeMetadata) {
        console.log("Iniciando recuperación de vídeo...", recoveryData);
        openShortModal();
        shortStatus.textContent = 'Recuperando vídeo interrumpido...';
        // Llama a la función de creación de vídeo con los datos recuperados.
        createVideoFromScript(recoveryData.script, recoveryData.youtubeMetadata, recoveryData.categoria);
    } else {
        alert("Los datos de recuperación son inválidos o están corruptos.");
        sessionStorage.removeItem('videoRecoveryData');
    }
}


export async function handleCreateShort(noticia) {
    shortStatus.textContent = 'Preparando...';
    shortResult.innerHTML = '';

    if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY.startsWith("TU_API_KEY")) {
        alert("Error: Debes configurar tu 'ELEVENLABS_API_KEY' en main.js para generar la voz.");
        return;
    }

    openShortModal();

    try {
        // --- Paso 1: IA genera el guion para el vídeo ---
        shortStatus.textContent = '🤖 Creando guion con IA...';
        const scriptPrompt = `
            Actúa como un creador de contenido para vídeos cortos virales (estilo TikTok/Shorts).
            Basado en la siguiente noticia, genera un guion para un vídeo de 40 a 55 segundos.
            Devuelve únicamente un objeto JSON con la estructura:
            {
              "narration": "Un guion fluido y atractivo de 40-55 segundos.",
              "image_queries": [ "lista de exactamente 7 búsquedas de imágenes relevantes" ],
              "subtitles": [ "lista de fragmentos cortos de la narración para subtítulos" ]
            }
            NOTICIA: Título: ${noticia.titulo}, Resumen: ${noticia.resumen}`;

        const scriptResponseText = await callGeminiAPI(scriptPrompt);
        const script = parseJsonResponse(scriptResponseText, 'video-script');

        if (!script?.narration || !script.image_queries || script.image_queries.length !== 7 || !script.subtitles) {
            throw new Error("La IA no generó un guion de vídeo válido.");
        }

        // --- Paso 2: IA genera Título y Descripción para YouTube ---
        shortStatus.textContent = '🤖 Creando título y descripción para YouTube...';
        const youtubeMetaPrompt = `
            Actúa como un experto en SEO para YouTube.
            Basado en la siguiente noticia, genera metadatos para un YouTube Short.
            Devuelve únicamente un objeto JSON con la estructura:
            {
              "titulo": "Un título de YouTube Short (máx 100 caracteres), corto, impactante y con gancho.",
              "descripcion": "Una descripción (máx 5000 caracteres) que resuma la noticia. Incluye 3-5 hashtags relevantes (ej: #noticias, #${noticia.categoria.toLowerCase().replace(/\s+/g, '')})."
            }
            NOTICIA: Título: ${noticia.titulo}, Guion: ${script.narration}`;

        const metaResponseText = await callGeminiAPI(youtubeMetaPrompt);
        const youtubeMetadata = parseJsonResponse(metaResponseText, 'youtube-metadata');
        
        // --- NUEVO: Guardar datos de recuperación antes de renderizar ---
        try {
            const recoveryData = {
                script,
                youtubeMetadata,
                categoria: noticia.categoria
            };
            sessionStorage.setItem('videoRecoveryData', JSON.stringify(recoveryData));
        } catch (e) {
            console.warn("No se pudieron guardar los datos de recuperación. Si la página se reinicia, el progreso se perderá.", e);
        }

        // --- Paso 3: Renderizar y grabar el vídeo ---
        await createVideoFromScript(script, youtubeMetadata, noticia.categoria);

    } catch (error) {
        console.error('Error creando el short:', error);
        shortStatus.textContent = `Error: ${error.message}`;
        // Limpiar datos de recuperación si hay un error
        sessionStorage.removeItem('videoRecoveryData');
    }
}

// =================================================================
// === LÓGICA DE GENERACIÓN DE VÍDEO (Interna)
// =================================================================

async function createVideoFromScript(scriptData, youtubeMetadata, categoria) {
    const { narration, image_queries, subtitles } = scriptData;
    const canvas = shortCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let mediaRecorder;

    try {
        // 1. Descargar todos los recursos en paralelo
        shortStatus.textContent = 'Descargando recursos (1 audio, 7 imágenes)...';
        const [downloadedImages, audioBlob] = await Promise.all([
             Promise.all(image_queries.map(q => getImageUrl(q).then(url => loadImage(url)))),
             getTtsAudioBlob(narration)
        ]);

        // 2. Configurar MediaRecorder y AudioContext
        shortStatus.textContent = 'Preparando grabación y audio...';
        const videoStream = canvas.captureStream(30);
        const audioContext = new AudioContext();
        const audioDestination = audioContext.createMediaStreamDestination();
        const combinedStream = new MediaStream([...videoStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
        mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/mp4; codecs=avc1,mp4a.40.2' });

        const chunks = [];
        mediaRecorder.ondataavailable = e => chunks.push(e.data);

        mediaRecorder.onstop = () => {
            // --- NUEVO: Limpiar datos de recuperación al finalizar correctamente ---
            sessionStorage.removeItem('videoRecoveryData');
            
            const videoBlob = new Blob(chunks, { type: 'video/mp4' });
            const videoUrl = URL.createObjectURL(videoBlob);
            const filename = `${slugify(youtubeMetadata.titulo || 'video-short')}.mp4`;

            shortResult.innerHTML = `
                <h3 class="font-bold mb-2">¡Vídeo generado!</h3>
                <video src="${videoUrl}" controls class="w-full rounded-lg max-w-full"></video>
                <a href="${videoUrl}" download="${filename}" class="mt-4 inline-block bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg w-full text-center">
                    Descargar MP4
                </a>
                <button id="upload-youtube-btn" class="mt-2 w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">
                    Subir a YouTube
                </button>
            `;

            document.getElementById('upload-youtube-btn').addEventListener('click', () => {
                uploadToYouTube(videoBlob, youtubeMetadata, categoria);
            });

            shortStatus.textContent = '¡Listo para descargar o subir!';
            audioContext.close();
        };

        // 3. Decodificar audio y calcular duraciones
        const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
        const totalAudioDuration = audioBuffer.duration;
        const imageDuration = totalAudioDuration / downloadedImages.length;
        const subtitleDuration = totalAudioDuration / subtitles.length;

        // 4. Conectar y reproducir audio
        const audioSource = audioContext.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.connect(audioDestination);
        audioSource.start(0);
        mediaRecorder.start();

        // 5. Iniciar el bucle de renderizado
        let startTime = null;
        function renderLoop(timestamp) {
            if (!startTime) startTime = timestamp;
            const elapsedTime = (timestamp - startTime) / 1000;

            if (elapsedTime >= totalAudioDuration) {
                mediaRecorder.stop();
                return;
            }

            const imgIndex = Math.min(downloadedImages.length - 1, Math.floor(elapsedTime / imageDuration));
            const subIndex = Math.min(subtitles.length - 1, Math.floor(elapsedTime / subtitleDuration));
            drawScene(ctx, canvas.width, canvas.height, downloadedImages[imgIndex], subtitles[subIndex]);
            shortStatus.textContent = `Renderizando vídeo... ${elapsedTime.toFixed(1)}s / ${totalAudioDuration.toFixed(1)}s`;
            requestAnimationFrame(renderLoop);
        }
        requestAnimationFrame(renderLoop);

    } catch (error) {
        if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
        sessionStorage.removeItem('videoRecoveryData');
        throw error;
    }
}

// =================================================================
// === LÓGICA DE SUBIDA A YOUTUBE
// =================================================================

function uploadToYouTube(videoBlob, metadata, categoria) {
    if (!googleTokenClient || typeof gapi?.client?.youtube === 'undefined') {
        alert("Error: El cliente de Google API o de YouTube no está listo. Refresca la página e inténtalo de nuevo.");
        return;
    }

    const uploadButton = document.getElementById('upload-youtube-btn');
    uploadButton.disabled = true;
    uploadButton.textContent = 'Iniciando sesión...';
    shortStatus.textContent = 'Por favor, autoriza la subida en la ventana emergente de Google.';

    // Define el callback para cuando el token de acceso sea obtenido
    googleTokenClient.callback = (tokenResponse) => {
        if (tokenResponse.error) {
            console.error('Error de autenticación:', tokenResponse.error);
            alert(`Error de autenticación: ${tokenResponse.error_description || tokenResponse.error}`);
            uploadButton.disabled = false;
            uploadButton.textContent = 'Reintentar Subida a YouTube';
            shortStatus.textContent = 'Fallo en la autenticación.';
            return;
        }

        // Token obtenido, ahora podemos usar la API de YouTube
        uploadButton.textContent = 'Subiendo vídeo...';
        shortStatus.textContent = 'Enviando vídeo a YouTube. Esto puede tardar varios minutos...';
        
        const resource = {
            snippet: {
                title: metadata.titulo,
                description: metadata.descripcion,
                tags: [categoria.toLowerCase().replace(/\s+/g, ''), 'noticias', 'short'],
                categoryId: '25' // 25 es el ID para "Noticias y Política"
            },
            status: {
                privacyStatus: 'private' // Sube como 'privado'. Cambia a 'public' o 'unlisted' si lo deseas.
            }
        };

        const uploader = new MediaUploader({
            baseUrl: 'https://www.googleapis.com/upload/youtube/v3/videos',
            file: videoBlob,
            token: tokenResponse.access_token,
            metadata: resource,
            params: {
                part: Object.keys(resource).join(',')
            },
            onError: (error) => {
                console.error('Error durante la subida:', error);
                const errorBody = JSON.parse(error);
                alert(`Error al subir a YouTube: ${errorBody.error.message}`);
                uploadButton.disabled = false;
                uploadButton.textContent = 'Reintentar Subida a YouTube';
                shortStatus.textContent = 'Error durante la subida.';
            },
            onProgress: (progress) => {
                 const percentage = Math.round((progress.loaded / progress.total) * 100);
                 uploadButton.textContent = `Subiendo (${percentage}%)`;
            },
            onComplete: (response) => {
                const res = JSON.parse(response);
                console.log("Subida exitosa:", res);
                uploadButton.textContent = '¡Subido con Éxito!';
                uploadButton.classList.replace('bg-red-600', 'bg-gray-400');
                uploadButton.classList.replace('hover:bg-red-700', 'cursor-not-allowed');

                shortStatus.textContent = '¡Vídeo subido a YouTube!';
                shortResult.innerHTML += `
                    <p class="text-green-600 font-semibold mt-2 text-center">
                        <a href="https://youtu.be/${res.id}" target="_blank" class="underline">Ver en YouTube (ID: ${res.id})</a>
                    </p>`;
            }
        });
        
        uploader.upload();
    };

    // Solicita el token de acceso. Esto mostrará la ventana emergente de Google.
    googleTokenClient.requestAccessToken({ prompt: 'consent' });
}


// --- Lógica de la clase MediaUploader para subidas resumibles a Google API ---
// Esta clase es necesaria para gestionar la subida de archivos grandes.
class MediaUploader {
  constructor(options) {
    this.file = options.file;
    this.token = options.token;
    this.metadata = options.metadata || {};
    this.baseUrl = options.baseUrl;
    this.params = options.params || {};
    this.contentType = options.contentType || this.file.type || 'application/octet-stream';
    this.chunkSize = options.chunkSize || 1024 * 1024 * 5; // 5MB
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.offset = 0;
    this.retryHandler = new RetryHandler();
  }

  upload() {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', this.baseUrl, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
    xhr.setRequestHeader('X-Upload-Content-Length', this.file.size);
    xhr.setRequestHeader('X-Upload-Content-Type', this.contentType);

    xhr.onload = (e) => {
      if (e.target.status < 400) {
        const location = e.target.getResponseHeader('Location');
        this.url = location;
        this.sendFile_();
      } else {
        this.onError(e.target.response);
      }
    };
    xhr.onerror = (e) => this.onError(e.target.response);
    xhr.send(JSON.stringify(this.metadata));
  }

  sendFile_() {
    let content = this.file;
    let end = this.file.size;
    if (this.offset || this.chunkSize) {
      if (this.chunkSize) {
        end = Math.min(this.offset + this.chunkSize, this.file.size);
      }
      content = content.slice(this.offset, end);
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', this.url, true);
    xhr.setRequestHeader('Content-Type', this.contentType);
    xhr.setRequestHeader('Content-Range', 'bytes ' + this.offset + '-' + (end - 1) + '/' + this.file.size);
    xhr.setRequestHeader('X-Upload-Content-Type', this.file.type);
    if (xhr.upload) {
      xhr.upload.addEventListener('progress', this.onProgress);
    }
    xhr.onload = this.onContentUploadSuccess_.bind(this);
    xhr.onerror = this.onContentUploadError_.bind(this);
    xhr.send(content);
  }

  onContentUploadSuccess_(e) {
    if (e.target.status >= 200 && e.target.status < 300) {
      this.onComplete(e.target.response);
    } else if (e.target.status == 308) {
      this.offset = parseInt(e.target.getResponseHeader('Range').match(/\d+/g).pop(), 10) + 1;
      this.retryHandler.reset();
      this.sendFile_();
    } else {
      this.onContentUploadError_(e);
    }
  }
  
  onContentUploadError_(e) {
    if (this.retryHandler.retry(this.sendFile_.bind(this))) {
      return;
    }
    this.onError(e.target.response);
  }
}

class RetryHandler {
  constructor() {
    this.interval = 1000;
    this.maxRetries = 5;
    this.retries = 0;
  }
  retry(fn) {
    if (this.retries < this.maxRetries) {
      setTimeout(() => fn(), this.interval);
      this.interval *= 2;
      this.retries++;
      return true;
    }
    return false;
  }
  reset() {
    this.interval = 1000;
    this.retries = 0;
  }
}


// =================================================================
// === FUNCIONES DE AYUDA (Helpers)
// =================================================================

// --- Funciones de Dibujo en Canvas ---
function drawScene(ctx, width, height, image, text) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    if(!image) return; // Si la imagen aún no ha cargado, no la dibujes

    // Lógica para hacer zoom y centrar la imagen
    const zoom = 1.2;
    const imgRatio = image.width / image.height;
    const canvasRatio = width / height;
    let sw, sh, sx, sy;
    if (imgRatio > canvasRatio) {
        sh = image.height; sw = sh * canvasRatio; sx = (image.width - sw) / 2; sy = 0;
    } else {
        sw = image.width; sh = sw / canvasRatio; sx = 0; sy = (image.height - sh) / 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, -width * (zoom - 1) / 2, -height * (zoom - 1) / 2, width * zoom, height * zoom);
    
    // Fondo para subtítulos
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, height * 0.65, width, height * 0.35);

    // Texto de subtítulos
    ctx.fillStyle = 'white';
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapText(ctx, text, width / 2, height * 0.8, width - 60, 40);
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (const word of words) {
        const testLine = line + word + ' ';
        const testWidth = context.measureText(testLine).width;
        if (testWidth > maxWidth && line.length > 0) {
            lines.push(line.trim());
            line = word + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());

    const startY = y - (lineHeight * (lines.length - 1)) / 2;
    for (let i = 0; i < lines.length; i++) {
        context.fillText(lines[i], x, startY + (i * lineHeight));
    }
}


// --- Funciones de Obtención de Recursos ---
async function getImageUrl(query) {
    let imageUrl = `https://placehold.co/480x854/2d3748/ffffff?text=${encodeURIComponent(query)}`;
    try {
        const response = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`, {
            headers: { 'Authorization': `Client-ID ${UNSPLASH_API_KEY}` }
        });
        if (response.ok) {
            const data = await response.json();
            if (data.results?.length > 0) {
                imageUrl = data.results[0].urls.regular;
            }
        }
    } catch (e) { console.warn("No se pudo obtener imagen de Unsplash, usando placeholder."); }
    return imageUrl;
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = (err) => {
            console.error(`Error al cargar la imagen: ${url}`, err);
            reject(err);
        };
        img.src = url;
    });
}

async function getTtsAudioBlob(text) {
    const ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Voz de "Adam"
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
            'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Error en la API de ElevenLabs: ${errorData.detail?.message || response.statusText}`);
    }
    return await response.blob();
}


// =================================================================
// === INICIALIZACIÓN DE LISTENERS (Exportada)
// =================================================================

export function initializeShortsListeners() {
    document.getElementById('close-short-modal-btn').addEventListener('click', closeShortModal);
    shortModal.querySelector('.modal-overlay').addEventListener('click', closeShortModal);
}

