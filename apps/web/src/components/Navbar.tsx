'use client';

import { usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Newspaper, MessageSquare, Sliders } from 'lucide-react';
import { ProfileMenu } from './ProfileMenu';
import styles from './Navbar.module.css';

const NAV_ITEMS = [
  { href: '/feed', label: 'Feed', icon: Newspaper },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
];

interface NavbarProps {
  onEditInterests?: () => void;
}

export function Navbar({ onEditInterests }: NavbarProps) {
  const pathname = usePathname();

  return (
    <>
      <nav className={`${styles.nav} glassNav`}>
        <div className={styles.navInner}>
          {/* Brand logo & name */}
          <Link href="/feed" className={styles.logo}>
            <Image
              src="/logo-v2.png"
              alt="inferr"
              width={28}
              height={28}
              className={styles.logoImg}
              priority
              unoptimized
            />
            <span className={styles.logoText}>
              inferr<span className={styles.logoDot}>.</span>
            </span>
          </Link>

          {/* Center links (desktop only) */}
          <div className={styles.navLinks}>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navLink} ${isActive ? styles.active : ''}`}
                >
                  {item.label}
                  {isActive && <span className={styles.activeGlow} />}
                </Link>
              );
            })}
          </div>

          {/* Right actions */}
          <div className={styles.navRight}>
            <ProfileMenu onEditInterests={onEditInterests} />
          </div>
        </div>
      </nav>

      {/* Bottom tab bar (mobile only) */}
      <div className={styles.mobileTabBar}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.tabItem} ${isActive ? styles.tabActive : ''}`}
            >
              <Icon size={18} />
              <span className={styles.tabLabel}>{item.label}</span>
            </Link>
          );
        })}
        {onEditInterests && (
          <button onClick={onEditInterests} className={styles.tabItem}>
            <Sliders size={18} />
            <span className={styles.tabLabel}>Interests</span>
          </button>
        )}
      </div>
    </>
  );
}
