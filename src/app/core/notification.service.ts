import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppNotification, UiActions } from '@khalilrebhiitec/daf360';

/**
 * Dispatches toast notifications into the shared UI store. In federated mode the
 * shell host renders them via its single `daf-toast-host` (Payroll must NOT mount
 * its own host or toasts would double-render). Standalone Payroll has no host — dev only.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private store = inject(Store);
  private seq = 0;

  success(message: string, title?: string, duration = 4000): void {
    this.push('success', message, title, duration);
  }
  error(message: string, title?: string, duration = 6000): void {
    this.push('error', message, title, duration);
  }
  warning(message: string, title?: string, duration = 5000): void {
    this.push('warning', message, title, duration);
  }
  info(message: string, title?: string, duration = 4000): void {
    this.push('info', message, title, duration);
  }

  private push(
    type: AppNotification['type'],
    message: string,
    title: string | undefined,
    duration: number,
  ): void {
    const notification: AppNotification = {
      id: `${Date.now()}-${++this.seq}`,
      type,
      message,
      title,
      duration,
    };
    this.store.dispatch(UiActions.addNotification({ notification }));
  }
}
