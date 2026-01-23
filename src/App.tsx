import React, { useState, useRef, useEffect } from 'react';
import { Send, Upload, BookOpen, Loader2, MessageSquare } from 'lucide-react';

// PDF.js type declarations
interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
}

interface PDFPageProxy {
    getViewport(params: { scale: number }): PDFPageViewport;
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: PDFPageViewport }): { promise: Promise<void> };
    getTextContent(): Promise<TextContent>;
}

interface PDFPageViewport {
    width: number;
    height: number;
}

interface TextContent {
    items: Array<{ str: string }>;
}

interface PDFJSLib {
    getDocument(src: Uint8Array): { promise: Promise<PDFDocumentProxy> };
    GlobalWorkerOptions: {
        workerSrc: string;
    };
}

declare global {
    interface Window {
        pdfjsLib: PDFJSLib;
    }
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface GeminiResponse {
    candidates?: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
}

const PDFAITutor: React.FC = () => {
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [pdfText, setPdfText] = useState<string>('');
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [totalPages, setTotalPages] = useState<number>(0);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    // const [apiKey, setApiKey] = useState<string>('');
    // const [showApiInput, setShowApiInput] = useState<boolean>(true);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = (): void => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const loadPDFJS = async (): Promise<void> => {
        if (window.pdfjsLib) return;

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.async = true;

        return new Promise((resolve, reject) => {
            script.onload = () => {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    const extractTextFromPDF = async (pdf: PDFDocumentProxy): Promise<string> => {
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item) => item.str).join(' ');
            fullText += `\n--- Page ${i} ---\n${pageText}`;
        }
        return fullText;
    };

    const renderPage = async (pageNum: number): Promise<void> => {
        if (!pdfDocRef.current || !canvasRef.current) return;

        const page = await pdfDocRef.current.getPage(pageNum);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) return;

        const viewport = page.getViewport({ scale: 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0];
        if (!file || file.type !== 'application/pdf') {
            alert('Please upload a PDF file');
            return;
        }

        await loadPDFJS();

        const reader = new FileReader();
        reader.onload = async (event: ProgressEvent<FileReader>) => {
            if (!event.target?.result) return;

            const typedArray = new Uint8Array(event.target.result as ArrayBuffer);
            const pdf = await window.pdfjsLib.getDocument(typedArray).promise;

            pdfDocRef.current = pdf;
            setTotalPages(pdf.numPages);
            setCurrentPage(1);
            setPdfFile(file);

            const text = await extractTextFromPDF(pdf);
            setPdfText(text);

            await renderPage(1);

            setMessages([{
                role: 'assistant',
                content: `PDF loaded! I've analyzed all ${pdf.numPages} pages. Ask me anything about the content!`
            }]);
        };

        reader.readAsArrayBuffer(file);
    };

    const changePage = async (delta: number): Promise<void> => {
        const newPage = currentPage + delta;
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
            await renderPage(newPage);
        }
    };

    const sendMessage = async (): Promise<void> => {
        // if (!input.trim() || !pdfText || !apiKey) return;
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

        if (!apiKey) throw new Error("Gemini API key is missing");

        const userMessage: Message = { role: 'user', content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setLoading(true);

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `You are a helpful educational AI assistant. The student is currently on page ${currentPage} of ${totalPages}.

Here is the full PDF content:
${pdfText}

Student's question: ${input}

Provide a clear, educational answer based on the PDF content. If relevant, mention which page(s) contain the information.`
                        }]
                    }]
                })
            });

            const data: GeminiResponse = await response.json();

            if (data.candidates && data.candidates[0]) {
                const aiResponse: Message = {
                    role: 'assistant',
                    content: data.candidates[0].content.parts[0].text
                };
                setMessages(prev => [...prev, aiResponse]);
            } else {
                throw new Error('Invalid response from API');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error: ${errorMessage}. Please check your API key and try again.`
            }]);
        }

        setLoading(false);
    };

    // const saveApiKey = (): void => {
    //     if (apiKey.trim()) {
    //         setShowApiInput(false);
    //     }
    // };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Enter' && !loading) {
            sendMessage();
        }
    };

    // const handleApiKeyPress = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    //     if (e.key === 'Enter') {
    //         saveApiKey();
    //     }
    // };

    return (
        <div className="flex h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
            {/* API Key Modal */}
            {/*{showApiInput && (*/}
            {/*    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">*/}
            {/*        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-blue-500/20">*/}
            {/*            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">*/}
            {/*                <BookOpen className="w-6 h-6 text-blue-400" />*/}
            {/*                Setup Required*/}
            {/*            </h2>*/}
            {/*            <p className="text-slate-300 mb-6">*/}
            {/*                Get your free Gemini API key from{' '}*/}
            {/*                <a*/}
            {/*                    href="https://aistudio.google.com/app/apikey"*/}
            {/*                    target="_blank"*/}
            {/*                    rel="noopener noreferrer"*/}
            {/*                    className="text-blue-400 hover:text-blue-300 underline"*/}
            {/*                >*/}
            {/*                    Google AI Studio*/}
            {/*                </a>*/}
            {/*            </p>*/}
            {/*            <input*/}
            {/*                type="password"*/}
            {/*                value={apiKey}*/}
            {/*                onChange={(e) => setApiKey(e.target.value)}*/}
            {/*                placeholder="Paste your API key here"*/}
            {/*                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"*/}
            {/*                onKeyPress={handleApiKeyPress}*/}
            {/*            />*/}
            {/*            <button*/}
            {/*                onClick={saveApiKey}*/}
            {/*                disabled={!apiKey.trim()}*/}
            {/*                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"*/}
            {/*            >*/}
            {/*                Continue*/}
            {/*            </button>*/}
            {/*        </div>*/}
            {/*    </div>*/}
            {/*)}*/}

            {/* PDF Viewer */}
            <div className="flex-1 flex flex-col bg-slate-800 border-r border-slate-700">
                <div className="bg-slate-900/50 p-4 border-b border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <BookOpen className="w-6 h-6 text-blue-400" />
                        <h1 className="text-xl font-bold text-white">AI PDF Learning Assistant</h1>
                    </div>
                    <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
                        <Upload className="w-4 h-4" />
                        Upload PDF
                        <input
                            type="file"
                            accept=".pdf"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                    </label>
                </div>

                <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-slate-900/30">
                    {pdfFile ? (
                        <canvas ref={canvasRef} className="shadow-2xl max-w-full" />
                    ) : (
                        <div className="text-center text-slate-400">
                            <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p className="text-lg">Upload a PDF to get started</p>
                            <p className="text-sm mt-2">Your AI tutor will help you understand the content</p>
                        </div>
                    )}
                </div>

                {pdfFile && (
                    <div className="bg-slate-900/50 p-4 border-t border-slate-700 flex items-center justify-center gap-4">
                        <button
                            onClick={() => changePage(-1)}
                            disabled={currentPage <= 1}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                        >
                            Previous
                        </button>
                        <span className="text-white font-medium">
              Page {currentPage} of {totalPages}
            </span>
                        <button
                            onClick={() => changePage(1)}
                            disabled={currentPage >= totalPages}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>

            {/* Chat Sidebar */}
            <div className="w-96 flex flex-col bg-slate-800">
                <div className="bg-slate-900/50 p-4 border-b border-slate-700">
                    <div className="flex items-center gap-2 text-white">
                        <MessageSquare className="w-5 h-5 text-blue-400" />
                        <h2 className="font-bold">AI Tutor</h2>
                    </div>
                    {pdfFile && (
                        <p className="text-xs text-slate-400 mt-1">
                            Ask questions about {pdfFile.name}
                        </p>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.length === 0 && !pdfFile && (
                        <div className="text-center text-slate-400 mt-8">
                            <p>Upload a PDF to start learning</p>
                        </div>
                    )}

                    {messages.map((msg, idx) => (
                        <div
                            key={idx}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[85%] p-3 rounded-lg ${
                                    msg.role === 'user'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-slate-700 text-slate-100'
                                }`}
                            >
                                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div className="flex justify-start">
                            <div className="bg-slate-700 text-slate-100 p-3 rounded-lg flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm">Thinking...</span>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                <div className="p-4 border-t border-slate-700">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder={pdfFile ? "Ask about the PDF..." : "Upload a PDF first"}
                            disabled={!pdfFile || loading}
                            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        />
                        <button
                            onClick={sendMessage}
                            disabled={!input.trim() || loading || !pdfFile}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PDFAITutor;