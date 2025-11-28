import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { Amplify } from 'aws-amplify';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import outputs from '../amplify_outputs.json';

// I18n & UI
import './i18n';
import { useTranslation } from 'react-i18next';
import { FaCloudUploadAlt, FaSpinner, FaCheckCircle, FaGlobe, FaFilePdf, FaCopy, FaFileWord, FaShareAlt, FaDownload } from 'react-icons/fa';
import { QRCodeSVG } from 'qrcode.react';
import './App.css';

Amplify.configure(outputs);

const client = generateClient<Schema>();

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
];

function DownloadView({ fileName }: { fileName: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLink = async () => {
      try {
        // Pfad sicherstellen: Falls 'translated/' fehlt, hinzufügen.
        // Falls der Pfad bereits korrekt ist (wie durch den Fix unten), so lassen.
        const path = fileName.startsWith('translated/') ? fileName : `translated/${fileName}`;
        console.log("Fetching Download URL for:", path);
        
        const link = await getUrl({ 
          path, 
          options: { validateObjectExistence: false, expiresIn: 3600 }
        });
        setUrl(link.url.toString());
      } catch (e) {
        console.error("Download Error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchLink();
  }, [fileName]);

  const isDocx = fileName.toLowerCase().endsWith('.docx');

  return (
    <div className="app-container" style={{ textAlign: 'center', paddingTop: 50 }}>
      <h1>{t('secureDl')}</h1>
      {isDocx ? 
        <FaFileWord size={60} style={{ color: '#2b579a', margin: '20px 0' }} /> :
        <FaFilePdf size={60} style={{ color: 'var(--primary)', margin: '20px 0' }} />
      }
      <p style={{ wordBreak: 'break-all', color: '#fff' }}>{fileName.split('/').pop()}</p>
      {loading ? <FaSpinner className="icon-spin" /> : url ? (
        <a href={url} className="primary-btn" style={{ maxWidth: '200px', margin: '0 auto', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FaDownload style={{marginRight: '8px'}} /> {t('download')}
        </a>
      ) : <p style={{ color: 'red' }}>File not found.</p>}
      <div style={{ marginTop: 40 }}><a href="/" style={{ color: '#888' }}>{t('back')}</a></div>
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const params = new URLSearchParams(window.location.search);
  const shareFile = params.get('file');

  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const [status, setStatus] = useState<'IDLE'|'UPLOADING'|'PROCESSING'|'DONE'|'ERROR'>('IDLE');
  const [progress, setProgress] = useState(0);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [directDownloadUrl, setDirectDownloadUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const pollRef = useRef<any>(null);

  useEffect(() => {
    fetchAuthSession().catch(e => console.error("Session Init Error:", e));
    return () => clearInterval(pollRef.current);
  }, []);

  if (shareFile) return <DownloadView fileName={shareFile} />;

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files ? event.target.files[0] : null;
    setFile(null); 
    setStatus('IDLE');
    setErrorMsg(null); 
    setShareLink(null);
    setDirectDownloadUrl(null);
    setProgress(0);

    if (selectedFile) {
      const name = selectedFile.name.toLowerCase();
      const isPdf = selectedFile.type === 'application/pdf' || name.endsWith('.pdf');
      const isDocx = name.endsWith('.docx') || 
                      selectedFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      if (isPdf || isDocx) {
        setFile(selectedFile);
      } else {
        setErrorMsg('Please select a PDF or DOCX file.');
      }
    }
  };

  const copyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startTranslation = async () => {
    if (!file) return;
    setStatus('UPLOADING');
    setProgress(0);
    setErrorMsg(null);

    try {
      await fetchAuthSession();

      // Leerzeichen durch _ ersetzen für S3 Kompatibilität
      const cleanName = file.name.replace(/\s+/g, '_');
      const s3Path = `uploads/${Date.now()}/${cleanName}`;
      
      await uploadData({
        path: s3Path, 
        data: file,
        options: {
          onProgress: (p) => p.totalBytes && setProgress(Math.round((p.transferredBytes / p.totalBytes) * 100))
        }
      }).result;
      
      setStatus('PROCESSING');
      
      console.log('Upload complete. Waiting for consistency...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const { data: startData, errors: startErrors } = await client.queries.translateDocument({
        s3Key: s3Path,
        targetLang,
        action: 'start'
      });

      if (startErrors) throw new Error(startErrors[0].message);
      const startRes = startData ? JSON.parse(startData as string) : {};
      
      if (startRes.status !== 'JOB_STARTED') {
        throw new Error(startRes.error || 'Failed to start job');
      }

      const jobId = startRes.jobId;
      console.log('Job Started:', jobId);

      pollRef.current = setInterval(async () => {
        try {
          const { data: checkData, errors: checkErrors } = await client.queries.translateDocument({
            jobId,
            action: 'check',
            s3Key: s3Path
          });

          if (checkErrors) {
             console.error(checkErrors);
             return; 
          }

          const checkRes = checkData ? JSON.parse(checkData as string) : {};
          console.log('Job Status:', checkRes);

          if (checkRes.status === 'DONE') {
             clearInterval(pollRef.current);
             
             // --- LOGIK KORREKTUR START ---
             let finalPath = checkRes.downloadPath; 
             // Typischer Pfad vom Backend: "translated/JOB-ID/uploads/timestamp/file.docx"
             // Wir benötigen: "translated/JOB-ID/targetLang.cleanFilename.docx"
             
             const pathParts = finalPath.split('/');
             
             // Wir prüfen, ob wir mindestens 'translated' und die 'JOB-ID' haben
             if (pathParts.length >= 2 && file) {
                 const folderPrefix = pathParts[0]; // "translated"
                 const jobIdFolder = pathParts[1];  // Die lange Job-ID (z.B. 74666...-TranslateText-...)
                 
                 const correctFileName = `${targetLang}.${file.name.replace(/\s+/g, '_')}`;
                 
                 // Korrekter S3 Key zusammenbauen
                 finalPath = `${folderPrefix}/${jobIdFolder}/${correctFileName}`;
                 console.log("Constructed S3 Key:", finalPath);
             }
             // --- LOGIK KORREKTUR ENDE ---
             
             // 1. Link für Share/QR Code (Public Page)
             const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
             if (isLocalhost) {
                // Lokal direkt S3 URL nutzen
                const urlData = await getUrl({ path: finalPath });
                setShareLink(urlData.url.toString());
                setDirectDownloadUrl(urlData.url.toString());
             } else {
                // Production: Link auf die App selbst mit Parameter
                setShareLink(`${window.location.origin}/?file=${encodeURIComponent(finalPath)}`);
                
                // 2. Link für direkten Download Button (Signierte S3 URL holen)
                const downloadUrlData = await getUrl({ path: finalPath });
                setDirectDownloadUrl(downloadUrlData.url.toString());
             }
             
             setStatus('DONE');
          } else if (checkRes.status === 'ERROR') {
             clearInterval(pollRef.current);
             setStatus('ERROR');
             setErrorMsg(checkRes.error);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 5000);

    } catch (err: any) {
      console.error(err);
      setStatus('ERROR');
      setErrorMsg(err.message || t('errorGeneric'));
    }
  };

  return (
    <div className="app-container">
      <div className="lang-switch">
        <button className={i18n.language === 'en' ? 'active' : ''} onClick={() => i18n.changeLanguage('en')}>EN</button> | 
        <button className={i18n.language === 'de' ? 'active' : ''} onClick={() => i18n.changeLanguage('de')}>DE</button>
      </div>
      <header className="header">
        <h1><FaGlobe style={{ color: 'var(--primary)' }} /> {t('title')}</h1>
        <p className="subtitle">{t('subtitle')}</p>
      </header>
      <main className="card">
        <div className={`file-input-wrapper ${file ? 'active' : ''}`}>
          <label style={{ width: '100%', display: 'block', cursor: 'pointer' }}>
            <input 
              type="file" 
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
              onChange={handleFileSelect} 
              hidden 
              disabled={status === 'UPLOADING' || status === 'PROCESSING'} 
            />
            {file && file.name.endsWith('.docx') ? 
              <FaFileWord size={50} color="#2b579a" /> :
              <FaCloudUploadAlt size={50} color={file ? 'var(--primary)' : '#666'} />
            }
            <p>{file ? file.name : t('selectFile')}</p>
          </label>
        </div>
        {file && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <label style={{ fontSize: '0.9rem', color: '#aaa' }}>{t('translateTo')}</label>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} disabled={status !== 'IDLE' && status !== 'DONE' && status !== 'ERROR'}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <button className="primary-btn" onClick={startTranslation} disabled={status === 'UPLOADING' || status === 'PROCESSING'}>
              {status === 'UPLOADING' ? t('uploading', { progress }) : 
               status === 'PROCESSING' ? <><FaSpinner className="icon-spin" /> {t('processing')}</> : 
               t('translateBtn')}
            </button>
          </div>
        )}
        {errorMsg && <p style={{ color: '#ff4444', marginTop: 15, textAlign: 'center' }}>{errorMsg}</p>}
        {status === 'DONE' && shareLink && (
          <div className="result-area">
            <h3><FaCheckCircle /> {t('success')}</h3>
            
            <div className="qr-box" style={{ marginTop: 25, background: '#eee', padding: 20, borderRadius: 10, width: '100%' }}>
              <h4 style={{margin: '0 0 15px 0', color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
                <FaShareAlt /> {t('share')}
              </h4>
              <div style={{ background: 'white', padding: '10px', display: 'inline-block', borderRadius: '5px' }}>
                <QRCodeSVG value={shareLink} size={150} level={"L"} includeMargin={true} />
              </div>
              
              <div style={{ display: 'flex', marginTop: 15, gap: 5, marginBottom: 15 }}>
                <input readOnly value={shareLink} style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} onClick={(e) => e.currentTarget.select()} />
                <button onClick={copyLink} style={{ background: 'var(--primary)', border: 'none', borderRadius: '4px', padding: '0 15px', cursor: 'pointer', color: 'white' }}>{copied ? <FaCheckCircle /> : <FaCopy />}</button>
              </div>

              {/* HIER IST DER NEUE DOWNLOAD BUTTON */}
              {directDownloadUrl && (
                  <a href={directDownloadUrl} target="_blank" rel="noopener noreferrer" className="primary-btn" style={{ 
                      textDecoration: 'none', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      background: '#2b579a', // Etwas andere Farbe zur Unterscheidung
                      marginTop: '10px'
                  }}>
                    <FaDownload style={{marginRight: '8px'}} /> {t('download')}
                  </a>
              )}

              <p style={{fontSize: '0.8rem', color: '#666', marginTop: '10px'}}>
                {window.location.hostname === 'localhost' 
                  ? "Dev-Mode: Direct S3 Link" 
                  : "Share this secure link to download"}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;