import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiMoon, FiSun, FiArrowUp, FiPlus, FiMic } from 'react-icons/fi';
import logoAi from '../images/logo_ai2.png';

const THEME_KEY = 'ck-intelligence-chat-theme';

function CKIntelligenceChat() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => {
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s === 'light' || s === 'dark') return s;
    } catch (_) { /* ignore */ }
    return 'dark';
  });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { id: 'w', role: 'assistant', text: 'Hi — I\'m the CK Intelligence assistant. Ask about stock, locations, or warehouse insights. (Demo: replies are placeholders until the model is connected.)' },
  ]);
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxPx = 220;
    ta.style.height = `${Math.min(ta.scrollHeight, maxPx)}px`;
  }, []);

  useEffect(() => {
    document.body.classList.add('ckic-route');
    return () => document.body.classList.remove('ckic-route');
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const id = `${Date.now()}`;
    setMessages((m) => [...m, { id, role: 'user', text }]);
    setInput('');
    requestAnimationFrame(() => adjustTextareaHeight());
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: `${id}-r`,
          role: 'assistant',
          text: 'Thanks for your message. Full AI responses will appear here once the backend is wired.',
        },
      ]);
    }, 400);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="ckic-page" data-theme={theme}>
      <div className="ckic-backdrop" aria-hidden="true" />

      <header className="ckic-header">
        <button type="button" className="ckic-back" onClick={() => navigate('/ck-intelligence')} title="Back">
          <FiArrowLeft />
          <span>Back</span>
        </button>
        <div className="ckic-header-center">
          <h1 className="ckic-brand-wave">CK INTELLIGENCE</h1>
        </div>
        <button
          type="button"
          className="ckic-theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <FiSun /> : <FiMoon />}
        </button>
      </header>

      <div className="ckic-chat-shell">
        <div className="ckic-messages" ref={listRef} role="log" aria-live="polite">
          {messages.map((msg) => (
            <div key={msg.id} className={`ckic-row ckic-row--${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="ckic-bubble-avatar" aria-hidden="true">
                  <img src={logoAi} alt="" />
                </div>
              )}
              <div className={`ckic-bubble ckic-bubble--${msg.role}`}>{msg.text}</div>
            </div>
          ))}
        </div>

        <div className="ckic-composer">
          <textarea
            ref={textareaRef}
            className="ckic-input"
            rows={1}
            placeholder="Message CK Intelligence…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="ckic-composer-toolbar">
            <button
              type="button"
              className="ckic-composer-icon"
              title="Attach file"
              aria-label="Attach file"
            >
              <FiPlus />
            </button>
            <span className="ckic-composer-toolbar-spacer" aria-hidden="true" />
            <button
              type="button"
              className="ckic-composer-icon"
              title="Voice input"
              aria-label="Voice input"
            >
              <FiMic />
            </button>
            <button
              type="button"
              className="ckic-send-fab"
              onClick={send}
              disabled={!input.trim()}
              title="Send"
              aria-label="Send message"
            >
              <FiArrowUp />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CKIntelligenceChat;
