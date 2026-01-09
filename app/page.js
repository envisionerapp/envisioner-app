'use client'

import { useState, useEffect } from 'react'
import styles from './page.module.css'

export default function Home() {
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [conversation, setConversation] = useState([])
  const [panel, setPanel] = useState(null) // { type, data }
  const [panelLoading, setPanelLoading] = useState(false)

  // Get user from URL token
  const getUserFromToken = () => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      try {
        // Simple base64 decode for now (will upgrade to JWT)
        return atob(token)
      } catch {
        return null
      }
    }
    // Fallback for testing
    return params.get('user') || 'felipe@miela.cc'
  }

  useEffect(() => {
    loadBriefing()
  }, [])

  const loadBriefing = async () => {
    const user = getUserFromToken()
    if (!user) {
      setError('Please log in to view your briefing')
      setLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/briefing?user=${encodeURIComponent(user)}`)
      const data = await res.json()

      if (data.success) {
        setBriefing(data.briefing)
      } else {
        setError(data.error || 'Failed to load briefing')
      }
    } catch (err) {
      setError('Failed to connect')
    }
    setLoading(false)
  }

  const askQuestion = async (e) => {
    e.preventDefault()
    if (!question.trim() || asking) return

    const user = getUserFromToken()
    const q = question.trim()
    setQuestion('')
    setAsking(true)
    setConversation(prev => [...prev, { role: 'user', content: q }])

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, question: q })
      })
      const data = await res.json()

      if (data.success) {
        setConversation(prev => [...prev, { role: 'assistant', content: data.answer }])
      }
    } catch (err) {
      setConversation(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }])
    }
    setAsking(false)
  }

  // Handle action button clicks
  const handleAction = async (action) => {
    const user = getUserFromToken()
    setPanelLoading(true)
    setPanel({ type: 'loading', title: action.button })

    // Map button text to questions
    const buttonQuestions = {
      'Find similar': 'Show me creators similar to my top performers. List their names, platforms, and why they might work well.',
      'Find': 'Show me creators similar to my top performers. List their names, platforms, and why they might work well.',
      'Send reminder': `Write a short friendly reminder message I can send to ${action.text.replace('Get content from ', '')} asking about their content status.`,
      'Remind': `Write a short friendly reminder message I can send to ${action.text.replace('Get content from ', '')} asking about their content status.`,
      'See list': 'List all my underperforming creators - those who have been paid but have no conversions. Include their name, platform, amount spent, and how long ago they were added.',
      'Review': 'List all my underperforming creators - those who have been paid but have no conversions. Include their name, platform, amount spent, and how long ago they were added.',
      'Add creator': 'What information do I need to add a new creator? Walk me through the process.',
      'New campaign': 'What should I consider when creating a new campaign? What information do I need?',
    }

    const q = buttonQuestions[action.button] || `Tell me more about: ${action.text}`

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, question: q })
      })
      const data = await res.json()

      if (data.success) {
        setPanel({
          type: 'response',
          title: action.button,
          content: data.answer
        })
      } else {
        setPanel({
          type: 'error',
          title: 'Error',
          content: 'Something went wrong. Please try again.'
        })
      }
    } catch (err) {
      setPanel({
        type: 'error',
        title: 'Error',
        content: 'Failed to connect. Please try again.'
      })
    }
    setPanelLoading(false)
  }

  const closePanel = () => {
    setPanel(null)
  }

  const getScoreColor = (score) => {
    if (score >= 80) return 'green'
    if (score >= 60) return 'yellow'
    if (score >= 40) return 'orange'
    return 'red'
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading your briefing...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h2>Envisioner</h2>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  const scoreColor = getScoreColor(briefing.score)

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>ENVISIONER</div>
        <div className={`${styles.score} ${styles[`score${scoreColor}`]}`}>
          <span className={styles.scoreNumber}>{briefing.score}</span>
          <span className={styles.scoreLabel}>Score</span>
        </div>
      </header>

      {/* Summary */}
      <section className={styles.summary}>
        <p>{briefing.summary}</p>
      </section>

      {/* Metrics */}
      <section className={styles.metrics}>
        {briefing.metrics.map((m, i) => (
          <div key={i} className={styles.metric}>
            <div className={styles.metricValue}>{m.value}</div>
            <div className={styles.metricLabel}>{m.label}</div>
          </div>
        ))}
      </section>

      {/* Actions */}
      <section className={styles.actions}>
        <h3 className={styles.sectionTitle}>Do This Now</h3>
        {briefing.actions.map((action, i) => (
          <div key={i} className={styles.action}>
            <div className={styles.actionPriority}>{i + 1}</div>
            <div className={styles.actionContent}>
              <div className={styles.actionText}>{action.text}</div>
              <div className={styles.actionReason}>{action.reason}</div>
            </div>
            {action.button && (
              <button
                className={styles.actionButton}
                onClick={() => handleAction(action)}
              >
                {action.button}
              </button>
            )}
          </div>
        ))}
      </section>

      {/* Conversation */}
      {conversation.length > 0 && (
        <section className={styles.conversation}>
          {conversation.map((msg, i) => (
            <div key={i} className={`${styles.message} ${styles[msg.role]}`}>
              {msg.content}
            </div>
          ))}
          {asking && (
            <div className={styles.typing}>
              <span></span><span></span><span></span>
            </div>
          )}
        </section>
      )}

      {/* Input */}
      <form className={styles.inputArea} onSubmit={askQuestion}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything..."
          className={styles.input}
          disabled={asking}
        />
        <button type="submit" className={styles.sendButton} disabled={asking}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </form>

      {/* Panel Overlay */}
      {panel && (
        <div className={styles.panelOverlay} onClick={closePanel}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <h3>{panel.title}</h3>
              <button className={styles.panelClose} onClick={closePanel}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className={styles.panelContent}>
              {panel.type === 'loading' && (
                <div className={styles.panelLoading}>
                  <div className={styles.spinner}></div>
                  <p>Thinking...</p>
                </div>
              )}
              {panel.type === 'response' && (
                <div className={styles.panelResponse}>
                  {panel.content.split('\n').map((line, i) => (
                    <p key={i} dangerouslySetInnerHTML={{
                      __html: line.replace(
                        /\[([^\]]+)\]\(([^)]+)\)/g,
                        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
                      )
                    }} />
                  ))}
                </div>
              )}
              {panel.type === 'error' && (
                <div className={styles.panelError}>
                  <p>{panel.content}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
