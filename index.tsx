import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import emailjs from "@emailjs/browser";

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
// CRITICAL: Removed hardcoded tokens to prevent "Push blocked: secret detected" errors.
// Please enter these values in the App Settings (Gear Icon) -> they will be saved to your LocalStorage.
const DEFAULT_NOTION_TOKEN = ""; 
const DEFAULT_NOTION_DB_ID = "6335b6e7997a4097b08f2cba5feb5c6a"; 
const DEFAULT_IMGBB_KEY = "";

// EmailJS Defaults
const DEFAULT_EMAIL_SERVICE_ID = "service_7e1rkgw";
const DEFAULT_EMAIL_TEMPLATE_ID = "template_fi5isnq";
const DEFAULT_EMAIL_PUBLIC_KEY = "jex7e9fV6Rd9GVEtN";

// Settings Credentials
const SETTINGS_LOGIN = "admin";
const SETTINGS_PASS = "password";

// --- Helper Functions ---

// Safe API Key extraction for Browser Environments
const getGeminiApiKey = (): string => {
  try {
    // 1. Check standard process.env (Node/Webpack/CRA)
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.API_KEY) return process.env.API_KEY;
      if (process.env.REACT_APP_API_KEY) return process.env.REACT_APP_API_KEY;
      if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
      if (process.env.NEXT_PUBLIC_API_KEY) return process.env.NEXT_PUBLIC_API_KEY;
    }
    
    // 2. Check Vite's import.meta.env
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      if (import.meta.env.VITE_API_KEY) return import.meta.env.VITE_API_KEY;
      // @ts-ignore
      if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
    }
  } catch (e) {
    console.warn("Error reading env vars", e);
  }
  return '';
};

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

// --- Email Template Generator ---
const getEmailTemplateHtml = () => {
    return `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .header { background-color: #1e3a8a; padding: 20px; color: white; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; }
  .header p { margin: 5px 0 0; font-size: 12px; opacity: 0.8; }
  .content { padding: 20px; background-color: #ffffff; }
  .grid-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .grid-table td { vertical-align: top; width: 50%; padding: 10px; border-bottom: 1px dashed #e2e8f0; }
  .label { font-size: 10px; font-weight: bold; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 2px; }
  .value { font-size: 14px; font-weight: bold; color: #0f172a; }
  .section-title { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; margin-top: 20px; margin-bottom: 10px; }
  .box { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 4px; font-size: 13px; margin-bottom: 10px; }
  .footer { background-color: #f1f5f9; text-align: center; padding: 15px; font-size: 11px; color: #64748b; }
  .image-container { text-align: center; margin-top: 15px; }
  img { max-width: 100%; border-radius: 4px; border: 1px solid #e2e8f0; }
</style>
</head>
<body>
<div class="container">
  <!-- Header -->
  <div style="background-color: #1e3a8a; padding: 20px; color: white;">
    <table width="100%">
        <tr>
            <td>
                <h1 style="margin:0; font-size:22px; color:white;">PROTOKÓŁ WERYFIKACJI</h1>
                <p style="margin:5px 0 0; font-size:12px; color:#cbd5e1;">Moto Intake AI</p>
            </td>
            <td align="right">
                <p style="margin:0; font-weight:bold; color:white;">{{date}}</p>
                <p style="margin:0; font-family:monospace; color:#cbd5e1;">{{vehiclePlate}}</p>
            </td>
        </tr>
    </table>
  </div>

  <div class="content">
    <!-- Grid -->
    <table class="grid-table">
        <tr>
            <td>
                <div class="section-title" style="margin-top:0;">Dane Pojazdu</div>
                <div style="margin-bottom:8px;"><span class="label">Pojazd:</span> <span class="value">{{vehicleMake}} {{vehicleModel}}</span></div>
                <div style="margin-bottom:8px;"><span class="label">Rok:</span> <span class="value">{{vehicleYear}}</span></div>
                <div style="margin-bottom:8px;"><span class="label">VIN:</span> <span class="value" style="font-family:monospace;">{{vehicleVin}}</span></div>
            </td>
            <td>
                <div class="section-title" style="margin-top:0;">Dane Klienta</div>
                <div style="margin-bottom:8px;"><span class="label">Klient:</span> <span class="value">{{clientName}}</span></div>
                <div style="margin-bottom:8px;"><span class="label">Tel:</span> <span class="value">{{clientPhone}}</span></div>
                <div style="margin-bottom:8px;"><span class="label">Email:</span> <span class="value">{{clientEmail}}</span></div>
            </td>
        </tr>
    </table>

    <!-- Description -->
    <div class="section-title">Zgłoszenie Usterki (opis pracownika)</div>
    <div class="box" style="font-style: italic;">
        "{{description}}"
    </div>

    <!-- AI Analysis -->
    <div class="section-title">🔍 Analiza Uszkodzeń (wygenerowane przez AI)</div>
    <div class="box">
        {{damages}}
    </div>

    <div class="section-title">⚙️ Diagnostyka / Objawy (wygenerowane przez AI)</div>
    <div class="box">
        {{symptoms}}
    </div>

    <!-- Image -->
    <div class="section-title">Dokumentacja Zdjęciowa</div>
    <div class="image-container">
        <!-- Używamy triple stash {{{ }}} aby wstrzyknąć gotowy HTML (img tag lub komunikat brak zdjęcia) wygenerowany w JS -->
        {{{image_section}}}
    </div>
  </div>

  <div class="footer">
    Dokument wygenerowany automatycznie.<br>Prosimy o weryfikację przez mechanika przed naprawą.
  </div>
</div>
</body>
</html>
    `;
};


const App = () => {
  // --- State ---
  const [formData, setFormData] = useState<IntakeData>({
    clientName: '', 
    clientPhone: '', 
    clientEmail: '',
    vehiclePlate: '', 
    vehicleMake: '', 
    vehicleModel: '', 
    vehicleYear: '', 
    vehicleVin: '',
    description: ''
  });
  
  const [images, setImages] = useState<File[]>([]);
  // Store uploaded ImgBB URLs so we don't upload twice (once for Notion, once for Email)
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [isSettingsAuth, setIsSettingsAuth] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const [notionToken, setNotionToken] = useState(DEFAULT_NOTION_TOKEN);
  const [notionDbId, setNotionDbId] = useState(DEFAULT_NOTION_DB_ID);
  const [notionTitleKey, setNotionTitleKey] = useState("Imię i Nazwisko"); 
  
  // ImgBB API Key
  const [imgbbApiKey, setImgbbApiKey] = useState(DEFAULT_IMGBB_KEY);
  
  // EmailJS Settings
  const [emailServiceId, setEmailServiceId] = useState(DEFAULT_EMAIL_SERVICE_ID);
  const [emailTemplateId, setEmailTemplateId] = useState(DEFAULT_EMAIL_TEMPLATE_ID);
  const [emailPublicKey, setEmailPublicKey] = useState(DEFAULT_EMAIL_PUBLIC_KEY);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

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
    const storedServiceId = localStorage.getItem('moto_email_service');
    const storedTemplateId = localStorage.getItem('moto_email_template');
    const storedPublicKey = localStorage.getItem('moto_email_key');
    
    // Removed auto-correction logic. Using the stored token as-is, or default.
    if (storedToken) {
        setNotionToken(storedToken);
    } else {
        setNotionToken(DEFAULT_NOTION_TOKEN);
    }

    if (storedDb) setNotionDbId(storedDb);
    if (storedTitleKey) setNotionTitleKey(storedTitleKey);
    if (storedImgbb) setImgbbApiKey(storedImgbb);
    if (storedServiceId) setEmailServiceId(storedServiceId);
    if (storedTemplateId) setEmailTemplateId(storedTemplateId);
    if (storedPublicKey) setEmailPublicKey(storedPublicKey);
  }, []);

  // --- Handlers ---
  
  const handleSettingsLogin = () => {
      if (loginUser === SETTINGS_LOGIN && loginPass === SETTINGS_PASS) {
          setIsSettingsAuth(true);
          setLoginError(null);
          setLoginUser("");
          setLoginPass("");
      } else {
          setLoginError("Błędny login lub hasło.");
          setLoginPass("");
      }
  };

  const handleSaveSettings = () => {
    const rawId = notionDbId;
    const cleanId = extractDatabaseId(rawId);
    
    if (!notionToken.trim()) { alert("Wprowadź Notion Token."); return; }
    if (!cleanId) { alert("Nieprawidłowe ID Bazy Danych."); return; }
    
    setNotionDbId(cleanId); 
    setNotionToken(notionToken.trim());
    setImgbbApiKey(imgbbApiKey.trim());
    setEmailServiceId(emailServiceId.trim());
    setEmailTemplateId(emailTemplateId.trim());
    setEmailPublicKey(emailPublicKey.trim());

    localStorage.setItem('moto_notion_token', notionToken.trim());
    localStorage.setItem('moto_notion_db', cleanId);
    localStorage.setItem('moto_notion_title_key', notionTitleKey.trim());
    localStorage.setItem('moto_imgbb_key', imgbbApiKey.trim());
    localStorage.setItem('moto_email_service', emailServiceId.trim());
    localStorage.setItem('moto_email_template', emailTemplateId.trim());
    localStorage.setItem('moto_email_key', emailPublicKey.trim());
    
    setShowSettings(false);
    setError(null);
  };

  const handleCopyHtml = async () => {
      try {
          const html = getEmailTemplateHtml();
          await navigator.clipboard.writeText(html);
          alert("Kod HTML szablonu został skopiowany do schowka! Wklej go w edytorze szablonu EmailJS.");
      } catch (err) {
          alert("Nie udało się skopiować kodu.");
      }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setImages(prev => [...prev, ...Array.from(e.target.files!)]);
      // Reset uploaded URLs since images changed
      setUploadedUrls([]);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setUploadedUrls([]); // Reset uploads on change
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

  // Shared function to handle image uploads if not already done
  const uploadImagesIfNeeded = async (): Promise<string[]> => {
    if (uploadedUrls.length > 0) return uploadedUrls;
    if (images.length === 0) return [];
    if (!imgbbApiKey) return [];

    const newUrls: string[] = [];
    try {
        for (const img of images) {
            const url = await uploadToImgBB(img, imgbbApiKey);
            newUrls.push(url);
        }
        setUploadedUrls(newUrls);
        return newUrls;
    } catch (err: any) {
        console.error("Image upload failed", err);
        throw new Error(`Błąd wysyłania zdjęć: ${err.message}`);
    }
  };

  const handleSendEmail = async () => {
      if (!emailServiceId || !emailTemplateId || !emailPublicKey) {
          setShowSettings(true);
          setError("Aby wysłać email, uzupełnij konfigurację EmailJS w ustawieniach (Service ID, Template ID, Public Key).");
          return;
      }

      if (!formData.clientEmail) {
          setError("Brak adresu email klienta!");
          return;
      }

      setEmailStatus('sending');
      setError(null);

      try {
          // 1. Upload images if needed (to get public URLs for the email)
          let currentImageUrls: string[] = [];
          if (images.length > 0 && imgbbApiKey) {
              setNotionStatus('uploading_images'); // Reusing status indicator for UI feedback
              currentImageUrls = await uploadImagesIfNeeded();
              setNotionStatus('idle');
          }

          // Generate HTML for the image section here (in JS) instead of using handlebars logic in the template
          // This prevents "corrupted variable" errors in EmailJS if strict helpers aren't supported.
          const imageSectionHtml = currentImageUrls.length > 0 
            ? `<img src="${currentImageUrls[0]}" alt="Zdjęcie usterki" style="max-width: 100%; border-radius: 4px; border: 1px solid #e2e8f0;" /><p style="font-size:10px; color:#94a3b8;">(Główne zdjęcie usterki)</p>`
            : `<p style="font-size:12px; color:#94a3b8; font-style:italic;">Brak zdjęcia w mailu.</p>`;

          // 2. Prepare Template Params (Matching the HTML Template variables)
          const templateParams = {
              date: new Date().toLocaleDateString('pl-PL'),
              vehiclePlate: formData.vehiclePlate || "---",
              vehicleMake: formData.vehicleMake || "---",
              vehicleModel: formData.vehicleModel || "---",
              vehicleYear: formData.vehicleYear || "---",
              vehicleVin: formData.vehicleVin || "---",
              clientName: formData.clientName || "Klient",
              clientPhone: formData.clientPhone || "---",
              clientEmail: formData.clientEmail,
              description: formData.description || "Brak opisu",
              damages: aiResult?.damages || "Brak danych z analizy.",
              symptoms: aiResult?.symptoms || "Brak danych z analizy.",
              // We pass the full HTML for the image section
              image_section: imageSectionHtml
          };

          // 3. Send Email
          await emailjs.send(
              emailServiceId,
              emailTemplateId,
              templateParams,
              emailPublicKey
          );

          setEmailStatus('success');
          alert("✅ Email został wysłany do klienta!");

      } catch (err: any) {
          console.error("EmailJS Error:", err);
          setEmailStatus('error');
          alert("Błąd wysyłania maila: " + (err.text || err.message));
      } finally {
          if (notionStatus === 'uploading_images') setNotionStatus('idle');
          // Reset success status after 5s
          setTimeout(() => setEmailStatus('idle'), 5000);
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
    
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      setError("Brak Klucza API Google! Skonfiguruj zmienną środowiskową 'API_KEY' (lub 'VITE_API_KEY', 'NEXT_PUBLIC_API_KEY') w ustawieniach projektu Vercel.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAiResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const imageParts = await Promise.all(images.map(img => fileToInlineData(img)));
      
      const prompt = `
        Jesteś ekspertem rzeczoznawcą samochodowym. Przeanalizuj zdjęcia i opis: "${formData.description}".
        Zwróć JSON:
        { "damages": "Szczegółowy opis widocznych uszkodzeń", "symptoms": "Potencjalne objawy techniczne" }
      `;

      // Helper for Retry Logic
      const generateWithRetry = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
            try {
                // Using 'gemini-3-flash-preview' as it is the recommended standard and likely has available quota/preview access.
                return await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: { parts: [...imageParts.map(part => ({ inlineData: part })), { text: prompt }] },
                    config: { responseMimeType: "application/json" }
                });
            } catch (err: any) {
                const isOverloaded = err.message?.includes('503') || err.message?.includes('overloaded') || err.status === 503;
                if (isOverloaded && i < retries - 1) {
                    console.warn(`Model overloaded (503), retrying... attempt ${i + 1}/${retries}`);
                    // Exponential backoff: 1s, 2s, 4s
                    await new Promise(res => setTimeout(res, 1000 * Math.pow(2, i)));
                    continue;
                }
                throw err;
            }
        }
        throw new Error("Model unavailable after retries");
      };

      const response = await generateWithRetry();

      const text = response.text;
      if (text) {
        setAiResult(JSON.parse(text));
      } else {
        throw new Error("Pusta odpowiedź od AI");
      }
    } catch (err: any) {
      console.error(err);
      
      // Improve Error Handling for 429 Quota Exceeded
      let errorMsg = err.message || "Błąd nieznany";
      if (err.message?.includes('429') || err.status === 429 || err.message?.includes('Quota exceeded')) {
          errorMsg = "Wyczerpano limit zapytań (Quota Exceeded 429). Model AI jest obecnie niedostępny dla tego klucza. Odczekaj chwilę lub sprawdź limity na koncie Google Cloud.";
      }
      
      setError("Błąd analizy AI: " + errorMsg);
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
    // Use shared upload logic
    let imageUrls: string[] = [];
    if (imgbbApiKey && images.length > 0) {
        setNotionStatus('uploading_images');
        try {
            imageUrls = await uploadImagesIfNeeded();
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
            heading_3: { rich_text: [{ text: { content: "Analiza Uszkodzeń (wygenerowane przez AI)" } }] } 
        },
        { 
            object: "block", type: "paragraph", 
            paragraph: { rich_text: [{ text: { content: safeNotionText(aiResult?.damages, "Brak analizy") } }] } 
        },
        { 
            object: "block", type: "heading_3", 
            heading_3: { rich_text: [{ text: { content: "Diagnostyka / Objawy (wygenerowane przez AI)" } }] } 
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
        
        let errorJson;
        try {
            errorJson = JSON.parse(errText);
        } catch (e) {
            // Error is not JSON (likely Proxy 403/500/404 HTML response)
            throw new Error(`Błąd sieci/proxy (Status ${res.status}). Może to oznaczać blokadę CORS na serwerze.`);
        }

        // Notion API Error Handling
        if (errorJson.code === "object_not_found") {
             throw new Error("Błąd 404: Nie znaleziono bazy danych w Notion. Sprawdź ID oraz czy dodałeś 'Connection' w ustawieniach bazy.");
        }
        if (errorJson.code === "unauthorized") {
             // Reverted to generic error message as we are not enforcing secret_ anymore
             throw new Error("Błąd 401: Zły Token Notion (Unauthorized).");
        }
        if (errorJson.message) {
            // Ensure we show the exact property missing
            throw new Error(`Notion: ${errorJson.message}`);
        }

        throw new Error(`Błąd nieznany: ${errText}`);
      }

    } catch (err: any) {
      console.error(err);
      setNotionStatus('error');
      alert(err.message);
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

      {/* Settings Modal (With Login Protection) */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 no-print">
          <div className="bg-white p-6 rounded-lg shadow-xl w-96 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
            <h2 className="text-lg font-bold mb-4">{!isSettingsAuth ? "Logowanie" : "Ustawienia"}</h2>
            
            {/* Login View */}
            {!isSettingsAuth ? (
                <div className="space-y-4">
                     <p className="text-sm text-slate-600 mb-2">Podaj dane logowania, aby edytować konfigurację.</p>
                     {loginError && <p className="text-xs text-red-600 font-bold bg-red-50 p-2 rounded">{loginError}</p>}
                     <div>
                        <label className="block text-sm font-medium mb-1">Login</label>
                        <input 
                            key="login-user"
                            type="text" 
                            name="login_username"
                            value={loginUser} 
                            onChange={(e) => setLoginUser(e.target.value)} 
                            className="w-full border rounded p-2"
                            placeholder="Wpisz login..."
                        />
                     </div>
                     <div>
                        <label className="block text-sm font-medium mb-1">Hasło</label>
                        <input 
                            key="login-pass"
                            type="password" 
                            name="login_password"
                            value={loginPass} 
                            onChange={(e) => setLoginPass(e.target.value)} 
                            className="w-full border rounded p-2"
                            placeholder="Wpisz hasło..."
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSettingsLogin(); }}
                        />
                     </div>
                     <button onClick={handleSettingsLogin} className="w-full bg-blue-800 text-white py-2 rounded hover:bg-blue-900 font-bold mt-2">Zaloguj</button>
                     <button onClick={() => setShowSettings(false)} className="w-full text-slate-500 text-sm mt-2 hover:underline">Anuluj</button>
                </div>
            ) : (
                /* Settings View (Authenticated) */
                <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Notion Token</label>
                    <div className="flex gap-2">
                        <input 
                            key="notion-token"
                            type="password" 
                            name="notion_token"
                            autoComplete="new-password"
                            value={notionToken} 
                            onChange={(e) => setNotionToken(e.target.value)} 
                            className="w-full border rounded p-2 text-sm font-mono"
                        />
                        <button 
                            onClick={() => setNotionToken(DEFAULT_NOTION_TOKEN)}
                            className="text-xs bg-slate-200 hover:bg-slate-300 px-2 rounded whitespace-nowrap"
                            title="Przywróć domyślny token z kodu"
                        >
                            Reset
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Database ID</label>
                    {/* Changed to type password to mask the ID */}
                    <input 
                        key="notion-db"
                        type="password" 
                        name="notion_db_id"
                        autoComplete="new-password"
                        value={notionDbId} 
                        onChange={(e) => setNotionDbId(e.target.value)} 
                        className="w-full border rounded p-2 text-sm font-mono"
                    />
                </div>
                <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                    <label className="block text-sm font-bold mb-1 text-yellow-800">Nazwa 1. kolumny (Title)</label>
                    <input 
                        key="notion-title"
                        type="text" 
                        name="notion_title_col"
                        value={notionTitleKey} 
                        onChange={(e) => setNotionTitleKey(e.target.value)} 
                        className="w-full border rounded p-2 text-sm"
                    />
                </div>
                
                {/* IMGBB SETTINGS */}
                <div className="bg-indigo-50 p-2 rounded border border-indigo-200">
                    <label className="block text-sm font-bold mb-1 text-indigo-800">ImgBB API Key</label>
                    <input 
                        key="imgbb-key"
                        type="password" 
                        name="imgbb_api_key"
                        autoComplete="new-password"
                        value={imgbbApiKey} 
                        onChange={(e) => setImgbbApiKey(e.target.value)} 
                        placeholder="Wklej API Key tutaj"
                        className="w-full border rounded p-2 text-sm font-mono"
                    />
                </div>

                {/* EMAILJS SETTINGS */}
                <div className="bg-green-50 p-2 rounded border border-green-200">
                    <label className="block text-sm font-bold mb-1 text-green-800">Konfiguracja EmailJS (Wysyłka)</label>
                    <div className="space-y-2">
                        <input 
                            key="email-service"
                            type="password" 
                            name="email_service_id"
                            autoComplete="new-password"
                            value={emailServiceId} 
                            onChange={(e) => setEmailServiceId(e.target.value)} 
                            placeholder="Service ID (np. service_xyz)"
                            className="w-full border rounded p-2 text-sm font-mono"
                        />
                        <input 
                            key="email-template"
                            type="password" 
                            name="email_template_id"
                            autoComplete="new-password"
                            value={emailTemplateId} 
                            onChange={(e) => setEmailTemplateId(e.target.value)} 
                            placeholder="Template ID (np. template_abc)"
                            className="w-full border rounded p-2 text-sm font-mono"
                        />
                        <input 
                            key="email-key"
                            type="password" 
                            name="email_public_key"
                            autoComplete="new-password"
                            value={emailPublicKey} 
                            onChange={(e) => setEmailPublicKey(e.target.value)} 
                            placeholder="Public Key"
                            className="w-full border rounded p-2 text-sm font-mono"
                        />
                    </div>
                    <div className="mt-2">
                        <button 
                            onClick={handleCopyHtml} 
                            className="w-full bg-green-100 hover:bg-green-200 text-green-800 border border-green-300 py-1.5 rounded text-xs font-bold transition flex items-center justify-center gap-1"
                        >
                            📋 Skopiuj kod szablonu HTML do schowka
                        </button>
                        <p className="text-[10px] text-slate-500 mt-1 text-center">Wklej ten kod w edytorze EmailJS, aby mail wyglądał jak PDF.</p>
                    </div>
                </div>

                <button onClick={handleSaveSettings} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 font-medium">Zapisz</button>
                </div>
            )}
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
            {/* COMPACT LAYOUT FOR 1 PAGE (Reduced padding, margins, gaps) */}
            <div ref={reportRef} className="bg-white text-slate-900 p-6 max-w-[210mm] mx-auto border shadow-sm">
                
                {/* Header */}
                <div className="flex justify-between items-end border-b-4 border-slate-800 pb-2 mb-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Protokół Weryfikacji</h1>
                        <p className="text-xs text-slate-500 mt-1">Wygenerowano automatycznie przez Moto Intake AI</p>
                    </div>
                    <div className="text-right">
                        <p className="font-bold text-base">Data: {new Date().toLocaleDateString('pl-PL')}</p>
                        <p className="text-slate-600 font-mono text-xs">{formData.vehiclePlate.toUpperCase()}</p>
                    </div>
                </div>

                {/* Data Grid (Compact) */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-1 border-b">Dane Pojazdu</h3>
                        <div className="space-y-0.5 text-xs">
                            <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5"><span className="text-slate-500">Pojazd:</span> <span className="font-bold">{formData.vehicleMake} {formData.vehicleModel}</span></div>
                            <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5"><span className="text-slate-500">Rok:</span> <span className="font-bold">{formData.vehicleYear}</span></div>
                            <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5"><span className="text-slate-500">VIN:</span> <span className="font-mono">{formData.vehicleVin}</span></div>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-1 border-b">Dane Klienta</h3>
                        <div className="space-y-0.5 text-xs">
                             <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5"><span className="text-slate-500">Klient:</span> <span className="font-bold">{formData.clientName}</span></div>
                             <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5"><span className="text-slate-500">Tel:</span> <span>{formData.clientPhone}</span></div>
                             <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5"><span className="text-slate-500">Email:</span> <span>{formData.clientEmail}</span></div>
                        </div>
                    </div>
                </div>

                {/* Description */}
                <div className="mb-4">
                     <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-1 border-b">Zgłoszenie Usterki (opis pracownika)</h3>
                     <p className="text-xs bg-slate-50 p-2 rounded border border-slate-100 italic">"{formData.description}"</p>
                </div>

                {/* AI Analysis */}
                <div className="mb-4 space-y-2">
                    <div className="border border-slate-200 rounded overflow-hidden">
                        <div className="bg-slate-100 px-3 py-1 border-b border-slate-200 font-bold text-xs flex items-center gap-2">
                            <span>🔍</span> Analiza Uszkodzeń (wygenerowane przez AI)
                        </div>
                        <div className="p-2 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {aiResult.damages}
                        </div>
                    </div>
                    
                    <div className="border border-slate-200 rounded overflow-hidden">
                        <div className="bg-slate-100 px-3 py-1 border-b border-slate-200 font-bold text-xs flex items-center gap-2">
                            <span>⚙️</span> Diagnostyka / Objawy (wygenerowane przez AI)
                        </div>
                        <div className="p-2 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                            {aiResult.symptoms}
                        </div>
                    </div>
                </div>

                {/* Images (Smaller) */}
                <div className="page-break-inside-avoid">
                    <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-2 border-b">Dokumentacja Zdjęciowa</h3>
                    <div className="grid grid-cols-3 gap-2">
                        {images.map((img, idx) => (
                            <div key={idx} className="border p-1 bg-white">
                                <img src={URL.createObjectURL(img)} className="w-full h-24 object-cover" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-4 pt-2 border-t text-[10px] text-slate-400 text-center">
                    <p>Dokument wygenerowany automatycznie. Wymaga weryfikacji przez mechanika.</p>
                </div>
            </div>
            
            <div className="p-4 bg-slate-50 flex flex-col gap-3 border-t">
              <div className="flex flex-col md:flex-row gap-2">
                <button onClick={handleDownloadPdf} className="flex-1 bg-slate-800 text-white py-3 rounded hover:bg-slate-900 transition flex items-center justify-center gap-2">
                    <span>📄</span> Pobierz PDF
                </button>
                <button onClick={handleSendEmail} disabled={emailStatus === 'sending'} className={`flex-1 text-white py-3 rounded transition flex items-center justify-center gap-2 ${emailStatus === 'success' ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
                    <span>{emailStatus === 'sending' ? '⏳' : emailStatus === 'success' ? '✅' : '📧'}</span> 
                    {emailStatus === 'sending' ? 'Wysyłanie...' : emailStatus === 'success' ? 'Wysłano!' : 'Wyślij protokół do klienta'}
                </button>
                <button onClick={saveToNotion} disabled={notionStatus === 'saving' || notionStatus === 'uploading_images' || notionStatus === 'success'} className={`flex-1 py-3 rounded text-white font-bold transition flex items-center justify-center gap-2 ${notionStatus === 'success' ? 'bg-green-500' : 'bg-orange-600 hover:bg-orange-700'}`}>
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