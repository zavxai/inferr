'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useAuthFetch, API_BASE, SessionExpiredError } from '@/src/lib/auth-context';
import { InterestsDialog } from '@/src/components/InterestsDialog';
import { Navbar } from '@/src/components/Navbar';
import styles from './chat.module.css';

interface Source {
  title: string;
  url: string;
  source: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

const SOURCE_LABEL: Record<string, string> = { hn: 'HN', devto: 'Dev.to' };

const SUGGESTIONS = [
  { text: "What's new in Rust this week?", icon: "🦀", desc: "Get semantic search updates on Rust" },
  { text: "Explain pgvector HNSW vs IVFFlat benchmarks", icon: "📊", desc: "Compare database vector indexes" },
  { text: "Summarise the top articles about AI and LLMs", icon: "✨", desc: "Read a quick digest of trending AI news" },
];

export default function ChatPage() {
  const router = useRouter();
  const { token, ready } = useAuth();
  const authFetch = useAuthFetch();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showInterests, setShowInterests] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ready && !token) { router.push('/'); }
  }, [router, token, ready]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (textToSend?: string) => {
    const message = (textToSend ?? input).trim();
    if (!message || loading || !token) return;

    const historyForApi = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const res = await authFetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: historyForApi }),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, sources: data.sources },
      ]);
    } catch (err) {
      if (err instanceof SessionExpiredError) { router.push('/'); return; }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: err instanceof Error ? err.message : 'Something went wrong.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const handleSuggestionClick = (suggestionText: string) => {
    setInput(suggestionText);
    if (textareaRef.current) {
      textareaRef.current.focus();
      // Adjust height for the filled suggestion
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
      }, 0);
    }
  };

  return (
    <div className={`${styles.page} pageGlow`}>
      {showInterests && (
        <InterestsDialog onClose={() => setShowInterests(false)} />
      )}

      {/* Persistent floating glass navbar */}
      <Navbar onEditInterests={() => setShowInterests(true)} />

      <div className={styles.body}>
        <div className={styles.history}>
          {messages.length === 0 && (
            <div className={styles.empty}>
              {/* Suggestions Grid */}
              <div className={styles.suggestionsGrid}>
                {SUGGESTIONS.map((s, idx) => (
                  <button
                    key={idx}
                    className={styles.suggestionCard}
                    onClick={() => handleSuggestionClick(s.text)}
                  >
                    <span className={styles.suggestionIcon}>{s.icon}</span>
                    <div className={styles.suggestionInfo}>
                      <span className={styles.suggestionText}>{s.text}</span>
                      <span className={styles.suggestionDesc}>{s.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg, i) => (
            <div key={i} className={`${styles.row} ${msg.role === 'user' ? styles.rowUser : styles.rowAssistant}`}>
              <div className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
                <div className={styles.bubbleHeader}>
                  {msg.role === 'user' ? (
                    <span className={styles.bubbleAuthor}>You</span>
                  ) : (
                    <span className={styles.bubbleAuthorAi}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.aiLogo}>
                        <polygon points="12 2 2 7 12 12 22 7 12 2" />
                        <polyline points="2 17 12 22 22 17" />
                        <polyline points="2 12 12 17 22 12" />
                      </svg>
                      inferr AI
                    </span>
                  )}
                </div>
                
                <p className={styles.bubbleText}>{msg.content}</p>

                {msg.sources && msg.sources.length > 0 && (
                  <div className={styles.sources}>
                    <div className={styles.sourcesHeader}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.sourcesIcon}>
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                      </svg>
                      <span>Cited Sources ({msg.sources.length})</span>
                    </div>
                    <div className={styles.sourcesGrid}>
                      {msg.sources.map((s, j) => (
                        <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
                          <div className={styles.sourceContent}>
                            <span className={`${styles.sourceBadge} ${styles[`badge_${s.source}`]}`}>
                              {SOURCE_LABEL[s.source] ?? s.source}
                            </span>
                            <span className={styles.sourceTitle}>{s.title}</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className={`${styles.row} ${styles.rowAssistant}`}>
              <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
                <div className={styles.bubbleHeader}>
                  <span className={styles.bubbleAuthorAi}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.aiLogo}>
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                    inferr AI
                  </span>
                </div>
                <div className={styles.dots}>
                  <span /><span /><span />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input Bar */}
        <div className={styles.inputBar}>
          <div className={styles.inputContainer}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              rows={1}
              placeholder="Ask a question about your feed..."
              value={input}
              onChange={onInput}
              onKeyDown={onKeyDown}
              disabled={loading}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className={styles.sendBtn}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
