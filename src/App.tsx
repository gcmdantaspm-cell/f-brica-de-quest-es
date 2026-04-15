import React, { useState, useEffect, useMemo } from 'react';
import { 
  CheckCircle, XCircle, FileText, Download, BookOpen, 
  ChevronRight, ChevronLeft, Database, PlusCircle, BarChart2, Filter, 
  Search, PlayCircle, Loader2, AlertCircle, Menu, X, User, LogIn, Share2
} from 'lucide-react';

// --- IMPORTAÇÕES DO FIREBASE (NUVEM E AUTENTICAÇÃO) ---
import { signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, collection, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, appId } from './firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId || undefined,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- CONFIGURAÇÃO DA IA ---
const apiKey = process.env.GEMINI_API_KEY || ""; 

// --- DADOS INICIAIS (Caso o banco do usuário esteja vazio) ---
const questoesPadrao = [
  {
    id: "padrao-1",
    texto: "A respeito da subordinação e da área de atuação do Departamento de Polícia Legislativa Federal (Depol), julgue o item a seguir.\n\nO Departamento de Polícia Legislativa Federal subordina-se diretamente ao Presidente da Câmara dos Deputados, prescindindo de vinculação à Diretoria-Geral, e possui atuação restrita às dependências da Casa e às suas áreas circunvizinhas.",
    gabarito: "E",
    justificativa: "Errado. O Depol subordina-se à Diretoria-Geral (e não diretamente ao Presidente, que exerce a suprema direção) e atua em todo o território nacional, e não apenas nas dependências, conforme o art. 2º da Resolução nº 18/2003.",
    materia: "Legislação Institucional",
    topico: "Polícia Legislativa",
    subtopico: "Estrutura e Subordinação",
    status: "nao_resolvida"
  },
  {
    id: "padrao-2",
    texto: "Considerando as competências da Polícia Legislativa, julgue o item subsequente.\n\nA segurança do Presidente da Câmara dos Deputados, bem como a dos demais Deputados Federais em efetivo exercício, será exercida em qualquer localidade do território nacional e no exterior, indiscriminadamente.",
    gabarito: "E",
    justificativa: "Errado. A segurança em qualquer localidade (inclusive no exterior) é regra absoluta apenas para o Presidente. Para os demais Deputados, a regra geral é nas dependências da Câmara.",
    materia: "Legislação Institucional",
    topico: "Polícia Legislativa",
    subtopico: "Competências de Segurança",
    status: "nao_resolvida"
  }
];

export default function App() {
  // --- ESTADOS DE AUTENTICAÇÃO ---
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- ESTADOS DE UI E NAVEGAÇÃO ---
  const [view, setView] = useState('banco'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // --- ESTADOS GERAIS DE DADOS ---
  const [bancoQuestoes, setBancoQuestoes] = useState([]);
  const [historicoResolucoes, setHistoricoResolucoes] = useState([]);
  
  // --- ESTADOS DO GERADOR (IA) ---
  const [textoBase, setTextoBase] = useState('');
  const [materiaInput, setMateriaInput] = useState('');
  const [topicoInput, setTopicoInput] = useState('');
  const [subtopicoInput, setSubtopicoInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [generateError, setGenerateError] = useState('');

  // --- ESTADOS DO BANCO / RESOLUÇÃO ---
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroMateria, setFiltroMateria] = useState('todos');
  const [filtroTopico, setFiltroTopico] = useState('todos');
  const [filtroSubtopico, setFiltroSubtopico] = useState('todos');
  
  const [provaAtual, setProvaAtual] = useState([]);
  const [indiceNavegacao, setIndiceNavegacao] = useState(0);
  const [respostasSessao, setRespostasSessao] = useState({});

  // --- EFEITOS DE ESTILO DE IMPRESSÃO ---
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      @media print {
        body { background-color: white !important; -webkit-print-color-adjust: exact; }
        .no-print { display: none !important; }
        .print-only { display: block !important; }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // --- EFEITO: AUTENTICAÇÃO ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Erro ao fazer login:", error);
      // Mostra uma mensagem mais detalhada para ajudar no debug
      const errorMessage = error.code === 'auth/unauthorized-domain' 
        ? "Este domínio não está autorizado no Firebase Console. Adicione 'f-brica-de-quest-es.vercel.app' em Authentication > Settings > Authorized domains."
        : `Erro ao fazer login: ${error.message}`;
      alert(errorMessage);
    }
  };

  // --- EFEITO: SINCRONIZAÇÃO COM A NUVEM (FIRESTORE) ---
  useEffect(() => {
    if (!user || !db || !isAuthReady) return;

    const qPath = `artifacts/${appId}/users/${user.uid}/questoes`;
    const hPath = `artifacts/${appId}/users/${user.uid}/historico`;

    // Sincroniza Questões
    const qRef = collection(db, qPath);
    const unsubQ = onSnapshot(qRef, (snap) => {
      if (snap.empty) {
        // Se for primeiro acesso, grava as questões padrão para teste
        questoesPadrao.forEach(async (q) => {
          try {
            await setDoc(doc(db, qPath, q.id), q);
          } catch (e) {
            handleFirestoreError(e, OperationType.CREATE, `${qPath}/${q.id}`);
          }
        });
      } else {
        const loaded = snap.docs.map(d => d.data());
        setBancoQuestoes(loaded);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, qPath);
    });

    // Sincroniza Histórico
    const hRef = collection(db, hPath);
    const unsubH = onSnapshot(hRef, (snap) => {
      const loaded = snap.docs.map(d => d.data());
      setHistoricoResolucoes(loaded);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, hPath);
    });

    return () => { unsubQ(); unsubH(); };
  }, [user, isAuthReady]);

  // Atualiza a visualização da tela de prova sempre que o banco atualizar
  useEffect(() => {
    if (bancoQuestoes.length > 0) {
      carregarQuestoes();
    }
  }, [bancoQuestoes, filtroStatus, filtroMateria, filtroTopico, filtroSubtopico]);

  // --- MEMOIZAÇÃO DE CATEGORIAS (Para o Autocomplete do Gerador) ---
  const categoriasSalvas = useMemo(() => {
    return {
      materias: [...new Set(bancoQuestoes.map(q => q.materia).filter(Boolean))],
      topicos: [...new Set(bancoQuestoes.map(q => q.topico).filter(Boolean))],
      subtopicos: [...new Set(bancoQuestoes.map(q => q.subtopico).filter(Boolean))]
    };
  }, [bancoQuestoes]);

  // --- FUNÇÕES DA IA (GEMINI) ---
  const gerarQuestoesIA = async () => {
    if (!textoBase.trim() || !materiaInput.trim() || !topicoInput.trim() || !subtopicoInput.trim()) {
      setGenerateError("Por favor, preencha a Matéria, Tópico, Subtópico e insira o texto base.");
      return;
    }

    setIsGenerating(true);
    setGenerateError('');
    setLoadingStep('Analisando a densidade do texto...');

    // Simulador de progresso analítico
    const steps = [
      "Extraindo conceitos-chave e teses do texto...",
      "Mapeando possíveis 'pegadinhas' estilo CESPE...",
      "Estruturando as assertivas (Certo/Errado)...",
      "Redigindo justificativas detalhadas para o gabarito...",
      "Finalizando o pacote de questões..."
    ];
    let stepIndex = 0;
    const intervalProgress = setInterval(() => {
      if (stepIndex < steps.length - 1) {
        stepIndex++;
        setLoadingStep(steps[stepIndex]);
      }
    }, 4000);

    try {
      const promptText = `
Você é um examinador sênior da banca CEBRASPE/CESPE.
Sua tarefa é ESGOTAR o conteúdo do texto fornecido, criando o MÁXIMO DE QUESTÕES POSSÍVEIS (objetive criar de 10 a 15 questões inéditas, se o texto permitir) no estilo "Certo" ou "Errado".

PADRÃO CEBRASPE OBRIGATÓRIO:
1. CABEÇALHO: Toda questão DEVE iniciar com um comando de contextualização (cabeçalho), seguido de uma quebra de linha dupla (\\n\\n), e só então a assertiva.
   Exemplo: "A respeito do tema abordado no texto, julgue o item a seguir.\\n\\nA assertiva da questão começa aqui..."
2. LINGUAGEM: Mantenha o rigor jurídico/técnico e as "pegadinhas" típicas do CESPE (extrapolação, redução, troca de palavras-chave).

RETORNE APENAS UM ARRAY JSON VÁLIDO no formato:
[
  {
    "texto": "Comando.\\n\\nAssertiva...",
    "gabarito": "C",
    "justificativa": "Explicação detalhada focada no texto..."
  }
]

TEXTO BASE:
${textoBase}
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      clearInterval(intervalProgress);

      if (!response.ok) throw new Error("Erro na comunicação com a IA.");

      const data = await response.json();
      let responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!responseText) throw new Error("A IA não retornou um formato válido.");

      // Força a inserção das categorias EXATAS digitadas pelo usuário
      const novasQuestoes = JSON.parse(responseText).map(q => ({
        ...q,
        materia: materiaInput.trim(),
        topico: topicoInput.trim(),
        subtopico: subtopicoInput.trim(),
        id: crypto.randomUUID(),
        status: 'nao_resolvida'
      }));

      // Salva diretamente na nuvem (Firestore)
      if (user && db) {
        const qPath = `artifacts/${appId}/users/${user.uid}/questoes`;
        novasQuestoes.forEach(async (q) => {
          try {
            await setDoc(doc(db, qPath, q.id), q);
          } catch (e) {
            handleFirestoreError(e, OperationType.CREATE, `${qPath}/${q.id}`);
          }
        });
      }

      setTextoBase('');
      setView('banco');
      setFiltroStatus('todos');
      alert(`Excelente! ${novasQuestoes.length} questões foram geradas e devidamente categorizadas.`);

    } catch (error) {
      clearInterval(intervalProgress);
      console.error(error);
      setGenerateError("Falha ao gerar questões. Verifique se o texto não é excessivamente longo ou tente novamente. " + error.message);
    } finally {
      clearInterval(intervalProgress);
      setIsGenerating(false);
      setLoadingStep('');
    }
  };

  // --- LÓGICA DO BANCO E TELA ÚNICA ---
  const carregarQuestoes = () => {
    let filtradas = bancoQuestoes;
    if (filtroStatus !== 'todos') {
      filtradas = filtradas.filter(q => q.status === filtroStatus);
    }
    if (filtroMateria !== 'todos') {
      filtradas = filtradas.filter(q => q.materia === filtroMateria);
    }
    if (filtroTopico !== 'todos') {
      filtradas = filtradas.filter(q => q.topico === filtroTopico);
    }
    if (filtroSubtopico !== 'todos') {
      filtradas = filtradas.filter(q => q.subtopico === filtroSubtopico);
    }
    
    // Evita resetar a navegação se o array filtrado for o mesmo, para manter a experiência fluida
    if (JSON.stringify(filtradas.map(f=>f.id)) !== JSON.stringify(provaAtual.map(p=>p.id))) {
       setProvaAtual(filtradas);
       setIndiceNavegacao(0);
    } else {
       setProvaAtual(filtradas);
    }
  };

  const responder = async (questaoId, respostaEscolhida, gabaritoOficial) => {
    const acertou = respostaEscolhida === gabaritoOficial;
    const dataHoje = new Date().toISOString().split('T')[0];

    // Atualiza interface instantaneamente
    setRespostasSessao(prev => ({
      ...prev,
      [questaoId]: { escolha: respostaEscolhida, acertou }
    }));

    // Salva na nuvem silenciosamente
    if (user && db) {
      const qPath = `artifacts/${appId}/users/${user.uid}/questoes`;
      const hPath = `artifacts/${appId}/users/${user.uid}/historico`;
      
      const qAtual = bancoQuestoes.find(q => q.id === questaoId);
      if (qAtual) {
        try {
          await setDoc(doc(db, qPath, questaoId), {
            ...qAtual,
            status: acertou ? 'certa' : 'errada'
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `${qPath}/${questaoId}`);
        }
      }
      
      const histId = crypto.randomUUID();
      try {
        await setDoc(doc(db, hPath, histId), {
          id: histId,
          questaoId,
          data: dataHoje,
          acertou
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, `${hPath}/${histId}`);
      }
    }
  };

  const handleShare = async (questao) => {
    const shareText = `Questão de ${questao.materia} (${questao.topico}):\n\n${questao.texto}\n\nResolva mais questões no Deadpool PRO!`;
    const shareUrl = window.location.origin;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Questão Deadpool PRO',
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Erro ao compartilhar:', err);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n\nLink: ${shareUrl}`);
        alert('Questão e link copiados para a área de transferência!');
      } catch (err) {
        console.error('Erro ao copiar:', err);
      }
    }
  };

  // --- ESTATÍSTICAS GLOBAIS ---
  const getEstatisticasGlobais = () => {
    const dataHoje = new Date().toISOString().split('T')[0];
    const feitasHoje = historicoResolucoes.filter(h => h.data === dataHoje);
    const acertosHoje = feitasHoje.filter(h => h.acertou).length;
    
    const totalBanco = bancoQuestoes.length;
    const certasBanco = bancoQuestoes.filter(q => q.status === 'certa').length;
    const erradasBanco = bancoQuestoes.filter(q => q.status === 'errada').length;
    const naoResolvidas = totalBanco - certasBanco - erradasBanco;

    return { feitasHoje: feitasHoje.length, acertosHoje, totalBanco, certasBanco, erradasBanco, naoResolvidas };
  };

  // --- GERAÇÃO DE PDF ---
  const baixarPDF = () => {
    if (provaAtual.length === 0) {
       alert("Não há questões na tela para gerar o PDF.");
       return;
    }

    let htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Caderno de Prova - CEBRASPE</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { text-align: center; border-bottom: 2px solid #1e293b; padding-bottom: 10px; color: #1e293b; }
            .questao { margin-bottom: 35px; text-align: justify; font-size: 14px; white-space: pre-wrap; }
            .opcoes { margin-top: 10px; font-weight: bold; color: #475569; font-size: 13px; }
            .gabarito-item { margin-bottom: 20px; font-size: 14px; }
            .justificativa { font-style: italic; color: #475569; text-align: justify; background-color: #f8fafc; padding: 12px; border-left: 3px solid #94a3b8; margin-top: 6px; white-space: pre-wrap; }
            .page-break { page-break-before: always; }
          </style>
        </head>
        <body>
          <h1>Caderno de Questões</h1>
    `;

    provaAtual.forEach((q, index) => {
      htmlContent += `
          <div class="questao">
            <strong>${index + 1}. (${q.materia} > ${q.topico})</strong><br/><br/> ${q.texto}
            <div class="opcoes">( &nbsp; ) CERTO &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ( &nbsp; ) ERRADO</div>
          </div>
      `;
    });

    htmlContent += `<div class="page-break"></div><h2>Gabarito e Justificativas</h2>`;

    provaAtual.forEach((q, index) => {
      htmlContent += `
          <div class="gabarito-item">
            <strong>Questão ${index + 1}:</strong> <span style="color: ${q.gabarito === 'C' ? '#16a34a' : '#dc2626'}; font-weight: bold;">${q.gabarito === 'C' ? 'Certo' : 'Errado'}</span>
            <div class="justificativa">${q.justificativa}</div>
          </div>
      `;
    });

    htmlContent += `</body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    } else {
      alert("⚠️ O navegador bloqueou o PDF. Permita os Pop-ups.");
    }
  };

  // --- COMPONENTES DE TELA ---
  const TopBar = ({ title }) => (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-4 sticky top-0 z-30 shadow-sm no-print">
      <button 
        onClick={() => setIsSidebarOpen(true)}
        className="p-1.5 hover:bg-slate-100 rounded-md text-slate-700 transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>
      <h1 className="text-lg font-bold text-slate-800 flex-1">{title}</h1>
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-md border border-slate-100">
        <User className="w-4 h-4 text-blue-500"/>
        {user ? user.displayName || 'Sincronizado' : 'Não logado'}
      </div>
    </div>
  );

  const Sidebar = () => (
    <>
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity no-print"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 transform transition-transform duration-300 ease-in-out shadow-2xl no-print ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-2 text-white">
            <BookOpen className="w-6 h-6 text-blue-500" />
            <h2 className="text-lg font-black tracking-tight">Deadpool<br/><span className="text-blue-500 text-xs">PRO</span></h2>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <nav className="flex-1 py-4 flex flex-col gap-1.5 px-3">
          {[
            { id: 'banco', icon: PlayCircle, label: 'Modo Resolução', desc: 'Faça questões na hora' },
            { id: 'gerador', icon: PlusCircle, label: 'Fábrica (IA)', desc: 'Crie questões de textos' },
            { id: 'dashboard', icon: BarChart2, label: 'Meu Desempenho', desc: 'Estatísticas salvas' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => { setView(item.id); setIsSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left ${
                view === item.id ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-800 hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-bold text-sm">{item.label}</div>
                <div className={`text-[10px] ${view === item.id ? 'text-blue-200' : 'text-slate-500'}`}>{item.desc}</div>
              </div>
            </button>
          ))}
        </nav>
      </div>
    </>
  );

  const renderDashboard = () => {
    const stats = getEstatisticasGlobais();
    return (
      <div className="animate-in fade-in flex-1 flex flex-col bg-slate-50 min-h-screen">
        <TopBar title="Meu Desempenho" />
        <div className="p-4 md:p-6 max-w-5xl mx-auto w-full">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200">
              <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Feitas Hoje</h3>
              <div className="flex items-end gap-1.5">
                <span className="text-3xl font-black text-slate-800">{stats.feitasHoje}</span>
              </div>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200 border-b-4 border-b-green-500">
              <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Certas (Geral)</h3>
              <div className="flex items-end gap-1.5">
                <span className="text-3xl font-black text-green-600">{stats.certasBanco}</span>
                <span className="text-xs font-semibold text-slate-400 mb-1">/ {stats.totalBanco}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200 border-b-4 border-b-red-500">
              <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Erradas (Geral)</h3>
              <div className="flex items-end gap-1.5">
                <span className="text-3xl font-black text-red-600">{stats.erradasBanco}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200">
              <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">No Banco</h3>
              <div className="flex items-end gap-1.5">
                <span className="text-3xl font-black text-blue-600">{stats.totalBanco}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderGerador = () => (
    <div className="animate-in fade-in flex-1 flex flex-col bg-slate-50 min-h-screen">
      <TopBar title="Fábrica de Questões (IA)" />
      
      {/* Datalists para Autocomplete */}
      <datalist id="materias-list">
        {categoriasSalvas.materias.map(m => <option key={m} value={m} />)}
      </datalist>
      <datalist id="topicos-list">
        {categoriasSalvas.topicos.map(t => <option key={t} value={t} />)}
      </datalist>
      <datalist id="subtopicos-list">
        {categoriasSalvas.subtopicos.map(s => <option key={s} value={s} />)}
      </datalist>

      <div className="p-4 md:p-6 max-w-4xl mx-auto w-full">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 md:p-6">
          <p className="text-slate-500 text-sm font-medium mb-6">Insira a lei ou texto. A IA tentará esgotar o conteúdo criando o máximo de questões possíveis.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Matéria</label>
              <input list="materias-list" value={materiaInput} onChange={e => setMateriaInput(e.target.value)} placeholder="Ex: Const." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold text-slate-700" disabled={isGenerating} />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Tópico</label>
              <input list="topicos-list" value={topicoInput} onChange={e => setTopicoInput(e.target.value)} placeholder="Ex: Direitos Fund." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold text-slate-700" disabled={isGenerating} />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Subtópico</label>
              <input list="subtopicos-list" value={subtopicoInput} onChange={e => setSubtopicoInput(e.target.value)} placeholder="Ex: Art. 5º" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold text-slate-700" disabled={isGenerating} />
            </div>
          </div>

          <div className="flex flex-col h-[280px]">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5"/> Texto Base da Lei/Doutrina</label>
            <textarea 
              value={textoBase}
              onChange={(e) => setTextoBase(e.target.value)}
              placeholder="Cole o texto aqui..."
              className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-lg resize-none focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium text-slate-700 leading-relaxed"
              disabled={isGenerating}
            />
          </div>

          <div className="mt-5 flex justify-end">
            <button 
              onClick={gerarQuestoesIA}
              disabled={isGenerating || !textoBase.trim() || !materiaInput.trim() || !topicoInput.trim() || !subtopicoInput.trim()}
              className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-6 py-2.5 rounded-lg font-bold transition-all flex items-center justify-center gap-2 shadow-sm text-sm"
            >
              {isGenerating ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin"/> 
                  <span>{loadingStep}</span>
                </div>
              ) : (
                <><PlusCircle className="w-4 h-4"/> Gerar Bateria de Questões</>
              )}
            </button>
          </div>
          
          {generateError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-2 text-sm font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <p>{generateError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderModoResolucao = () => {
    const materiasUnicas = ['todos', ...new Set(bancoQuestoes.map(q => q.materia).filter(Boolean))];
    const topicosUnicos = ['todos', ...new Set(bancoQuestoes.filter(q => filtroMateria === 'todos' || q.materia === filtroMateria).map(q => q.topico).filter(Boolean))];
    const subtopicosUnicos = ['todos', ...new Set(bancoQuestoes.filter(q => (filtroMateria === 'todos' || q.materia === filtroMateria) && (filtroTopico === 'todos' || q.topico === filtroTopico)).map(q => q.subtopico).filter(Boolean))];

    const qAtual = provaAtual[indiceNavegacao];
    const respostaAtual = qAtual ? respostasSessao[qAtual.id] : null;

    return (
      <div className="animate-in fade-in flex-1 flex flex-col bg-slate-100 min-h-screen">
        <TopBar title="Modo Resolução Rápida" />

        {/* BARRA DE FILTROS SUPERIOR */}
        <div className="bg-white border-b border-slate-200 px-3 py-3 md:px-6 shadow-sm shrink-0 z-20 overflow-x-auto">
          <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-3 items-center min-w-max lg:min-w-0">
            
            <div className="flex w-full lg:w-auto gap-2 items-center bg-slate-50 p-1.5 rounded-lg border border-slate-200 flex-1">
              <Filter className="w-4 h-4 text-slate-400 ml-1 shrink-0"/>
              
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} className="bg-transparent text-slate-700 font-semibold outline-none flex-1 truncate text-xs min-w-[100px]">
                <option value="todos">Status: Todos</option>
                <option value="nao_resolvida">Pendente</option>
                <option value="errada">Errei</option>
                <option value="certa">Acertei</option>
              </select>
              <div className="w-px h-4 bg-slate-300"></div>

              <select value={filtroMateria} onChange={e => { setFiltroMateria(e.target.value); setFiltroTopico('todos'); setFiltroSubtopico('todos'); }} className="bg-transparent text-slate-700 font-semibold outline-none flex-1 truncate text-xs min-w-[110px]">
                {materiasUnicas.map(m => <option key={m} value={m}>{m === 'todos' ? 'Matéria: Todas' : m}</option>)}
              </select>
              <div className="w-px h-4 bg-slate-300"></div>

              <select value={filtroTopico} onChange={e => { setFiltroTopico(e.target.value); setFiltroSubtopico('todos'); }} className="bg-transparent text-slate-700 font-semibold outline-none flex-1 truncate text-xs min-w-[110px]">
                {topicosUnicos.map(t => <option key={t} value={t}>{t === 'todos' ? 'Tópico: Todos' : t}</option>)}
              </select>
              <div className="w-px h-4 bg-slate-300"></div>

              <select value={filtroSubtopico} onChange={e => setFiltroSubtopico(e.target.value)} className="bg-transparent text-slate-700 font-semibold outline-none flex-1 truncate text-xs pr-1 min-w-[120px]">
                {subtopicosUnicos.map(s => <option key={s} value={s}>{s === 'todos' ? 'Subtópico: Todos' : s}</option>)}
              </select>
            </div>

            <div className="flex w-full lg:w-auto gap-2 shrink-0">
              <button onClick={carregarQuestoes} className="flex-1 lg:flex-none bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm">
                <Search className="w-4 h-4"/> Pesquisar
              </button>
              <button onClick={baixarPDF} disabled={provaAtual.length === 0} className="flex-1 lg:flex-none bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1.5">
                <Download className="w-4 h-4"/> PDF
              </button>
            </div>
            
          </div>
        </div>

        {/* TELA DE QUESTÃO CENTRALIZADA E COMPACTA */}
        <div className="flex-1 flex flex-col items-center justify-start p-3 md:p-6 overflow-y-auto">
          {provaAtual.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 mt-12">
              <Database className="w-12 h-12 mb-3 opacity-20" />
              <h2 className="text-lg font-bold text-slate-500">Nenhuma questão encontrada.</h2>
            </div>
          ) : (
            <div className="w-full max-w-3xl flex gap-3 relative">
              
              <button 
                onClick={() => setIndiceNavegacao(prev => Math.max(0, prev - 1))}
                disabled={indiceNavegacao === 0}
                className="hidden md:flex items-center justify-center w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-blue-600 disabled:opacity-30 transition-all absolute top-1/2 -left-14 -translate-y-1/2"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              <div className="flex-1 bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-5 py-3 border-b border-slate-100 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                     <span className="bg-blue-600 text-white font-bold px-3 py-1 rounded text-sm shadow-sm">
                       Q{indiceNavegacao + 1}
                     </span>
                     <div>
                       <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{qAtual.materia}</div>
                       <div className="text-xs font-bold text-slate-700">{qAtual.topico} <span className="text-slate-400 font-normal">› {qAtual.subtopico}</span></div>
                     </div>
                   </div>
                   <div className="flex items-center gap-3">
                     <div className="text-xs font-bold text-slate-400">
                       {indiceNavegacao + 1} / {provaAtual.length}
                     </div>
                     <button 
                       onClick={() => handleShare(qAtual)}
                       className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                       title="Compartilhar Questão"
                     >
                       <Share2 className="w-4 h-4" />
                     </button>
                   </div>
                </div>

                <div className="p-5 md:p-6">
                  {/* TEXTO DA QUESTÃO MENOR E CONFORTÁVEL */}
                  <p className="text-[15px] sm:text-base text-slate-800 leading-relaxed font-medium whitespace-pre-wrap text-justify">
                    {qAtual.texto}
                  </p>

                  {/* BOTÕES DE RESPOSTA MAIS COMPACTOS */}
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    <button 
                      onClick={() => responder(qAtual.id, 'C', qAtual.gabarito)}
                      className={`group border-2 font-bold text-sm py-3 rounded-xl transition-all flex items-center justify-center gap-2 ${
                        respostaAtual?.escolha === 'C' 
                          ? 'bg-blue-600 border-blue-600 text-white' 
                          : 'bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                    >
                      <CheckCircle className={`w-5 h-5 ${respostaAtual?.escolha === 'C' ? 'text-white' : 'text-blue-500'} transition-transform`} />
                      CERTO
                    </button>
                    <button 
                      onClick={() => responder(qAtual.id, 'E', qAtual.gabarito)}
                      className={`group border-2 font-bold text-sm py-3 rounded-xl transition-all flex items-center justify-center gap-2 ${
                        respostaAtual?.escolha === 'E' 
                          ? 'bg-red-600 border-red-600 text-white' 
                          : 'bg-white border-slate-200 text-slate-600 hover:border-red-400 hover:text-red-600 hover:bg-red-50'
                      }`}
                    >
                      <XCircle className={`w-5 h-5 ${respostaAtual?.escolha === 'E' ? 'text-white' : 'text-red-500'} transition-transform`} />
                      ERRADO
                    </button>
                  </div>

                  {/* CAIXA DE JUSTIFICATIVA MENOR E REFINADA */}
                  {respostaAtual && (
                    <div className="mt-5 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className={`p-4 rounded-xl border ${respostaAtual.acertou ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="flex items-center gap-2 mb-3">
                          {respostaAtual.acertou ? <CheckCircle className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
                          <h3 className={`text-base font-bold ${respostaAtual.acertou ? 'text-green-800' : 'text-red-800'}`}>
                            {respostaAtual.acertou ? 'Correto!' : 'Incorreto.'}
                          </h3>
                        </div>
                        
                        <div className="bg-white p-4 rounded-lg border border-slate-100 shadow-sm text-sm">
                          <div className="mb-3">
                            <span className="text-slate-500 font-bold uppercase tracking-wider text-[11px] mr-2">Gabarito: </span> 
                            <span className={`font-bold px-2 py-1 rounded text-xs ${qAtual.gabarito === 'C' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
                              {qAtual.gabarito === 'C' ? 'CERTO' : 'ERRADO'}
                            </span>
                          </div>
                          <div className="w-full h-px bg-slate-100 mb-3"></div>
                          <p className="text-slate-700 leading-relaxed text-justify">
                            <strong className="text-slate-800 block mb-1 text-xs"><BookOpen className="w-4 h-4 inline mr-1 text-slate-400"/> Justificativa:</strong>
                            {qAtual.justificativa}
                          </p>
                        </div>
                      </div>

                      <button 
                        onClick={() => setIndiceNavegacao(prev => Math.min(provaAtual.length - 1, prev + 1))}
                        disabled={indiceNavegacao === provaAtual.length - 1}
                        className="md:hidden mt-4 w-full bg-slate-900 text-white text-sm font-bold py-3 rounded-lg flex items-center justify-center gap-1.5"
                      >
                        Próxima <ChevronRight className="w-5 h-5"/>
                      </button>
                    </div>
                  )}

                </div>
              </div>

              <button 
                onClick={() => setIndiceNavegacao(prev => Math.min(provaAtual.length - 1, prev + 1))}
                disabled={indiceNavegacao === provaAtual.length - 1}
                className="hidden md:flex items-center justify-center w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-blue-600 disabled:opacity-30 transition-all absolute top-1/2 -right-14 -translate-y-1/2"
              >
                <ChevronRight className="w-6 h-6" />
              </button>

            </div>
          )}
        </div>
      </div>
    );
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-slate-200">
          <BookOpen className="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-slate-800 mb-2">Deadpool PRO</h1>
          <p className="text-slate-500 mb-8 text-sm">Faça login para salvar suas questões, histórico e utilizar a IA geradora.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md"
          >
            <LogIn className="w-5 h-5" />
            Entrar com Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex bg-slate-100 min-h-screen font-sans">
      <Sidebar />
      {view === 'dashboard' && renderDashboard()}
      {view === 'gerador' && renderGerador()}
      {view === 'banco' && renderModoResolucao()}
    </div>
  );
}
