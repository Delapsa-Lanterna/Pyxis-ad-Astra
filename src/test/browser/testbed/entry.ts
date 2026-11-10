import '@/styles/style.css';
import '../browser.css';
import appIcon from '@/assets/app-icon.svg';
const icon = document.createElement('link');
icon.rel = 'icon';
icon.href = appIcon;
document.head.append(icon);
if (new URLSearchParams(location.search).has('window')) void import('../windows').then((module) => module.mountBrowserWindow());
else void import('./page');
