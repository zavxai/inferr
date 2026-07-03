'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/src/lib/auth-context';
import { McpDialog } from './McpDialog';
import styles from './ProfileMenu.module.css';

interface ProfileMenuProps {
  // When provided, "Edit Interests" opens this handler (e.g. an in-place dialog)
  // instead of navigating to the /onboarding page.
  onEditInterests?: () => void;
}

export function ProfileMenu({ onEditInterests }: ProfileMenuProps = {}) {
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '';

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    router.push('/');
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-label="Open profile menu"
        disabled={!token}
      >
        {!user ? (
          <span className={styles.skeleton} />
        ) : user.avatar ? (
          <div className={styles.avatarContainer}>
            <Image
              src={user.avatar}
              alt={user.name}
              width={32}
              height={32}
              className={styles.avatar}
            />
            <span className={styles.onlineDot} />
          </div>
        ) : (
          <div className={styles.avatarContainer}>
            <span className={styles.initials}>{initials}</span>
            <span className={styles.onlineDot} />
          </div>
        )}
      </button>

      {open && (
        <div className={styles.dropdown}>
          {/* User info header */}
          <div className={styles.userInfo}>
            {user?.avatar ? (
              <Image src={user.avatar} alt={user.name} width={40} height={40} className={styles.dropAvatar} />
            ) : (
              <span className={styles.dropInitials}>{initials}</span>
            )}
            <div className={styles.userDetails}>
              <p className={styles.userName}>{user?.name ?? '—'}</p>
              <p className={styles.userEmail}>{user?.email ?? '—'}</p>
            </div>
          </div>

          <div className={styles.divider} />

          {/* Mobile navigation items */}
          <div className={styles.mobileOnly}>
            <Link
              href="/feed"
              className={`${styles.item} ${pathname === '/feed' ? styles.itemActive : ''}`}
              onClick={() => setOpen(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.itemIcon}>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <path d="M16 8h2"/>
                <path d="M16 12h2"/>
                <path d="M16 16h2"/>
                <path d="M6 8h6v8H6z"/>
              </svg>
              Feed
            </Link>
            <Link
              href="/chat"
              className={`${styles.item} ${pathname === '/chat' ? styles.itemActive : ''}`}
              onClick={() => setOpen(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.itemIcon}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Chat
            </Link>
            <div className={styles.divider} />
          </div>

          {/* Nav links specific to account */}
          <Link
            href="/dashboard"
            className={`${styles.item} ${pathname === '/dashboard' ? styles.itemActive : ''}`}
            onClick={() => setOpen(false)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.itemIcon}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
            Account & Status
          </Link>

          {/* Connect to Claude/MCP */}
          <button
            className={`${styles.item} ${styles.itemButton}`}
            onClick={() => {
              setOpen(false);
              setShowMcp(true);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.itemIcon}>
              <rect x="2" y="8" width="14" height="8" rx="2" ry="2" />
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <line x1="6" y1="2" x2="6" y2="8" />
              <line x1="12" y1="2" x2="12" y2="8" />
            </svg>
            Connect to Claude (MCP)
          </button>

          {/* Edit Interests */}
          {onEditInterests ? (
            <button
              className={`${styles.item} ${styles.itemButton}`}
              onClick={() => { setOpen(false); onEditInterests(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.itemIcon}>
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              Edit Interests
            </button>
          ) : (
            <Link
              href="/onboarding"
              className={`${styles.item} ${pathname === '/onboarding' ? styles.itemActive : ''}`}
              onClick={() => setOpen(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.itemIcon}>
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              Edit Interests
            </Link>
          )}

          <div className={styles.divider} />

          <button className={styles.signOut} onClick={handleSignOut}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.itemIcon}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      )}
      {showMcp && <McpDialog onClose={() => setShowMcp(false)} />}
    </div>
  );
}
