import type { IconName } from '../components/icons';

export type Badge = { text: string; cls: 'badge-teal' | 'badge-red' | 'badge-blue' };
export type NavLeaf = { to: string; text: string; icon?: IconName; badge?: Badge; admin?: boolean };
export type NavParent = { text: string; icon: IconName; badge?: Badge; children: NavLeaf[] };
export type NavItem = NavLeaf | NavParent;
export type NavGroup = { label: string; items: NavItem[] };

export const isParent = (i: NavItem): i is NavParent => 'children' in i;

export const NAV: NavGroup[] = [
  {
    label: 'Library',
    items: [
      { to: '/', text: 'Overview', icon: 'dashboard' },
      { to: '/catalog', text: 'Catalog', icon: 'books' },
      { to: '/log', text: 'Reading log', icon: 'receipt' },
      { to: '/analytics', text: 'Reading analytics', icon: 'charts' }
    ]
  },
  {
    label: 'Catalog',
    items: [
      { to: '/inventory', text: 'Books', icon: 'tables' },
      { to: '/upload', text: 'Add books', icon: 'files', admin: true },
      { to: '/files', text: 'Book files', icon: 'files' },
      { to: '/acquisitions', text: 'Acquisitions', icon: 'kanban' }
    ]
  },
  {
    label: 'Account',
    items: [
      { to: '/members', text: 'Members', icon: 'users', admin: true },
      { to: '/profile', text: 'Your profile', icon: 'profile' },
      { to: '/settings', text: 'Settings', icon: 'settings' },
      { to: '/help', text: 'Help', icon: 'help' }
    ]
  }
];
