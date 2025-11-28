import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      title: "Document Translator",
      subtitle: "(v 1.0.1 - Amazon Translate & Share)",
      secureDl: "Secure Download",
      download: "Download PDF",
      back: "Back to Translator",
      selectFile: "Select PDF file...",
      translateTo: "Translate to:",
      translateBtn: "Translate Document",
      processing: "Translating...",
      uploading: "Uploading: {{progress}}%",
      success: "Translation Complete!",
      share: "Share Result",
      scanQr: "Scan QR code or copy link",
      errorSelect: "Please select a PDF file.",
      errorGeneric: "An error occurred."
    }
  },
  de: {
    translation: {
      title: "Dokumenten Übersetzer",
      subtitle: "(v 1.0.1 - Amazon Translate & Share)",
      secureDl: "Sicherer Download",
      download: "PDF Herunterladen",
      back: "Zurück zum Übersetzer",
      selectFile: "PDF Datei auswählen...",
      translateTo: "Übersetzen nach:",
      translateBtn: "Dokument übersetzen",
      processing: "Übersetze...",
      uploading: "Lade hoch: {{progress}}%",
      success: "Übersetzung abgeschlossen!",
      share: "Ergebnis teilen",
      scanQr: "QR-Code scannen oder Link kopieren",
      errorSelect: "Bitte wählen Sie eine PDF-Datei.",
      errorGeneric: "Ein Fehler ist aufgetreten."
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  });

export default i18n;