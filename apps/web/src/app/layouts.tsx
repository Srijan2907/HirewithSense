import { type ReactNode, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { Briefcase, Building2, ChevronDown, FileText, LayoutDashboard, LogOut, Mail, Menu, Moon, Plug, Settings, Sun, Users, X, type LucideIcon } from 'lucide-react';
import { Avatar, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui';
import { useAuth } from '@/lib/auth-store';
import { logout } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { queryClient } from '@/lib/query';

export function Logo({ className, to = '/' }: { className?: string; to?: string }) {
  return (
    <Link to={to} className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg text-sm font-bold">H</span>
      <span>
        HireWith<span className="text-accent">Sense</span>
      </span>
    </Link>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

function UserMenu() {
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  if (!user) return null;
  const isRec = user.role !== 'candidate';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2 cursor-pointer" aria-label="Account menu">
          <Avatar name={user.name} />
          <span className="hidden max-w-[10rem] truncate sm:inline">{user.name}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="truncate text-fg">{user.name}</div>
          <div className="truncate text-xs font-normal text-muted">{user.email}</div>
          {user.organization ? <div className="truncate text-xs font-normal text-muted">{user.organization.name}</div> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nav(isRec ? '/recruiter/settings' : '/app/profile')}>
          <Settings /> {isRec ? 'Settings' : 'Profile & resume'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await logout();
            queryClient.clear();
            nav('/login');
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const RECRUITER_NAV: NavItem[] = [
  { to: '/recruiter', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/recruiter/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/recruiter/interviews', label: 'Interviews', icon: Users },
  { to: '/recruiter/settings', label: 'Organization', icon: Building2 },
  { to: '/recruiter/integrations', label: 'Integrations', icon: Plug },
];
const CANDIDATE_NAV: NavItem[] = [
  { to: '/app', label: 'My interviews', icon: LayoutDashboard, end: true },
  { to: '/app/profile', label: 'Profile & resume', icon: FileText },
];

function SideNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const dev = import.meta.env.DEV;
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Main">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          onClick={onNavigate}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}
        >
          <it.icon className="size-4" />
          {it.label}
        </NavLink>
      ))}
      {dev ? (
        <NavLink to="/dev/outbox" onClick={onNavigate} className={({ isActive }) => cn('mt-4 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium', isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
          <Mail className="size-4" /> Dev mailbox
        </NavLink>
      ) : null}
    </nav>
  );
}

export function AppShell({ variant }: { variant: 'recruiter' | 'candidate' }) {
  const [open, setOpen] = useState(false);
  const items = variant === 'recruiter' ? RECRUITER_NAV : CANDIDATE_NAV;
  const home = variant === 'recruiter' ? '/recruiter' : '/app';
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r bg-surface lg:flex lg:flex-col">
        <div className="flex h-14 items-center border-b px-5">
          <Logo to={home} />
        </div>
        <SideNav items={items} />
      </aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r bg-surface shadow-xl animate-fade-in">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <Logo to={home} />
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
                <X />
              </Button>
            </div>
            <SideNav items={items} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-surface/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu />
            </Button>
            <Logo to={home} />
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Minimal chrome for auth pages, invitations and the landing page. */
export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children ?? <Outlet />}</main>
    </div>
  );
}

/** Distraction-free full-screen chrome for the interview and coding rooms. */
export function FocusLayout() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <Outlet />
    </div>
  );
}
