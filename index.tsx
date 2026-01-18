import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Declare html2pdf for TypeScript since it's loaded via CDN
declare var html2pdf: any;

// --- Types ---
interface IntakeData {
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  vehiclePlate: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vehicleVin: string;
  description: string;
}

interface AIResult {
  damages: string;
  symptoms: string;
}

// --- Configuration Constants ---
const DEFAULT_NOTION_TOKEN = "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";
const DEFAULT_NOTION_DB_ID = "6335b6e7997a4097b08f2cba5feb5c6am"; 
const DEFAULT_IMGBB_KEY = "93ac0ba7b43294b8b56b60c044d1f340";

// --- Helper Functions ---
const fileToInlineData = async (file: File): Promise<{ mimeType: string; data: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1];
      resolve({
        mimeType: file.type,
        data: base64Data,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const safeNotionText = (text: string | undefined | null, fallback = " ") => {
    if (!text) return fallback;
    const cleanText = text.trim();
    if (cleanText.length === 0) return fallback;
    return cleanText.substring(0, 2000);
};

// Robust extractor for Notion Database IDs
const extractDatabaseId = (input: string): string | null => {
    if (!input) return null;
    const str = input.trim();
    if (str.startsWith('secret_') || str.startsWith('ntn_')) return null; 
    const match = str.match(/([a-f0-9]{32})/);
    if (match) return match[1];
    const cleanHex = str.replace(/-/g, '');
    if (/^[a-f0-9]{32}$/.test(cleanHex)) return cleanHex;
    return null;
};

// ImgBB Upload Function
const uploadToImgBB = async (file: File, apiKey: string): Promise<string> => {
    // ImgBB API endpoint: https://api.imgbb.com/1/upload
    // We use a proxy to avoid CORS issues from the browser
    const proxyUrl = "https://corsproxy.io/?";
    const targetUrl = "https://api.imgbb.com/1/upload";
    
    // Create FormData
    const formData = new FormData();
    formData.append("key", apiKey);
    formData.append("image", file);

    const response = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    
    // Validate ImgBB response
    if (!data.success) {
        throw new Error(data.error?.message || "Błąd uploadu ImgBB");
    }

    // Return the direct URL to the image
    return data.data.url;
};

const App = () => {
  // --- State ---
  const [formData, setFormData] = useState<IntakeData>({
    clientName: 'Jan Kowalski', 
    clientPhone: '111-222-333', 
    clientEmail: 'jankowalski@gmail.com',
    vehiclePlate: 'pl111222', 
    vehicleMake: 'Audi', 
    vehicleModel: 'A4', 
    vehicleYear: '2002', 
    vehicleVin: 'VIN242525SDFWW',
    description: 'uszkodzona część'
  });
  
  const [images, setImages] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [notionToken, setNotionToken] = useState(DEFAULT_NOTION_TOKEN);
  const [notionDbId, setNotionDbId] = useState(DEFAULT_NOTION_DB_ID);
  const [notionTitleKey, setNotionTitleKey] = useState("Imię i Nazwisko"); 
  
  // ImgBB API Key
  const [imgbbApiKey, setImgbbApiKey] = useState(DEFAULT_IMGBB_KEY);
  
  const [notionStatus, setNotionStatus] = useState<'idle' | 'uploading_images' | 'saving' | 'success' | 'fallback' | 'error'>('idle');
  const [notionPageUrl, setNotionPageUrl] = useState<string | null>(null);

  // Refs
  const reportRef = useRef<HTMLDivElement>(null);

  // --- Effects ---
  useEffect(() => {
    const storedToken = localStorage.getItem('moto_notion_token');
    const storedDb = localStorage.getItem('moto_notion_db');
    const storedTitleKey = localStorage.getItem('moto_notion_title_key');
    const storedImgbb = localStorage.getItem('moto_imgbb_key');
    
    if (storedToken) setNotionToken(storedToken);
    if (storedDb) setNotionDbId(storedDb);
    if (storedTitleKey) setNotionTitleKey(storedTitleKey);
    if (storedImgbb) setImgbbApiKey(storedImgbb);
  }, []);

  // --- Handlers ---
  const handleSaveSettings = () => {
    const rawId = notionDbId;
    const cleanId = extractDatabaseId(rawId);
    
    if (!notionToken.trim()) { alert("Wprowadź Notion Token."); return; }
    if (!cleanId) { alert("Nieprawidłowe ID Bazy Danych."); return; }
    if (!notionTitleKey.trim()) { alert("Podaj nazwę głównej kolumny."); return; }
    
    setNotionDbId(cleanId); 
    setNotionToken(notionToken.trim());
    setImgbbApiKey(imgbbApiKey.trim());

    localStorage.setItem('moto_notion_token', notionToken.trim());
    localStorage.setItem('moto_notion_db', cleanId);
    localStorage.setItem('moto_notion_title_key', notionTitleKey.trim());
    localStorage.setItem('moto_imgbb_key', imgbbApiKey.trim());
    
    setShowSettings(false);
    setError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setImages(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const copyImageToClipboard = async (file: File) => {
    try {
        await navigator.clipboard.write([
            new ClipboardItem({ [file.type]: file })
        ]);
        alert("Zdjęcie skopiowane! Teraz wejdź na stronę Notion i wciśnij Ctrl+V (Wklej).");
    } catch (err) {
        console.error(err);
        alert("Twoja przeglądarka nie obsługuje kopiowania zdjęć do schowka.");
    }
  };

  const handleDownloadPdf = () => {
    if (!reportRef.current) { alert("Błąd: Raport nie jest wygenerowany."); return; }
    
    // IMPORTANT: 'scrollY: 0' fixes the blank PDF issue caused by scrolling down
    const opt = {
      margin: 5,
      filename: `Raport_${formData.vehiclePlate || 'Auta'}_${new Date().toISOString().slice(0,10)}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
          scale: 2, 
          useCORS: true, 
          letterRendering: true, 
          backgroundColor: '#ffffff',
          scrollY: 0 // <--- THIS IS THE FIX
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
    
    html2pdf().set(opt).from(reportRef.current).save();
  };

  // --- Gemini Analysis ---
  const analyzeWithAI = async () => {
    if (images.length === 0) { setError("Proszę dodać przynajmniej jedno zdjęcie."); return; }
    
    setIsAnalyzing(true);
    setError(null);
    setAiResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const imageParts = await Promise.all(images.map(img => fileToInlineData(img)));
      
      const prompt = `
        Jesteś ekspertem rzeczoznawcą samochodowym. Przeanalizuj zdjęcia i opis: "${formData.description}".
        Zwróć JSON:
        { "damages": "Szczegółowy opis widocznych uszkodzeń", "symptoms": "Potencjalne objawy techniczne" }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [...imageParts.map(part => ({ inlineData: part })), { text: prompt }] },
        config: { responseMimeType: "application/json" }
      });

      const text = response.text;
      if (text) {
        setAiResult(JSON.parse(text));
      } else {
        throw new Error("Pusta odpowiedź od AI");
      }
    } catch (err: any) {
      console.error(err);
      setError("Błąd analizy AI: " + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Notion Integration ---
  const sendRequestToNotion = async (payload: any) => {
      const proxyUrl = "https://corsproxy.io/?";
      const targetUrl = "https://api.notion.com/v1/pages";
      return fetch(proxyUrl + encodeURIComponent(targetUrl), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${notionToken.trim()}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
  }

  const saveToNotion = async () => {
    if (!notionToken || !notionDbId) { setShowSettings(true); setError("Skonfiguruj Notion w ustawieniach."); return; }
    const cleanDbId = extractDatabaseId(notionDbId);
    if (!cleanDbId) { setError("Błędne ID bazy."); return; }

    if (!aiResult && !formData.clientName && !confirm("Brak analizy AI. Zapisać?")) return;
    
    setNotionPageUrl(null);
    setError(null);
    
    const pageTitle = `${formData.clientName || 'Klient'} - ${formData.vehiclePlate || 'Brak'}`;
    const titleKey = notionTitleKey || "Imię i Nazwisko"; 

    // --- 1. Image Upload Logic (ImgBB) ---
    const imageUrls: string[] = [];
    if (imgbbApiKey && images.length > 0) {
        setNotionStatus('uploading_images');
        try {
            for (const img of images) {
                const url = await uploadToImgBB(img, imgbbApiKey);
                imageUrls.push(url);
            }
        } catch (uploadError: any) {
            console.error("ImgBB upload failed", uploadError);
            alert(`Błąd wysyłania zdjęć do ImgBB: ${uploadError.message}. Zapiszę dane tekstowe bez zdjęć.`);
            // Continue without images if upload fails
        }
    }

    setNotionStatus('saving');

    // --- 2. Construct Notion Blocks ---
    const childrenBlocks: any[] = [
        { 
            object: "block", type: "heading_2", 
            heading_2: { rich_text: [{ text: { content: "Raport AI" } }] } 
        },
        { 
            object: "block", type: "paragraph", 
            paragraph: { rich_text: [{ text: { content: "Pełny raport wygenerowany przez system Moto Intake." } }] } 
        },
        { 
            object: "block", type: "heading_3", 
            heading_3: { rich_text: [{ text: { content: "Wykryte Uszkodzenia" } }] } 
        },
        { 
            object: "block", type: "paragraph", 
            paragraph: { rich_text: [{ text: { content: safeNotionText(aiResult?.damages, "Brak analizy") } }] } 
        },
        { 
            object: "block", type: "heading_3", 
            heading_3: { rich_text: [{ text: { content: "Sugerowane Objawy" } }] } 
        },
        { 
            object: "block", type: "paragraph", 
            paragraph: { rich_text: [{ text: { content: safeNotionText(aiResult?.symptoms, "Brak analizy") } }] } 
        },
    ];

    // Add Images if they were uploaded
    if (imageUrls.length > 0) {
        childrenBlocks.push({ 
            object: "block", type: "heading_3", 
            heading_3: { rich_text: [{ text: { content: "Zdjęcia (ImgBB)" } }] } 
        });
        
        imageUrls.forEach((url, idx) => {
            childrenBlocks.push({
                object: "block",
                type: "image",
                image: {
                    type: "external",
                    external: { url: url }
                }
            });
        });
    } else if (images.length > 0) {
        // Fallback message if no API Key or upload failed
        childrenBlocks.push({ 
            object: "block", type: "callout", 
            callout: { 
                rich_text: [{ text: { content: "⚠️ Zdjęcia nie zostały wysłane automatycznie (brak API Key ImgBB). Wklej je ręcznie." } }],
                icon: { emoji: "📷" },
                color: "orange_background"
            } 
        });
    }

    // --- 3. Payload Construction ---
    const structuredPayload = {
        parent: { database_id: cleanDbId },
        properties: {
          [titleKey]: { title: [{ text: { content: pageTitle } }] },
          "Telefon": { rich_text: [{ text: { content: safeNotionText(formData.clientPhone) } }] },
          "Email": { rich_text: [{ text: { content: safeNotionText(formData.clientEmail) } }] },
          "Nr Rejestracyjny": { rich_text: [{ text: { content: safeNotionText(formData.vehiclePlate) } }] },
          "Marka": { rich_text: [{ text: { content: safeNotionText(formData.vehicleMake) } }] },
          "Model": { rich_text: [{ text: { content: safeNotionText(formData.vehicleModel) } }] },
          "Rok": { rich_text: [{ text: { content: safeNotionText(formData.vehicleYear) } }] },
          "VIN": { rich_text: [{ text: { content: safeNotionText(formData.vehicleVin) } }] },
          "Opis Usterki (Klient)": { rich_text: [{ text: { content: safeNotionText(formData.description) } }] },
          "Status": { select: { name: "Nowy" } }
        },
        children: childrenBlocks
    };

    try {
      const res = await sendRequestToNotion(structuredPayload);

      if (res.ok) {
        const json = await res.json();
        setNotionStatus('success');
        if (json.url) setNotionPageUrl(json.url);
      } else {
        const errText = await res.text();
        console.warn("Save failed:", errText);
        let userMsg = "Sprawdź nazwy kolumn.";
        if (errText.includes("property that exists")) userMsg = `Nie znaleziono kolumny w Notion. Notion zwrócił: ${JSON.parse(errText).message}`;
        throw new Error(userMsg);
      }

    } catch (err: any) {
      console.error(err);
      setNotionStatus('error');
      alert("Błąd zapisu: " + err.message);
    }
  };

  // --- Render ---
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      
      {/* Header */}
      <header className="bg-blue-900 text-white p-4 shadow-md no-print">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚗</span>
            <h1 className="text-xl font-bold">Moto Intake AI</h1>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="text-sm bg-blue-800 hover:bg-blue-700 px-3 py-1 rounded border border-blue-700">⚙️ Ustawienia</button>
        </div>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 no-print">
          <div className="bg-white p-6 rounded-lg shadow-xl w-96 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
            <h2 className="text-lg font-bold mb-4">Ustawienia</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Notion Token</label>
                <input type="password" value={notionToken} onChange={(e) => setNotionToken(e.target.value)} className="w-full border rounded p-2 text-sm font-mono"/>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Database ID</label>
                <input type="text" value={notionDbId} onChange={(e) => setNotionDbId(e.target.value)} className="w-full border rounded p-2 text-sm font-mono"/>
              </div>
              <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                <label className="block text-sm font-bold mb-1 text-yellow-800">Nazwa 1. kolumny (Title)</label>
                <input type="text" value={notionTitleKey} onChange={(e) => setNotionTitleKey(e.target.value)} className="w-full border rounded p-2 text-sm"/>
              </div>
              
              {/* IMGBB SETTINGS */}
              <div className="bg-indigo-50 p-2 rounded border border-indigo-200">
                <label className="block text-sm font-bold mb-1 text-indigo-800">ImgBB API Key</label>
                <input 
                    type="password" 
                    value={imgbbApiKey} 
                    onChange={(e) => setImgbbApiKey(e.target.value)} 
                    placeholder="Wklej API Key tutaj"
                    className="w-full border rounded p-2 text-sm font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                    Opcjonalne. Zaloguj się na <a href="https://api.imgbb.com/" target="_blank" className="underline text-blue-600">api.imgbb.com</a> i kliknij "Get API Key".
                </p>
              </div>

              <button onClick={handleSaveSettings} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 font-medium">Zapisz</button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto p-4 space-y-6">
        {/* Error Display */}
        {error && <div className="bg-red-50 border-l-4 border-red-500 p-4 text-red-700 no-print shadow-sm font-bold">{error}</div>}

        {/* Client Data Form */}
        <section className="bg-white rounded-lg shadow p-6 no-print border border-slate-200">
          <h2 className="text-lg font-semibold border-b pb-2 mb-4 text-slate-700">👤 Dane Klienta</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <input name="clientName" value={formData.clientName} onChange={handleInputChange} className="border p-2 rounded" placeholder="Imię Nazwisko" />
            <input name="clientPhone" value={formData.clientPhone} onChange={handleInputChange} className="border p-2 rounded" placeholder="Telefon" />
            <input name="clientEmail" value={formData.clientEmail} onChange={handleInputChange} className="border p-2 rounded" placeholder="Email" />
          </div>
          <h2 className="text-lg font-semibold border-b pb-2 mb-4 text-slate-700 mt-6">🚗 Pojazd</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <input name="vehiclePlate" value={formData.vehiclePlate} onChange={handleInputChange} className="border p-2 rounded bg-yellow-50 font-mono" placeholder="Rejestracja" />
             <input name="vehicleMake" value={formData.vehicleMake} onChange={handleInputChange} className="border p-2 rounded" placeholder="Marka" />
             <input name="vehicleModel" value={formData.vehicleModel} onChange={handleInputChange} className="border p-2 rounded" placeholder="Model" />
             <input name="vehicleYear" value={formData.vehicleYear} onChange={handleInputChange} className="border p-2 rounded" placeholder="Rok" />
             <input name="vehicleVin" value={formData.vehicleVin} onChange={handleInputChange} className="border p-2 rounded" placeholder="VIN" />
          </div>
        </section>

        {/* Intake Form */}
        <section className="bg-white rounded-lg shadow p-6 no-print border border-slate-200">
          <h2 className="text-lg font-semibold border-b pb-2 mb-4 text-slate-700">📷 Usterka</h2>
          <textarea name="description" value={formData.description} onChange={handleInputChange} className="w-full border rounded p-2 h-24 mb-4" placeholder="Opis usterki..." />
          <div className="flex gap-2 mb-2">
            <label className="cursor-pointer bg-blue-50 text-blue-700 border border-blue-200 px-4 py-2 rounded-md flex items-center gap-2">
                <span>➕ Dodaj zdjęcie</span>
                <input type="file" accept="image/*" multiple capture="environment" onChange={handleImageUpload} className="hidden" />
            </label>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-4">
              {images.map((img, idx) => (
                <div key={idx} className="relative aspect-square bg-slate-100 rounded border">
                  <img src={URL.createObjectURL(img)} className="w-full h-full object-cover" />
                  <button onClick={() => removeImage(idx)} className="absolute top-0 right-0 bg-red-500 text-white w-6 h-6 rounded-full">&times;</button>
                </div>
              ))}
          </div>
          <button onClick={analyzeWithAI} disabled={isAnalyzing} className={`w-full py-3 rounded-lg text-white font-bold ${isAnalyzing ? 'bg-slate-400' : 'bg-green-600 hover:bg-green-700'}`}>
            {isAnalyzing ? "Analizowanie..." : "🚀 Analizuj Zgłoszenie"}
          </button>
        </section>

        {/* Results & Actions */}
        {aiResult && (
          <section className="bg-white rounded-lg shadow overflow-hidden border border-slate-200">
            {/* THIS IS THE PDF REPORT TEMPLATE */}
            <div ref={reportRef} className="bg-white text-slate-900 p-10 max-w-[210mm] mx-auto border shadow-sm min-h-[297mm]">
                
                {/* Header */}
                <div className="flex justify-between items-end border-b-4 border-slate-800 pb-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-black text-slate-800 tracking-tight uppercase">Protokół Weryfikacji</h1>
                        <p className="text-sm text-slate-500 mt-1">Wygenerowano automatycznie przez Moto Intake AI</p>
                    </div>
                    <div className="text-right">
                        <p className="font-bold text-lg">Data: {new Date().toLocaleDateString('pl-PL')}</p>
                        <p className="text-slate-600 font-mono text-sm">{formData.vehiclePlate.toUpperCase()}</p>
                    </div>
                </div>

                {/* Data Grid */}
                <div className="grid grid-cols-2 gap-8 mb-8">
                    <div>
                        <h3 className="text-xs font-bold uppercase text-slate-400 mb-2 border-b">Dane Pojazdu</h3>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between border-b border-dotted border-slate-200 py-1"><span className="text-slate-500">Pojazd:</span> <span className="font-bold">{formData.vehicleMake} {formData.vehicleModel}</span></div>
                            <div className="flex justify-between border-b border-dotted border-slate-200 py-1"><span className="text-slate-500">Rok:</span> <span className="font-bold">{formData.vehicleYear}</span></div>
                            <div className="flex justify-between border-b border-dotted border-slate-200 py-1"><span className="text-slate-500">VIN:</span> <span className="font-mono">{formData.vehicleVin}</span></div>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xs font-bold uppercase text-slate-400 mb-2 border-b">Dane Klienta</h3>
                        <div className="space-y-1 text-sm">
                             <div className="flex justify-between border-b border-dotted border-slate-200 py-1"><span className="text-slate-500">Klient:</span> <span className="font-bold">{formData.clientName}</span></div>
                             <div className="flex justify-between border-b border-dotted border-slate-200 py-1"><span className="text-slate-500">Tel:</span> <span>{formData.clientPhone}</span></div>
                             <div className="flex justify-between border-b border-dotted border-slate-200 py-1"><span className="text-slate-500">Email:</span> <span>{formData.clientEmail}</span></div>
                        </div>
                    </div>
                </div>

                {/* Description */}
                <div className="mb-8">
                     <h3 className="text-xs font-bold uppercase text-slate-400 mb-2 border-b">Zgłoszenie Usterki</h3>
                     <p className="text-sm bg-slate-50 p-4 rounded border border-slate-100 italic">"{formData.description}"</p>
                </div>

                {/* AI Analysis */}
                <div className="mb-8 space-y-4">
                    <div className="border border-slate-200 rounded overflow-hidden">
                        <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 font-bold text-sm flex items-center gap-2">
                            <span>🔍</span> Analiza Uszkodzeń
                        </div>
                        <div className="p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {aiResult.damages}
                        </div>
                    </div>
                    
                    <div className="border border-slate-200 rounded overflow-hidden">
                        <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 font-bold text-sm flex items-center gap-2">
                            <span>⚙️</span> Sugerowane Objawy / Diagnostyka
                        </div>
                        <div className="p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {aiResult.symptoms}
                        </div>
                    </div>
                </div>

                {/* Images */}
                <div className="page-break-inside-avoid">
                    <h3 className="text-xs font-bold uppercase text-slate-400 mb-4 border-b">Dokumentacja Zdjęciowa</h3>
                    <div className="grid grid-cols-3 gap-4">
                        {images.map((img, idx) => (
                            <div key={idx} className="border p-1 bg-white">
                                <img src={URL.createObjectURL(img)} className="w-full h-32 object-cover" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-8 border-t text-xs text-slate-400 text-center">
                    <p>Dokument wygenerowany automatycznie. Wymaga weryfikacji przez mechanika.</p>
                </div>
            </div>
            
            <div className="p-4 bg-slate-50 flex flex-col gap-3 border-t">
              <div className="flex gap-2">
                <button onClick={handleDownloadPdf} className="flex-1 bg-slate-800 text-white py-3 rounded hover:bg-slate-900 transition">📄 Pobierz PDF</button>
                <button onClick={saveToNotion} disabled={notionStatus === 'saving' || notionStatus === 'uploading_images' || notionStatus === 'success'} className={`flex-1 py-3 rounded text-white font-bold transition ${notionStatus === 'success' ? 'bg-green-500' : 'bg-orange-600 hover:bg-orange-700'}`}>
                    {notionStatus === 'uploading_images' ? "Wysyłanie zdjęć..." : notionStatus === 'saving' ? "Zapisywanie..." : notionStatus === 'success' ? "✅ Zapisano w Notion" : "💾 Wyślij do Notion"}
                </button>
              </div>

              {notionStatus === 'success' && (
                <div className="bg-green-50 border border-green-200 p-4 rounded text-sm animate-in fade-in slide-in-from-top-2">
                    <p className="font-bold text-green-800 mb-2">Dane zostały zapisane!</p>
                    
                    {imgbbApiKey ? (
                        <p className="text-green-700 mb-2">Zdjęcia zostały wysłane automatycznie (dzięki ImgBB).</p>
                    ) : (
                         <p className="text-green-700 mb-4">
                            ⚠️ Brak konfiguracji ImgBB. API Notion nie pozwala na bezpośrednie wysłanie plików. 
                            <strong>Skopiuj je poniżej i wklej (Ctrl+V) ręcznie.</strong>
                        </p>
                    )}
                    
                    {notionPageUrl && (
                        <a href={notionPageUrl} target="_blank" className="block text-center text-blue-600 underline font-bold mb-4">
                            🔗 Otwórz utworzoną stronę w Notion
                        </a>
                    )}

                    {!imgbbApiKey && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            {images.map((img, idx) => (
                                <div key={idx} className="relative group">
                                    <img src={URL.createObjectURL(img)} className="w-full h-24 object-cover rounded border" />
                                    <button 
                                        onClick={() => copyImageToClipboard(img)}
                                        className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center font-bold text-xs transition rounded"
                                    >
                                        📋 Kopiuj
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);