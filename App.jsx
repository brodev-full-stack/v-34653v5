import { useState, useEffect } from 'react';
import { Bot, Loader2, Wand2, File, Trash2, FileUp, Download } from 'lucide-react';
import { marked } from 'marked';

// Helper function to sanitize and dangerously set inner HTML
function createMarkup(htmlString) {
  return { __html: htmlString };
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [documentContent, setDocumentContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const [fileName, setFileName] = useState('');
  const [pdfjsLib, setPdfjsLib] = useState(null);
  const [mermaidLib, setMermaidLib] = useState(null);
  const [jspdfLib, setJspdfLib] = useState(null);
  const [html2canvasLib, setHtml2canvasLib] = useState(null);

  // Load external libraries dynamically
  useEffect(() => {
    const loadScript = (src, onloadCallback) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = onloadCallback;
      document.body.appendChild(script);
    };

    // Load PDF.js for PDF context
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js', () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
      setPdfjsLib(window.pdfjsLib);
    });

    // Load Mermaid.js for diagrams
    loadScript('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js', () => {
      window.mermaid.initialize({ startOnLoad: false, theme: 'dark' });
      setMermaidLib(window.mermaid);
    });

    // Load jsPDF and html2canvas for PDF export
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => {
      setHtml2canvasLib(window.html2canvas);
    });
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => {
      setJspdfLib(window.jspdf);
    });

  }, []);

  // Effect to render Mermaid diagrams after content is set
  useEffect(() => {
    if (documentContent && mermaidLib) {
      setTimeout(() => {
        mermaidLib.init(undefined, '.mermaid');
      }, 0);
    }
  }, [documentContent, mermaidLib]);

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setContext('');

    if (file.type === 'application/pdf' && pdfjsLib) {
      setIsPdfLoading(true);
      const fileReader = new FileReader();
      fileReader.onload = async (e) => {
        try {
          const typedarray = new Uint8Array(e.target.result);
          const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
          let pdfText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            pdfText += textContent.items.map(item => item.str).join(' ');
          }
          setContext(pdfText);
        } catch (error) {
          console.error('Error reading PDF:', error);
          setContext('Error: No se pudo leer el archivo PDF.');
        } finally {
          setIsPdfLoading(false);
        }
      };
      fileReader.readAsArrayBuffer(file);
    } else if (file.type === 'text/plain' || file.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setContext(e.target.result);
      };
      reader.readAsText(file);
    } else {
      setContext('Error: Tipo de archivo no soportado.');
      setFileName('');
    }
  };

  const handleRemoveFile = () => {
    setFileName('');
    setContext('');
  };

  const generateDocument = async () => {
    setIsLoading(true);
    setDocumentContent('');

    // Aclaramos al modelo que puede usar tablas de Markdown y diagramas de Mermaid
    const instructionWithDiagrams = `Por favor, genera un documento del modelo de dominio del proyecto siguiendo estas instrucciones:\n\n${prompt}\n\nFormatea el documento utilizando las reglas de APA v7. Si se solicitan diagramas (clases, paquetes, etc.), usa el formato de Mermaid (envuelto en \`\`\`mermaid ... \`\`\`). Para las tablas, usa el formato estándar de Markdown.`;

    const fullPrompt = context ? `Usando el siguiente documento como contexto:\n\n${context}\n\nBasado en este contexto, por favor, completa la siguiente tarea:\n\n${instructionWithDiagrams}` : instructionWithDiagrams;

    try {
      const chatHistory = [{ role: "user", parts: [{ text: fullPrompt }] }];
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`La llamada a la API falló con el estado: ${response.status}`);
      }

      const result = await response.json();
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        
        // Handle Mermaid.js blocks specifically
        const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
        const processedText = text.replace(mermaidRegex, (match, p1) => {
          return `<div class="mermaid">${p1}</div>`;
        });
        
        const htmlContent = marked.parse(processedText);
        setDocumentContent(htmlContent);

      } else {
        setDocumentContent("Lo siento, no pude generar un documento. Por favor, intenta con otra solicitud.");
      }
    } catch (error) {
      console.error('Error al generar el documento:', error);
      setDocumentContent("Ocurrió un error. Por favor, revisa la consola para más detalles.");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (!documentContent || !jspdfLib || !html2canvasLib) return;

    setIsPdfGenerating(true);
    const docElement = document.getElementById('document-content');
    
    // Render the content to a canvas
    const canvas = await html2canvasLib(docElement, {
      scale: 2, // Aumentar la escala para mayor calidad
      useCORS: true,
      backgroundColor: '#1f2937' // Fondo oscuro
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jspdfLib.jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4'
    });

    const imgWidth = 210; 
    const pageHeight = 295;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save('documento_dominio.pdf');
    setIsPdfGenerating(false);
  };

  const isButtonDisabled = isLoading || isPdfLoading || (!prompt.trim() && !context.trim());
  const isDownloadDisabled = !documentContent || isPdfGenerating;

  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100 font-sans">
      
      {/* Sidebar / Panel de control */}
      <div className="w-full sm:w-1/3 md:w-1/4 lg:w-1/5 bg-gray-900 p-6 flex flex-col justify-between border-r border-gray-800">
        <div className="space-y-6">
          <header className="text-center">
            <Bot className="h-10 w-10 mx-auto text-blue-500 mb-2" />
            <h1 className="text-xl font-bold tracking-tight">
              Generador IA
            </h1>
          </header>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="prompt-input" className="block text-sm font-medium text-gray-400 mb-1">
                Instrucción
              </label>
              <textarea
                id="prompt-input"
                className="w-full h-24 p-2 text-sm bg-gray-800 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                placeholder="Ej: Siguiendo la plantilla proporcionada, crea un documento del modelo de dominio del proyecto para una aplicación de gestión de tareas. Incluye los diagramas de clases y de paquetes."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Contexto (Opcional)
              </label>
              {isPdfLoading ? (
                <div className="flex items-center justify-center space-x-2 p-2 bg-gray-800 border border-gray-700 rounded-lg">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                  <span className="text-xs text-gray-300">Cargando PDF...</span>
                </div>
              ) : fileName ? (
                <div className="flex items-center justify-between p-2 bg-gray-800 border border-gray-700 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <File className="h-4 w-4 text-green-400" />
                    <span className="text-xs text-gray-300 truncate">{fileName}</span>
                  </div>
                  <button onClick={handleRemoveFile} className="p-1 rounded-full text-gray-400 hover:text-red-400 transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label
                    htmlFor="file-upload"
                    className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold text-sm rounded-xl shadow-lg cursor-pointer transition-all duration-300"
                  >
                    <FileUp className="h-4 w-4" />
                    <span>Subir Documento</span>
                    <input id="file-upload" type="file" onChange={handleFileChange} className="hidden" accept=".txt, .md, .pdf" />
                  </label>
                  <textarea
                    className="w-full h-16 p-2 text-sm bg-gray-800 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    placeholder="o pega tu texto aquí..."
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col space-y-4">
          <button
            onClick={generateDocument}
            disabled={isButtonDisabled}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generando...</span>
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                <span>Generar Documento</span>
              </>
            )}
          </button>
          <button
            onClick={downloadPdf}
            disabled={isDownloadDisabled}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
          >
            {isPdfGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Creando PDF...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>Descargar como PDF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Área del documento principal */}
      <div className="flex-1 p-6 md:p-12 lg:p-16 flex justify-center">
        <div id="document-content" className="w-full max-w-2xl bg-gray-800 p-8 rounded-2xl shadow-xl overflow-y-auto">
          {documentContent ? (
            <div
              className="prose max-w-none prose-invert prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-base prose-p:leading-relaxed prose-li:text-base"
              dangerouslySetInnerHTML={createMarkup(documentContent)}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-center text-gray-500">
              <span className="text-lg">Tu documento aparecerá aquí.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
