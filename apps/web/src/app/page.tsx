'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import styles from './page.module.css'
import { API_BASE as API_URL, useAuth } from '@/src/lib/auth-context'

const PORTFOLIO_URL = 'https://johnvesslyalti.xyz'
const GITHUB_PROFILE_URL = 'https://github.com/johnvesslyalti'
const GITHUB_REPO_URL = 'https://github.com/johnvesslyalti/inferr'
const X_URL = 'https://x.com/zavxai'
const LINKEDIN_URL = 'https://www.linkedin.com/in/johnvesslyalti-ai-engineer'
const EMAIL_URL = 'mailto:altijohnvessly@gmail.com'

const features = [
  {
    title: 'Daily digest',
    desc: 'HN + Dev.to scraped every 24h. Top posts surface automatically — no manual browsing.',
    checks: ['Hacker News top stories', 'Dev.to trending articles', 'Zero duplicate noise'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
    visual: (
      <div className={styles.mockFeed}>
        <div className={styles.mockFeedHeader}>Today&apos;s feed</div>
        {['Rust 2024 edition: what changed', 'TypeScript 5.5 inference upgrades', 'pgvector HNSW vs IVFFlat benchmarks'].map((t, i) => (
          <div key={i} className={styles.mockFeedItem}>
            <span className={styles.mockFeedDot} />
            <span>{t}</span>
          </div>
        ))}
        <div className={styles.mockFeedFooter}>HN · Dev.to · 30 new today</div>
      </div>
    ),
  },
  {
    title: '3-line AI summaries',
    desc: 'gpt-4o-mini distills each article to three lines. No fluff, just the point.',
    checks: ['One sentence per key insight', 'Why it matters to developers', 'Cost: $0.02 per 100 articles'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
    visual: (
      <div className={styles.mockSummary}>
        <div className={styles.mockSummaryLabel}>⚡ AI Summary</div>
        <div className={styles.mockSummaryTitle}>How Rust handles memory without GC</div>
        <div className={styles.mockSummaryPoints}>
          <div>1. Ownership rules enforce memory safety at compile time.</div>
          <div>2. Borrow checker prevents data races with zero runtime cost.</div>
          <div>3. Drop trait replaces destructors — no GC pause, ever.</div>
        </div>
      </div>
    ),
  },
  {
    title: 'Interest-ranked feed',
    desc: 'Set your stack once. Embeddings rank articles by relevance to you, not by recency.',
    checks: ['Semantic matching via pgvector', 'Your tags → 1536-dim query vector', 'Re-ranks on every feed load'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
      </svg>
    ),
    visual: (
      <div className={styles.mockRank}>
        {[
          { n: '#1', tag: 'Rust', score: '96%' },
          { n: '#2', tag: 'TypeScript', score: '91%' },
          { n: '#3', tag: 'NestJS', score: '87%' },
          { n: '#4', tag: 'pgvector', score: '82%' },
        ].map((r) => (
          <div key={r.n} className={styles.mockRankRow}>
            <span className={styles.mockRankN}>{r.n}</span>
            <span className={styles.mockRankTag}>{r.tag}</span>
            <span className={styles.mockRankScore}>{r.score} match</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Semantic chat',
    desc: 'Ask questions across your feed. "What\'s new in vector databases this week?" actually works.',
    checks: ['RAG over your ranked articles', 'Sources cited in every answer', 'Powered by gpt-4o-mini'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
    visual: (
      <div className={styles.mockChat}>
        <div className={styles.mockChatBubbleUser}>What&apos;s new in vector databases this week?</div>
        <div className={styles.mockChatBubbleAI}>
          pgvector 0.8 shipped with HNSW improvements. Qdrant released sparse vector support. Weaviate added multi-tenancy at the cluster level.
          <div className={styles.mockChatSources}>Sources: 3 articles from your feed</div>
        </div>
      </div>
    ),
  },

  {
    title: 'Model Context Protocol',
    desc: 'Connect your personalized developer news feed directly to Claude Desktop, Cursor, or Claude Code. Access search and AI summaries right inside your workspace.',
    checks: [
      'search_articles semantic search tool',
      'get_personalized_feed user feed query',
      'ask_inferr agentic RAG chat interface',
      'PKCE OAuth 2.1 secure client auth',
    ],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h14v8H2z" />
        <line x1="6" y1="2" x2="6" y2="8" />
        <line x1="12" y1="2" x2="12" y2="8" />
      </svg>
    ),
    visual: (
      <div className={styles.mockMCP}>
        <div className={styles.mockMCPHeader}>
          <div className={styles.mockMCPDots}>
            <div /><div /><div />
          </div>
          <span className={styles.mockMCPTitle}>Claude Desktop</span>
        </div>
        <div className={styles.mockMCPBody}>
          <div className={styles.mockMCPToolCall}>
            <div className={styles.mockMCPToolName}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              <span>inferr.search_articles</span>
            </div>
            <div className={styles.mockMCPToolArgs}>
              {"{"} query: <span className={styles.mockMCPOutputString}>&quot;TypeScript 5.5&quot;</span> {"}"}
            </div>
          </div>
          <div className={styles.mockMCPOutput}>
            <div>[</div>
            <div style={{ paddingLeft: '1rem' }}>
              {"{"}
              <br />
              <span style={{ paddingLeft: '1rem' }}>
                <span className={styles.mockMCPOutputKey}>title:</span> <span className={styles.mockMCPOutputString}>&quot;TypeScript 5.5 inference upgrades&quot;</span>,
              </span>
              <br />
              <span style={{ paddingLeft: '1rem' }}>
                <span className={styles.mockMCPOutputKey}>matchScore:</span> <span className={styles.mockMCPOutputNum}>94%</span>
              </span>
              <br />
              {"}"}
            </div>
            <div>]</div>
          </div>
        </div>
      </div>
    ),
  },
];

const steps = [
  { n: '01', title: 'Sign in with Google', desc: 'One click. No password, no setup.' },
  { n: '02', title: 'Set your interests', desc: 'Tell us your stack. NestJS, Rust, LLMs — whatever you actually work with.' },
  { n: '03', title: 'Feed builds itself', desc: 'Articles scraped, summarised, and ranked for you every 24h.' },
  { n: '04', title: 'Ask it anything', desc: 'Use semantic chat to query your feed like a database.' },
]

export default function Home() {
  const [scrolled, setScrolled] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const router = useRouter()
  const { token, ready } = useAuth()

  const handleSignIn = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (signingIn) return
    setSigningIn(true)
    window.location.href = `${API_URL}/auth/google`
  }

  useEffect(() => {
    if (ready && token) router.replace('/feed')
  }, [ready, token, router])

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50)

    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('visible')),
      { threshold: 0.1, rootMargin: '0px 0px -80px 0px' },
    )
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))

    window.addEventListener('scroll', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      observer.disconnect()
    }
  }, [])

  return (
    <div className={styles.container}>

      {/* Navbar */}
      <nav className={`${styles.navbar} ${scrolled ? styles.scrolled : ''}`}>
        <div className={styles.navContent}>
          <div className={styles.logo}>
            <Image src="/logo.png" alt="Logo" width={26} height={26} style={{ borderRadius: '4px' }} />
            <span className={styles.logoText}>inferr</span>
          </div>
          <div className={styles.navRight}>
            <a href={`${API_URL}/auth/google`} onClick={handleSignIn} className={styles.signInBtn}>
              Sign in with Google →
            </a>
          </div>
        </div>
      </nav>

      {/* Hero — split layout */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.sectionInner}>
          <div className={styles.heroGrid}>
            <div className={styles.heroLeft}>
              <div className={`${styles.eyebrow} reveal`}>free · built in public</div>
              <h1 className={`${styles.headline} reveal`}>
                Your <span className={styles.accentWord}>AI</span> that reads<br />
                the internet. You just<br />
                read <span className={styles.accentWord}>what matters.</span>
              </h1>
              <p className={`${styles.subheadline} reveal`}>
                inferr scrapes Hacker News and Dev.to every day, summarises each article in 3 lines,
                and surfaces only what&apos;s relevant to your stack — automatically.
              </p>
              <div className={`${styles.heroActions} reveal`}>
                <a href={`${API_URL}/auth/google`} onClick={handleSignIn} className={styles.primaryBtn}>
                  Sign in with Google →
                </a>
              </div>
              <p className={`${styles.heroNote} reveal`}>Free during early access. No credit card.</p>
            </div>

            <div className={`${styles.heroRight} reveal`}>
              <div className={styles.terminalCard}>
                <div className={styles.terminalHeader}>
                  <div className={styles.terminalDots}>
                    <div /><div /><div />
                  </div>
                </div>
                <div className={styles.terminalBody}>
                  <div className={styles.terminalMeta}>
                    <span className={styles.source}>HN · 847 pts · 94% match</span>
                  </div>
                  <div className={styles.terminalTitle}>
                    Building RAG systems with pgvector and LLMs
                  </div>
                  <div className={styles.terminalSummary}>
                    <p>PostgreSQL&apos;s pgvector extension enables semantic search through embeddings.</p>
                    <p>Combine with an LLM for retrieval-augmented generation in production.</p>
                    <p>Real-world example: 50K docs, &lt;1s queries, $0.02 cost per summary.</p>
                  </div>
                  <div className={styles.terminalFooter}>
                    <span className={styles.tags}>NestJS · RAG · PostgreSQL</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features — alternating rows */}
      <div className={styles.featuresWrapper}>
        <div className={styles.sectionInner}>
          <p className={`${styles.sectionLabel} reveal`}>What inferr helps you do</p>
        </div>
        {features.map((f, i) => (
          <section key={f.title} className={`${styles.featureRow} ${i % 2 === 1 ? styles.featureRowReverse : ''}`}>
            <div className={styles.sectionInner}>
              <div className={styles.featureRowInner}>
                <div className={`${styles.featureRowText} reveal`}>
                  <div className={styles.featureIcon}>{f.icon}</div>
                  <h2 className={styles.featureRowTitle}>{f.title}</h2>
                  <p className={styles.featureRowDesc}>{f.desc}</p>
                  <ul className={styles.featureChecks}>
                    {f.checks.map((c) => (
                      <li key={c}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        {c}
                      </li>
                    ))}
                  </ul>
                  <p className={styles.featureTagline}>Always consistent. Always available.</p>
                </div>
                <div className={`${styles.featureRowVisual} reveal`}>
                  {f.visual}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* How it works */}
      <div className={styles.sectionInner}>
        <p className={`${styles.sectionLabel} reveal`}>How it works</p>
      </div>
      <section className={styles.howSection}>
        <div className={styles.sectionInner}>
          <h2 className={`${styles.sectionHeadingLight} reveal`}>Up and running in 30 seconds</h2>
          <div className={`${styles.stepsRow} reveal`}>
            {steps.map((s) => (
              <div key={s.n} className={styles.stepCard}>
                <span className={styles.stepNumber}>{s.n}</span>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepDesc}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.finalCTA}>
        <div className={styles.finalGlow} />
        <div className={styles.sectionInner}>
          <h2 className={`${styles.finalHeadline} reveal`}>
            Stop losing 45 minutes to<br />Hacker News every morning.
          </h2>
          <p className={`${styles.finalSub} reveal`}>
            Free. Takes 30 seconds to set up.
          </p>
          <div className="reveal">
            <a href={`${API_URL}/auth/google`} onClick={handleSignIn} className={styles.primaryBtnLight}>
              Sign in with Google →
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <span>Built by <a href={X_URL} target="_blank" rel="noopener noreferrer">@zavxai</a></span>
          <span className={styles.footerDot}>·</span>
          <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">Portfolio</a>
          <span className={styles.footerDot}>·</span>
          <a href={GITHUB_PROFILE_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          <span className={styles.footerDot}>·</span>
          <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">LinkedIn</a>
          <span className={styles.footerDot}>·</span>
          <a href={EMAIL_URL} target="_blank" rel="noopener noreferrer">Email</a>
          <span className={styles.footerDot}>·</span>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">Source Code</a>
        </div>
      </footer>

    </div>
  )
}
