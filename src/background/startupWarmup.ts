export class StartupNotificationWarmup {
  private mutedUntil = 0;

  constructor(private readonly durationMs: number) {}

  start(now = Date.now()): void {
    this.mutedUntil = now + this.durationMs;
  }

  isActive(now = Date.now()): boolean {
    return now < this.mutedUntil;
  }
}
