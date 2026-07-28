import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RemoteStylesService {
  injectStyles(url: string): void {
    if (!url) return;
    const id = 'remote-styles-payroll';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  }
}
