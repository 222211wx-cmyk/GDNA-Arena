/**
 * GDN-SMART FORTRESS
 * The standalone core requested for the Empire's six autonomous challenge bots.
 * It is imported by the API entrypoint, so START runs automatically on Republish.
 */
import fortressConfig from "./bots.config.json" with { type: "json" };

const clone = (value) => JSON.parse(JSON.stringify(value));

export class SMART_CORE {
  constructor(config = fortressConfig) {
    this.config = config;
    this.bots = [];
    this.startedAt = null;
    this.lastAutoUpdateAt = null;
    this.updateCount = 0;
    this.autoUpdateTimer = null;
  }

  START() {
    if (this.startedAt) return this.snapshot();

    if (!Array.isArray(this.config.bots) || this.config.bots.length !== 6) {
      throw new Error("GDN-SMART FORTRESS requires exactly six configured bots.");
    }

    this.bots = this.config.bots.map((bot) => ({
      ...clone(bot),
      status: "ACTIVE",
      challengeIndex: 0,
      activeChallenge: clone(bot.challenges[0]),
      updatedAt: new Date().toISOString(),
    }));
    this.startedAt = new Date().toISOString();

    const intervalMs = Math.max(1, Number(this.config.autoUpdateMinutes) || 30) * 60_000;
    this.autoUpdateTimer = setInterval(() => this.AUTO_UPDATE(), intervalMs);
    this.autoUpdateTimer.unref?.();

    return this.snapshot();
  }

  SET_DNA(botId, dna) {
    const bot = this.findBot(botId);
    if (!dna || typeof dna !== "object" || Array.isArray(dna)) {
      throw new Error("DNA must be an object of fortress traits.");
    }

    bot.dna = { ...bot.dna, ...clone(dna) };
    bot.updatedAt = new Date().toISOString();
    return clone(bot);
  }

  AUTO_UPDATE() {
    this.ensureStarted();
    this.bots.forEach((bot) => this.nextChallenge(bot.id, "automatic"));
    this.lastAutoUpdateAt = new Date().toISOString();
    this.updateCount += 1;
    return this.snapshot();
  }

  nextChallenge(botId, source = "manual") {
    this.ensureStarted();
    const bot = this.findBot(botId);
    bot.challengeIndex = (bot.challengeIndex + 1) % bot.challenges.length;
    bot.activeChallenge = clone(bot.challenges[bot.challengeIndex]);
    bot.updatedAt = new Date().toISOString();
    bot.challengeSource = source;
    return clone(bot);
  }

  getBots() {
    this.ensureStarted();
    return clone(this.bots);
  }

  snapshot() {
    return {
      systemName: this.config.systemName,
      version: this.config.version,
      autoUpdateMinutes: this.config.autoUpdateMinutes,
      status: this.startedAt ? "ACTIVE" : "STARTING",
      startedAt: this.startedAt,
      lastAutoUpdateAt: this.lastAutoUpdateAt,
      updateCount: this.updateCount,
      bots: clone(this.bots),
    };
  }

  ensureStarted() {
    if (!this.startedAt) this.START();
  }

  findBot(botId) {
    const bot = this.bots.find((candidate) => candidate.id === botId);
    if (!bot) throw new Error("Fortress bot not found.");
    return bot;
  }
}

export const smartFortress = new SMART_CORE();