'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './McpDialog.module.css';

interface McpDialogProps {
  onClose: () => void;
}

export function McpDialog({ onClose }: McpDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const devConfig = JSON.stringify(
    {
      mcpServers: {
        inferr: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/client-cli', `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001'}/mcp`],
        },
      },
    },
    null,
    2
  );

  const prodConfig = JSON.stringify(
    {
      mcpServers: {
        inferr: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/client-cli', 'https://api.inferr.xyz/mcp'],
        },
      },
    },
    null,
    2
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!mounted) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Connect to Claude Desktop</h2>
            <p className={styles.subtitle}>
              Access your personalized feed and search semantically directly inside Claude Desktop.
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close dialog">
            <X size={14} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.step}>
            <span className={styles.stepNum}>01</span>
            <div className={styles.stepText}>
              <h3>Open your Claude configuration file</h3>
              <p>Depending on your operating system, open the config file located at:</p>
              <ul className={styles.paths}>
                <li>
                  <strong>macOS:</strong> <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
                </li>
                <li>
                  <strong>Windows:</strong> <code>%APPDATA%\Claude\claude_desktop_config.json</code>
                </li>
              </ul>
            </div>
          </div>

          <div className={styles.step}>
            <span className={styles.stepNum}>02</span>
            <div className={styles.stepText}>
              <h3>Add the server configuration</h3>
              <p>Add the following block to your <code>mcpServers</code> object:</p>

              <div className={styles.tabContainer}>
                <div className={styles.tabHeader}>
                  <span>Production Server Configuration</span>
                  <button className={styles.copyBtn} onClick={() => copyToClipboard(prodConfig)}>
                    Copy Config
                  </button>
                </div>
                <pre className={styles.code}>
                  <code>{prodConfig}</code>
                </pre>
              </div>

              <div className={styles.tabContainer}>
                <div className={styles.tabHeader}>
                  <span>Local Development Server Configuration</span>
                  <button className={styles.copyBtn} onClick={() => copyToClipboard(devConfig)}>
                    Copy Config
                  </button>
                </div>
                <pre className={styles.code}>
                  <code>{devConfig}</code>
                </pre>
              </div>
            </div>
          </div>

          <div className={styles.step}>
            <span className={styles.stepNum}>03</span>
            <div className={styles.stepText}>
              <h3>Restart Claude & Authenticate</h3>
              <p>
                Completely quit and restart Claude Desktop. When Claude attempts to load the Inferr
                server, a browser window will automatically open asking you to sign in with Google
                to link your account.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
